import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PerformanceObserver, performance } from "node:perf_hooks";
import { hashValue } from "../../core/stable";
import { CompactCfrSolver } from "../compact/compact-cfr";
import { CompactNashConvEvaluatorV2 } from "../compact/compact-evaluation";
import { compileCompactGame, strategyArrayProbability, type CompactCompilation } from "../compact/compact-tree";
import { SyntheticCompactProvider } from "../compact/synthetic-compact-provider";
import {
  deserializeBinaryCheckpointV5,
  restoreBinaryCheckpointV5,
  serializeBinaryCheckpointV5,
  writeBinaryCheckpointAtomic,
} from "./binary-checkpoint-v5";
import { extractCompleteSubtree, validateExtractedSubtree } from "./subtree-validation";
import type { IsolatedExperimentRequest, ProcessMemory, StageMetric } from "./types";

type StageReporter = (metric: StageMetric) => void;

function memory(stage: string): ProcessMemory {
  const usage = process.memoryUsage();
  return {
    timestamp: new Date().toISOString(),
    stage,
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    peakRssSelfReported: process.resourceUsage().maxRSS * 1024,
  };
}

function reportStage(reporter: StageReporter, stage: string, status: StageMetric["status"], started?: number, details?: Record<string, unknown>) {
  reporter({
    stage,
    status,
    timestamp: new Date().toISOString(),
    ...(started === undefined ? {} : { runtimeMs: performance.now() - started }),
    ...(details ? { details } : {}),
    memory: memory(stage),
  });
}

function forceGc() {
  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
}

export async function runProfileExperiment(request: IsolatedExperimentRequest, reporter: StageReporter) {
  if (!request.configuration || !request.solverConfiguration) throw new Error("Profile experiment requires game and solver configurations.");
  if (!request.preflight || request.preflight.decision !== "ALLOW") throw new Error("STRUCTURAL_LIMIT: profile execution requires an ALLOW decision from Resource Policy V3.");
  if (request.preflight.tier !== request.tier) throw new Error("STRUCTURAL_LIMIT: preflight tier does not match the experiment tier.");
  if (request.iterations > request.limits.maximumIterations) throw new Error("STRUCTURAL_LIMIT: requested iterations exceed the watchdog limit.");
  let gcCount = 0;
  let gcDurationMs = 0;
  const observer = new PerformanceObserver((list) => {
    gcCount += list.getEntries().length;
    gcDurationMs += list.getEntries().reduce((sum, entry) => sum + entry.duration, 0);
  });
  observer.observe({ entryTypes: ["gc"] });
  forceGc();
  const snapshots: ProcessMemory[] = [memory("before-compilation")];
  reportStage(reporter, "preflight", "completed", undefined, { configurationHash: hashValue(request.configuration) });

  let provider: SyntheticCompactProvider | null = new SyntheticCompactProvider(request.configuration);
  let compilation: CompactCompilation | null = null;
  let solver: CompactCfrSolver | null = null;

  let started = performance.now();
  reportStage(reporter, "compilation", "started");
  compilation = compileCompactGame(provider);
  if (compilation.tree.validation.nodes !== request.preflight.estimate.nodes) {
    throw new Error(`STRUCTURAL_LIMIT: compiled ${compilation.tree.validation.nodes} nodes but preflight authorized ${request.preflight.estimate.nodes}.`);
  }
  snapshots.push(memory("after-compilation"));
  reportStage(reporter, "compilation", "completed", started, {
    nodes: compilation.tree.validation.nodes,
    informationSets: compilation.tree.validation.informationSets,
    topologyBytes: compilation.topologyBytes,
    registryBytes: compilation.registryBytes,
    temporaryBytes: compilation.temporaryBytes,
    validation: compilation.tree.validation,
  });

  started = performance.now();
  reportStage(reporter, "structural-validation", "started");
  if (!compilation.tree.validation.valid) throw new Error(`Structural validation failed: ${compilation.tree.validation.issues.join(",")}`);
  const subtreeLevel = provider.levels.find((level) => level.kind === "decision" && level.stage === Math.max(0, request.configuration!.stages - 2));
  if (!subtreeLevel) throw new Error("Could not select a controlled validation subtree.");
  const subtree = extractCompleteSubtree(provider, subtreeLevel.offset, 10_000);
  const subtreeValidation = validateExtractedSubtree(provider, subtree);
  if (!subtreeValidation.valid) throw new Error(`Subtree validation failed: ${subtreeValidation.issues.join(",")}`);
  reportStage(reporter, "structural-validation", "completed", started, { subtree: subtreeValidation });

  started = performance.now();
  reportStage(reporter, "solver-initialization", "started");
  solver = new CompactCfrSolver(provider, compilation.tree, request.solverConfiguration);
  solver.initialize();
  snapshots.push(memory("after-solver-initialization"));
  reportStage(reporter, "solver-initialization", "completed", started, { solverStateBytes: solver.logicalStateBytes });

  started = performance.now();
  reportStage(reporter, "traversal", "started");
  for (let iteration = 0; iteration < request.iterations; iteration += 1) solver.iterate();
  const traversalRuntimeMs = performance.now() - started;
  snapshots.push(memory("after-traversal"));
  reportStage(reporter, "traversal", "completed", started, {
    iterations: solver.iteration,
    nodesVisited: solver.visitedNodes,
    nodesPerSecond: solver.visitedNodes / Math.max(1e-9, traversalRuntimeMs / 1000),
    stateHash: solver.stateHash,
  });

  let evaluation: Record<string, unknown> | null = null;
  if (request.evaluate) {
    started = performance.now();
    reportStage(reporter, "evaluation", "started");
    const strategy = solver.averageStrategyArray();
    const evaluated = new CompactNashConvEvaluatorV2(compilation.tree)
      .evaluate(strategyArrayProbability(compilation.tree, strategy));
    evaluation = {
      utilities: evaluated.utilities,
      bestResponseValues: evaluated.bestResponseValues,
      exploitability: evaluated.exploitability,
      nashConv: evaluated.nashConv,
      nodesVisited: evaluated.nodesVisited,
      temporaryBytes: evaluated.temporaryBytes,
      policyHashes: evaluated.policyHashes,
    };
    snapshots.push(memory("after-evaluation"));
    reportStage(reporter, "evaluation", "completed", started, evaluation);
  }

  let checkpoint: Record<string, unknown> | null = null;
  if (request.checkpoint) {
    started = performance.now();
    reportStage(reporter, "checkpoint", "started");
    const stateHashBefore = solver.stateHash;
    let v4: Record<string, unknown> | null = null;
    if (provider.nodeCount <= 250_000) {
      const v4Started = performance.now();
      const serializedV4 = JSON.stringify(solver.checkpoint());
      const v4SerializationMs = performance.now() - v4Started;
      const v4DecodeStarted = performance.now();
      JSON.parse(serializedV4);
      v4 = {
        bytes: Buffer.byteLength(serializedV4),
        serializationMs: v4SerializationMs,
        deserializationMs: performance.now() - v4DecodeStarted,
        temporaryBytes: Buffer.byteLength(serializedV4) + solver.logicalStateBytes,
      };
    }
    const v5 = serializeBinaryCheckpointV5(solver);
    const decoded = deserializeBinaryCheckpointV5(v5.buffer);
    const restored = new CompactCfrSolver(provider, compilation.tree, request.solverConfiguration);
    restoreBinaryCheckpointV5(restored, decoded);
    const directory = await mkdtemp(join(tmpdir(), "preflop-phase610-"));
    const target = join(directory, "checkpoint-v5.bin");
    try {
      const atomic = await writeBinaryCheckpointAtomic(target, v5);
      const persisted = deserializeBinaryCheckpointV5(await readFile(target));
      checkpoint = {
        v4,
        v5: {
          bytes: v5.bytes,
          serializationMs: v5.serializationMs,
          deserializationMs: decoded.deserializationMs,
          checksumValidationMs: decoded.checksumValidationMs,
          temporaryBytes: v5.temporaryBytes,
          payloadChecksum: v5.payloadChecksum,
          semanticStateHash: v5.semanticStateHash,
          atomic,
          persistedChecksum: persisted.payloadChecksum,
        },
        deterministicResume: restored.stateHash === stateHashBefore,
        restoredStateHash: restored.stateHash,
        originalStateHash: stateHashBefore,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    snapshots.push(memory("after-checkpoint"));
    reportStage(reporter, "checkpoint", "completed", started, checkpoint ?? undefined);
  }

  const checkpointSemantic = checkpoint ? {
    deterministicResume: checkpoint.deterministicResume,
    restoredStateHash: checkpoint.restoredStateHash,
    originalStateHash: checkpoint.originalStateHash,
    v5: checkpoint.v5 && typeof checkpoint.v5 === "object" ? {
      payloadChecksum: (checkpoint.v5 as Record<string, unknown>).payloadChecksum,
      semanticStateHash: (checkpoint.v5 as Record<string, unknown>).semanticStateHash,
      bytes: (checkpoint.v5 as Record<string, unknown>).bytes,
    } : null,
  } : null;
  const semanticResultHash = hashValue({
    gameHash: provider.logicalGameHash,
    stateHash: solver.stateHash,
    iteration: solver.iteration,
    nodesVisited: solver.visitedNodes,
    evaluation,
    checkpoint: checkpointSemantic,
    subtreeValidation,
  });
  const resultBeforeCleanup = {
    gameHash: provider.logicalGameHash,
    configurationHash: hashValue(request.configuration),
    solverConfigurationHash: solver.configurationHash,
    iterations: solver.iteration,
    nodesVisited: solver.visitedNodes,
    stateHash: solver.stateHash,
    structuralValidation: compilation.tree.validation,
    subtreeValidation,
    evaluation,
    checkpoint,
    semanticResultHash,
  };
  const arrayBuffersBeforeCleanup = process.memoryUsage().arrayBuffers;
  provider = null;
  compilation = null;
  solver = null;
  forceGc();
  await new Promise((resolve) => setTimeout(resolve, 10));
  forceGc();
  const afterCleanup = memory("after-cleanup");
  snapshots.push(afterCleanup);
  reportStage(reporter, "cleanup", "completed", undefined, {
    arrayBuffersReleased: Math.max(0, arrayBuffersBeforeCleanup - afterCleanup.arrayBuffers),
  });
  observer.disconnect();
  const peakSelfReported = Math.max(...snapshots.map((snapshot) => snapshot.peakRssSelfReported));
  const totalRuntimeMs = snapshots.length ? Date.parse(afterCleanup.timestamp) - Date.parse(snapshots[0].timestamp) : 0;
  return {
    ...resultBeforeCleanup,
    snapshots,
    profiling: {
      peakSelfReportedRssBytes: peakSelfReported,
      gcCount,
      gcDurationMs,
      allocationRateBytesPerMs: totalRuntimeMs > 0
        ? Math.max(...snapshots.map((snapshot) => snapshot.arrayBuffers)) / totalRuntimeMs
        : null,
      peakMeasurement: "process.resourceUsage maxRSS plus stage samples; parent supplies independent OS samples",
    },
  };
}

export async function runFixtureExperiment(request: IsolatedExperimentRequest) {
  if (request.kind === "timeout-fixture") {
    const started = performance.now();
    while (performance.now() - started < request.limits.maximumRuntimeMs * 10) Math.sqrt(144);
    return { unexpectedlyCompleted: true };
  }
  if (request.kind === "memory-fixture") {
    const bytes = request.fixtureAllocationBytes ?? request.limits.maximumRssBytes * 2;
    const allocation = new Uint8Array(bytes);
    for (let index = 0; index < allocation.length; index += 4096) allocation[index] = 1;
    await new Promise((resolve) => setTimeout(resolve, request.limits.maximumRuntimeMs * 2));
    return { unexpectedlyCompleted: true, bytes: allocation.byteLength };
  }
  throw new Error(`Fixture ${request.kind} must be handled by the isolated child.`);
}
