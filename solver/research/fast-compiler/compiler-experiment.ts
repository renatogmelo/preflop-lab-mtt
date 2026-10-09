import { performance, PerformanceObserver } from "node:perf_hooks";
import { hashValue } from "../../core/stable";
import { CompactCfrSolver } from "../compact/compact-cfr";
import { CompactNashConvEvaluatorV2 } from "../compact/compact-evaluation";
import { compileCompactGame, strategyArrayProbability, type CompactIndexedTree } from "../compact/compact-tree";
import { SyntheticCompactProvider } from "../compact/synthetic-compact-provider";
import type { IsolatedExperimentRequest, ProcessMemory, StageMetric } from "../resource-safe/types";
import { compileSyntheticGameV2, structuralHashCompactTree } from "./compiler-v2";
import { createStructuralCacheIdentity, loadStructuralCache, writeStructuralCacheAtomic } from "./structural-cache-v1";
import { compareCompactTrees, runRustStructuralCompiler } from "./rust-interop";

type StageReporter = (metric: StageMetric) => void;

function memory(stage: string): ProcessMemory {
  const usage = process.memoryUsage();
  return {
    timestamp: new Date().toISOString(), stage, rss: usage.rss, heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal, external: usage.external, arrayBuffers: usage.arrayBuffers,
    peakRssSelfReported: process.resourceUsage().maxRSS * 1024,
  };
}

function report(reporter: StageReporter, stage: string, status: StageMetric["status"], started?: number, details?: Record<string, unknown>) {
  reporter({ stage, status, timestamp: new Date().toISOString(), ...(started === undefined ? {} : { runtimeMs: performance.now() - started }), ...(details ? { details } : {}), memory: memory(stage) });
}

function gc() { (globalThis as typeof globalThis & { gc?: () => void }).gc?.(); }

export async function runCompilerProfileExperiment(request: IsolatedExperimentRequest, reporter: StageReporter) {
  if (!request.configuration || !request.solverConfiguration || !request.compilerMode) throw new Error("Compiler profile requires game, solver and compiler mode.");
  if (!request.preflight || request.preflight.decision !== "ALLOW") throw new Error("STRUCTURAL_LIMIT: compiler profile requires an ALLOW decision from Resource Policy V3.");
  if (request.preflight.estimate.nodes < 1) throw new Error("STRUCTURAL_LIMIT: preflight node estimate is invalid.");
  if (request.iterations > request.limits.maximumIterations) throw new Error("STRUCTURAL_LIMIT: requested iterations exceed the watchdog limit.");
  gc();
  const snapshots = [memory("before-compilation")];
  report(reporter, "preflight", "completed", undefined, { mode: request.compilerMode, nodeBudget: request.preflight.estimate.nodes });
  const provider = new SyntheticCompactProvider(request.configuration);
  let tree: CompactIndexedTree;
  let compilerDetails: Record<string, unknown> = {};
  let started = performance.now();
  let gcCount = 0;
  let gcDurationMs = 0;
  const observer = new PerformanceObserver((entries) => {
    gcCount += entries.getEntries().length;
    gcDurationMs += entries.getEntries().reduce((sum, entry) => sum + entry.duration, 0);
  });
  observer.observe({ entryTypes: ["gc"] });
  report(reporter, "compilation", "started", undefined, { mode: request.compilerMode });
  if (request.compilerMode === "baseline") {
    const compilation = compileCompactGame(provider);
    tree = compilation.tree;
    compilerDetails = { compilationMs: compilation.compilationMs, topologyBytes: compilation.topologyBytes, registryBytes: compilation.registryBytes, temporaryBytes: compilation.temporaryBytes };
  } else if (request.compilerMode === "typescript-v2") {
    const compilation = compileSyntheticGameV2(request.configuration, { chunkSize: request.chunkSize ?? 65_536, maximumNodes: request.preflight.estimate.nodes });
    tree = compilation.tree;
    compilerDetails = { compilationMs: compilation.compilationMs, topologyBytes: compilation.topologyBytes, registryBytes: compilation.registryBytes, temporaryBytes: compilation.temporaryBytes, profile: compilation.profile, structuralHash: compilation.structuralHash };
  } else if (request.compilerMode === "cache-load") {
    if (!request.structuralPath) throw new Error("Cache-load profile requires structuralPath.");
    const loaded = await loadStructuralCache(request.structuralPath, createStructuralCacheIdentity(request.configuration));
    if (!loaded.hit || !loaded.tree) throw new Error(`Structural cache miss: ${loaded.reason}: ${loaded.error ?? ""}`);
    tree = loaded.tree;
    compilerDetails = { cacheHit: true, fileBytes: loaded.fileBytes, checksum: loaded.checksum, structuralHash: loaded.header?.structuralHash };
  } else {
    if (!request.rustExecutable || !request.structuralPath) throw new Error("Rust profile requires executable and output path.");
    const native = await runRustStructuralCompiler({ executable: request.rustExecutable, output: request.structuralPath, configuration: request.configuration, timeoutMs: request.limits.maximumRuntimeMs });
    tree = native.tree;
    compilerDetails = { processMs: native.processMs, nativeTimings: native.nativeTimings, startupAndProtocolOverheadMs: native.startupAndProtocolOverheadMs, loadMs: native.loadMs, totalIntegrationMs: native.totalIntegrationMs, fileBytes: native.fileBytes, nativeStructuralHash: native.nativeStructuralHash, structuralHash: native.structuralHash, validationMs: native.validationMs };
  }
  const compileWallMs = performance.now() - started;
  if (tree.validation.nodes !== request.preflight.estimate.nodes || !tree.validation.valid) throw new Error("STRUCTURAL_LIMIT: compiler result differs from the authorized or valid topology.");
  if (request.cachePath && request.compilerMode !== "cache-load") {
    const source = request.compilerMode === "rust" ? "rust-v1" : "typescript-v2";
    const cacheStarted = performance.now();
    const cache = await writeStructuralCacheAtomic(request.cachePath, tree, createStructuralCacheIdentity(request.configuration), source);
    compilerDetails.cacheExport = { path: request.cachePath, fileBytes: cache.fileBytes, checksum: cache.checksum, written: cache.written, runtimeMs: performance.now() - cacheStarted, source };
  }
  if (request.crossValidate && request.compilerMode === "rust") {
    const referenceStarted = performance.now();
    const reference = compileSyntheticGameV2(request.configuration, { chunkSize: request.chunkSize ?? 65_536, maximumNodes: request.preflight.estimate.nodes });
    compilerDetails.crossLanguage = { ...compareCompactTrees(reference.tree, tree), referenceCompilationMs: performance.now() - referenceStarted, referenceStructuralHash: reference.structuralHash };
  }
  snapshots.push(memory("after-compilation"));
  report(reporter, "compilation", "completed", started, { ...compilerDetails, compileWallMs, nodes: tree.validation.nodes, informationSets: tree.validation.informationSets });

  started = performance.now();
  report(reporter, "solver-initialization", "started");
  let solver: CompactCfrSolver | null = new CompactCfrSolver(provider, tree, request.solverConfiguration);
  solver.initialize();
  const initializationMs = performance.now() - started;
  snapshots.push(memory("after-solver-initialization"));
  report(reporter, "solver-initialization", "completed", started, { logicalStateBytes: solver.logicalStateBytes });

  started = performance.now();
  report(reporter, "traversal", "started");
  for (let iteration = 0; iteration < request.iterations; iteration += 1) solver.iterate();
  const traversalMs = performance.now() - started;
  snapshots.push(memory("after-traversal"));
  report(reporter, "traversal", "completed", started, { iterations: solver.iteration, nodesVisited: solver.visitedNodes, stateHash: solver.stateHash });

  let evaluation: Record<string, unknown> | null = null;
  let evaluationMs = 0;
  if (request.evaluate) {
    started = performance.now();
    report(reporter, "evaluation", "started");
    const strategy = solver.averageStrategyArray();
    const evaluated = new CompactNashConvEvaluatorV2(tree).evaluate(strategyArrayProbability(tree, strategy));
    evaluationMs = performance.now() - started;
    evaluation = { utilities: evaluated.utilities, bestResponseValues: evaluated.bestResponseValues, exploitability: evaluated.exploitability, nashConv: evaluated.nashConv, nodesVisited: evaluated.nodesVisited, policyHashes: evaluated.policyHashes };
    snapshots.push(memory("after-evaluation"));
    report(reporter, "evaluation", "completed", started, evaluation);
  }
  const semanticResultHash = hashValue({ gameHash: provider.logicalGameHash, structuralHash: structuralHashCompactTree(tree), stateHash: solver.stateHash, iteration: solver.iteration, evaluation });
  const result = {
    mode: request.compilerMode,
    configurationHash: hashValue(request.configuration),
    gameHash: provider.logicalGameHash,
    structuralHash: structuralHashCompactTree(tree),
    compilerDetails,
    compileWallMs,
    initializationMs,
    traversalMs,
    evaluationMs,
    stateHash: solver.stateHash,
    evaluation,
    semanticResultHash,
    snapshots,
    profiling: { gcCount, gcDurationMs },
  };
  const buffersBefore = process.memoryUsage().arrayBuffers;
  solver = null;
  tree = null as unknown as CompactIndexedTree;
  gc();
  await new Promise((resolve) => setTimeout(resolve, 10));
  gc();
  const after = memory("after-cleanup");
  report(reporter, "cleanup", "completed", undefined, { arrayBuffersReleased: Math.max(0, buffersBefore - after.arrayBuffers) });
  observer.disconnect();
  return result;
}