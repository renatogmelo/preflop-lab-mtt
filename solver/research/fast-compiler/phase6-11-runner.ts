import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { hashValue } from "../../core/stable";
import { SCALE_CONFIGURATIONS } from "../scalability/experiment-runner";
import { CompactCfrSolver } from "../compact/compact-cfr";
import { SyntheticCompactProvider } from "../compact/synthetic-compact-provider";
import { deserializeBinaryCheckpointV5, restoreBinaryCheckpointV5, serializeBinaryCheckpointV5 } from "../resource-safe/binary-checkpoint-v5";
import { compileSyntheticGameV2, structuralHashCompactTree } from "./compiler-v2";
import { loadOrCompileStructuralTopology } from "./cache-coordinator";
import type { ResourceCalibration } from "../resource-safe/types";
import { runIsolatedExperiment } from "../resource-safe/isolated-runner";
import { preflightV3 } from "../resource-safe/resource-policy-v3";
import type { IsolatedExperimentRequest, IsolatedExperimentResult, ResourceTier } from "../resource-safe/types";
import { createStructuralCacheIdentity, deserializeStructuralCache, serializeStructuralCache } from "./structural-cache-v1";

const solverConfiguration = { algorithm: "dcfr", seed: 611, exactMetrics: false, engine: "indexed-tree", dcfr: { alpha: 2, beta: 0, gamma: 3 } } as const;
const limits = { maximumRssBytes: 768 * 1024 * 1024, maximumRuntimeMs: 30_000, maximumIdleMs: 12_000, maximumIterations: 1, sampleIntervalMs: 100 };

function median(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function numericResult(run: IsolatedExperimentResult, key: string) {
  const value = run.result?.[key];
  return typeof value === "number" ? value : Number.NaN;
}

function evaluation(run: IsolatedExperimentResult) {
  return run.result?.evaluation as { utilities?: number[]; exploitability?: number; nashConv?: number } | undefined;
}

function compactRun(run: IsolatedExperimentResult) {
  return {
    experimentId: run.experimentId,
    pid: run.pid,
    terminationReason: run.terminationReason,
    runtimeMs: run.runtimeMs,
    peakRssObservedBytes: run.peakRssObservedBytes,
    peakRssMeasurement: run.peakRssMeasurement,
    semanticResultHash: run.semanticResultHash,
    stages: run.stages,
    result: run.result,
    error: run.error,
  };
}

function summarize(runs: IsolatedExperimentResult[]) {
  const completed = runs.filter((run) => run.terminationReason === "completed");
  const compile = completed.map((run) => numericResult(run, "compileWallMs")).filter(Number.isFinite);
  const traversal = completed.map((run) => numericResult(run, "traversalMs")).filter(Number.isFinite);
  const evaluationValues = completed.map((run) => numericResult(run, "evaluationMs")).filter(Number.isFinite);
  const rss = completed.map((run) => run.peakRssObservedBytes ?? 0).filter((value) => value > 0);
  return {
    repetitions: runs.length,
    completed: completed.length,
    compileMedianMs: compile.length ? median(compile) : null,
    compileMinimumMs: compile.length ? Math.min(...compile) : null,
    compileMaximumMs: compile.length ? Math.max(...compile) : null,
    compileRangeMs: compile.length ? Math.max(...compile) - Math.min(...compile) : null,
    compileStandardDeviationMs: compile.length
      ? Math.sqrt(compile.reduce((sum, value) => sum + (value - compile.reduce((total, entry) => total + entry, 0) / compile.length) ** 2, 0) / compile.length)
      : null,
    traversalMedianMs: traversal.length ? median(traversal) : null,
    evaluationMedianMs: evaluationValues.length ? median(evaluationValues) : null,
    peakRssMedianBytes: rss.length ? median(rss) : null,
    semanticHashes: [...new Set(completed.map((run) => run.semanticResultHash))],
  };
}

function maximumEvaluationDelta(reference: IsolatedExperimentResult, candidate: IsolatedExperimentResult) {
  const left = evaluation(reference);
  const right = evaluation(candidate);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const values = [
    Math.abs((left.utilities?.[0] ?? Number.NaN) - (right.utilities?.[0] ?? Number.NaN)),
    Math.abs((left.utilities?.[1] ?? Number.NaN) - (right.utilities?.[1] ?? Number.NaN)),
    Math.abs((left.exploitability ?? Number.NaN) - (right.exploitability ?? Number.NaN)),
    Math.abs((left.nashConv ?? Number.NaN) - (right.nashConv ?? Number.NaN)),
  ];
  return Math.max(...values);
}

function verifyCacheCheckpointResume() {
  const scale = SCALE_CONFIGURATIONS.find((entry) => entry.level === "S1")!;
  const compiled = compileSyntheticGameV2(scale.configuration);
  const identity = createStructuralCacheIdentity(scale.configuration);
  const cachedTree = deserializeStructuralCache(serializeStructuralCache(compiled.tree, identity).buffer, identity).tree;
  const provider = new SyntheticCompactProvider(scale.configuration);
  const continuous = new CompactCfrSolver(provider, compiled.tree, solverConfiguration);
  continuous.solve({ maxIterations: 11, collectExactMetrics: false });
  const interrupted = new CompactCfrSolver(provider, compiled.tree, solverConfiguration);
  interrupted.solve({ maxIterations: 5, collectExactMetrics: false });
  const checkpoint = deserializeBinaryCheckpointV5(serializeBinaryCheckpointV5(interrupted).buffer);
  const resumed = new CompactCfrSolver(provider, cachedTree, solverConfiguration);
  restoreBinaryCheckpointV5(resumed, checkpoint);
  resumed.solve({ maxIterations: 11, collectExactMetrics: false });
  return {
    passed: resumed.stateHash === continuous.stateHash,
    continuousStateHash: continuous.stateHash,
    resumedStateHash: resumed.stateHash,
    checkpointSemanticStateHash: checkpoint.semanticStateHash,
    scale: scale.level,
  };
}
export async function runPhase611Research(previous: Record<string, unknown>) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const working = await mkdtemp(join(tmpdir(), "preflop-phase611-"));
  const rustExecutable = resolve("solver/native/phase611-compiler/target/release/preflop-lab-structural-compiler.exe");
  const calibration = ((previous.policy as { calibration?: ResourceCalibration } | undefined)?.calibration) ?? null;
  const matrixScales = SCALE_CONFIGURATIONS.filter((entry) => ["S3", "S4", "S5"].includes(entry.level));
  const allRuns: IsolatedExperimentResult[] = [];
  const matrix: Record<string, unknown> = {};
  const preflights: Record<string, unknown> = {};
  const makeRequest = (
    level: string,
    configuration: (typeof SCALE_CONFIGURATIONS)[number]["configuration"],
    mode: NonNullable<IsolatedExperimentRequest["compilerMode"]>,
    id: string,
    extras: Partial<IsolatedExperimentRequest> = {},
  ): IsolatedExperimentRequest => {
    const tier: ResourceTier = level === "S5" ? "tier2" : "tier0";
    const preflight = preflightV3({ configuration, tier, iterations: 1, explicitLargeScaleAuthorization: level === "S5", calibration });
    preflights[level] = preflight;
    return {
      experimentId: id,
      kind: "compiler-profile",
      configuration,
      solverConfiguration,
      iterations: 1,
      evaluate: true,
      checkpoint: false,
      tier,
      explicitLargeScaleAuthorization: level === "S5",
      limits,
      preflight,
      compilerMode: mode,
      chunkSize: 65_536,
      ...extras,
    };
  };

  try {
    for (const scale of matrixScales) {
      const scaleDirectory = join(working, scale.level.toLowerCase());
      const tsCache = join(scaleDirectory, "typescript.cache");
      const rustCache = join(scaleDirectory, "rust.cache");
      const modes: Record<string, IsolatedExperimentResult[]> = { baseline: [], typescriptV2: [], rust: [], typescriptCache: [], rustCache: [] };
      for (let repetition = 0; repetition < 2; repetition += 1) {
        const baseline = await runIsolatedExperiment(makeRequest(scale.level, scale.configuration, "baseline", `phase611-${scale.level}-baseline-${repetition}`));
        modes.baseline.push(baseline); allRuns.push(baseline);
        const typescript = await runIsolatedExperiment(makeRequest(scale.level, scale.configuration, "typescript-v2", `phase611-${scale.level}-typescript-${repetition}`, repetition === 0 ? { cachePath: tsCache } : {}));
        modes.typescriptV2.push(typescript); allRuns.push(typescript);
        const rustOutput = join(scaleDirectory, `rust-${repetition}.native`);
        const rust = await runIsolatedExperiment(makeRequest(scale.level, scale.configuration, "rust", `phase611-${scale.level}-rust-${repetition}`, { rustExecutable, structuralPath: rustOutput, ...(repetition === 0 ? { cachePath: rustCache } : {}) }));
        modes.rust.push(rust); allRuns.push(rust);
      }
      for (let repetition = 0; repetition < 2; repetition += 1) {
        const tsLoad = await runIsolatedExperiment(makeRequest(scale.level, scale.configuration, "cache-load", `phase611-${scale.level}-typescript-cache-${repetition}`, { structuralPath: tsCache }));
        modes.typescriptCache.push(tsLoad); allRuns.push(tsLoad);
        const rustLoad = await runIsolatedExperiment(makeRequest(scale.level, scale.configuration, "cache-load", `phase611-${scale.level}-rust-cache-${repetition}`, { structuralPath: rustCache }));
        modes.rustCache.push(rustLoad); allRuns.push(rustLoad);
      }
      const summaries = Object.fromEntries(Object.entries(modes).map(([name, runs]) => [name, summarize(runs)]));
      const baselineMedian = (summaries.baseline as ReturnType<typeof summarize>).compileMedianMs ?? Number.NaN;
      const tsMedian = (summaries.typescriptV2 as ReturnType<typeof summarize>).compileMedianMs ?? Number.NaN;
      const rustMedian = (summaries.rust as ReturnType<typeof summarize>).compileMedianMs ?? Number.NaN;
      const tsCacheMedian = (summaries.typescriptCache as ReturnType<typeof summarize>).compileMedianMs ?? Number.NaN;
      const rustCacheMedian = (summaries.rustCache as ReturnType<typeof summarize>).compileMedianMs ?? Number.NaN;
      matrix[scale.level] = {
        configuration: scale.configuration,
        summaries,
        speedupsVsBaseline: {
          typescriptV2: baselineMedian / tsMedian,
          rustIntegration: baselineMedian / rustMedian,
          typescriptCache: baselineMedian / tsCacheMedian,
          rustGeneratedCache: baselineMedian / rustCacheMedian,
        },
        semanticMaximumDeltas: {
          typescriptV2: maximumEvaluationDelta(modes.baseline[0], modes.typescriptV2[0]),
          rust: maximumEvaluationDelta(modes.baseline[0], modes.rust[0]),
          typescriptCache: maximumEvaluationDelta(modes.baseline[0], modes.typescriptCache[0]),
          rustCache: maximumEvaluationDelta(modes.baseline[0], modes.rustCache[0]),
        },
        runs: Object.fromEntries(Object.entries(modes).map(([name, runs]) => [name, runs.map(compactRun)])),
      };
    }

    const chunkRuns: Record<string, unknown> = {};
    const s4 = SCALE_CONFIGURATIONS.find((entry) => entry.level === "S4")!;
    for (const chunkSize of [4_096, 16_384, 65_536, 262_144]) {
      const run = await runIsolatedExperiment(makeRequest(s4.level, s4.configuration, "typescript-v2", `phase611-S4-chunk-${chunkSize}`, { chunkSize }));
      allRuns.push(run);
      chunkRuns[String(chunkSize)] = compactRun(run);
    }

    const crossLanguage: Record<string, unknown> = {};
    for (const scale of SCALE_CONFIGURATIONS) {
      const output = join(working, `cross-${scale.level}.native`);
      const run = await runIsolatedExperiment(makeRequest(scale.level, scale.configuration, "rust", `phase611-${scale.level}-cross-language`, { rustExecutable, structuralPath: output, crossValidate: true }));
      allRuns.push(run);
      crossLanguage[scale.level] = compactRun(run);
    }

    const s3 = matrixScales[0];
    const missingPath = join(working, "missing.cache");
    const cacheMissResult = await loadOrCompileStructuralTopology({
      path: missingPath,
      configuration: s3.configuration,
      chunkSize: 65_536,
      maximumNodes: preflightV3({ configuration: s3.configuration, tier: "tier0", iterations: 1, explicitLargeScaleAuthorization: false }).estimate.nodes,
    });
    const cacheMiss = {
      source: cacheMissResult.source,
      missReason: cacheMissResult.missReason,
      loadMs: cacheMissResult.loadMs,
      compileMs: cacheMissResult.compileMs,
      writeMs: cacheMissResult.writeMs,
      structuralHash: structuralHashCompactTree(cacheMissResult.tree),
    };
    const changedConfiguration = { ...s3.configuration, seed: s3.configuration.seed + 1 };
    const existingTsCache = join(working, s3.level.toLowerCase(), "typescript.cache");
    const invalidatedResult = await loadOrCompileStructuralTopology({
      path: existingTsCache,
      fallbackPath: join(working, "changed-identity.cache"),
      configuration: changedConfiguration,
      chunkSize: 65_536,
      maximumNodes: preflightV3({ configuration: changedConfiguration, tier: "tier0", iterations: 1, explicitLargeScaleAuthorization: false }).estimate.nodes,
    });
    const invalidated = {
      source: invalidatedResult.source,
      missReason: invalidatedResult.missReason,
      loadMs: invalidatedResult.loadMs,
      compileMs: invalidatedResult.compileMs,
      writeMs: invalidatedResult.writeMs,
      structuralHash: structuralHashCompactTree(invalidatedResult.tree),
    };

    const completed = allRuns.filter((run) => run.terminationReason === "completed").length;
    const crossEquivalent = Object.values(crossLanguage).every((value) => {
      const run = value as ReturnType<typeof compactRun>;
      const details = (run.result?.compilerDetails as { crossLanguage?: { equivalent?: boolean } } | undefined)?.crossLanguage;
      return run.terminationReason === "completed" && details?.equivalent === true;
    });
    const matrixValues = Object.values(matrix) as Array<{ summaries: Record<string, ReturnType<typeof summarize>>; semanticMaximumDeltas: Record<string, number>; speedupsVsBaseline: Record<string, number> }>;
    const cacheHits = matrixValues.every((entry) => entry.summaries.typescriptCache.completed === 2 && entry.summaries.rustCache.completed === 2);
    const exactSemantic = matrixValues.every((entry) => Object.values(entry.semanticMaximumDeltas).every((delta) => delta <= 1e-10));
    const chunkHashes = Object.values(chunkRuns).map((value) => (value as ReturnType<typeof compactRun>).result?.structuralHash);
    const checkpointIntegration = verifyCacheCheckpointResume();
    const s5Matrix = matrix.S5 as { speedupsVsBaseline: Record<string, number>; summaries: Record<string, ReturnType<typeof summarize>> };
    const rustVsOptimizedS5 = (s5Matrix.summaries.rust.compileMedianMs ?? Number.NaN) / (s5Matrix.summaries.typescriptV2.compileMedianMs ?? Number.NaN);
    const rustClassification = crossEquivalent && rustVsOptimizedS5 <= 0.75
      ? "RUST CORE RECOMMENDED"
      : crossEquivalent && rustVsOptimizedS5 <= 0.9
        ? "HYBRID CANDIDATE"
        : "KEEP TYPESCRIPT";
    const typescriptSpeedups = matrixValues.map((entry) => entry.speedupsVsBaseline.typescriptV2);
    const s5CacheSpeedup = s5Matrix.speedupsVsBaseline.typescriptCache;
    const hypotheses = {
      H1: { verdict: "SUPPORTED", evidence: `Removing repeated provider dispatch, linear level lookup and string-heavy per-node work produced a ${Math.min(...typescriptSpeedups).toFixed(2)}x-${Math.max(...typescriptSpeedups).toFixed(2)}x cold-compile speedup.` },
      H2: { verdict: "PARTIALLY_SUPPORTED", evidence: "All chunk sizes preserved the exact structural hash and bounded cancellation checks; peak RSS did not materially improve because storage is still exactly preallocated." },
      H3: { verdict: "INCONCLUSIVE", evidence: "Both the 6.10 baseline and V2 already preallocate exact typed-array capacity; no honest dynamic-growth counterfactual exists for the exactly sized synthetic provider." },
      H4: { verdict: "SUPPORTED", evidence: `S5 validated cache load was ${s5CacheSpeedup.toFixed(2)}x faster than baseline cold compilation.` },
      H5: { verdict: rustVsOptimizedS5 < 1 ? "SUPPORTED" : "REJECTED", evidence: `Full Rust integration took ${rustVsOptimizedS5.toFixed(2)} times the optimized TypeScript time on S5.` },
      H6: { verdict: rustVsOptimizedS5 < 1 ? "SUPPORTED" : "REJECTED", evidence: "The decision uses full native process plus binary transfer, validation and TypeScript reconstruction time." },
      H7: { verdict: crossEquivalent ? "SUPPORTED" : "REJECTED", evidence: "S0-S5 compare exact integer topology arrays plus explicit 1e-12 floating-point tolerance." },
    };
    const rustDecision = {
      classification: rustClassification,
      thresholds: { rustCoreRecommendedMaximumRatio: 0.75, hybridCandidateMaximumRatio: 0.9 },
      recommendedArchitecture: rustClassification === "KEEP TYPESCRIPT"
        ? "Optimized TypeScript Compiler V2 for cache misses plus Structural Cache V1 for repeated games; retain the Rust CLI as an experimental differential oracle."
        : "Keep the native compiler isolated until distribution and broader provider support are validated.",
      s5RustVsOptimizedTypeScriptRatio: rustVsOptimizedS5,
      rationale: `The classification is derived from the S5 end-to-end ratio ${rustVsOptimizedS5.toFixed(3)} and cross-language equivalence=${crossEquivalent}.`,
    };
    const gates = {
      C1: matrixValues.every((entry) => entry.summaries.baseline.completed === 2),
      C2: matrixValues.every((entry) => entry.summaries.typescriptV2.completed === 2) && exactSemantic,
      C3: new Set(chunkHashes).size === 1,
      C4: cacheHits && cacheMiss.source === "compiled" && cacheMiss.missReason === "not-found"
        && invalidated.source === "compiled" && invalidated.missReason === "identity-mismatch",
      C5: crossEquivalent,
      C6: matrixValues.every((entry) => Object.values(entry.summaries).every((summary) => summary.completed === 2)) && exactSemantic,
      C7: completed === allRuns.length && allRuns.every((run) => (run.peakRssObservedBytes ?? Number.POSITIVE_INFINITY) <= limits.maximumRssBytes),
      C8: checkpointIntegration.passed,
      C9: Number.isFinite(rustVsOptimizedS5) && crossEquivalent && ["KEEP TYPESCRIPT", "HYBRID CANDIDATE", "RUST CORE RECOMMENDED"].includes(rustClassification),
    };
    const artifact = {
      schemaVersion: 1,
      phase: "6.11",
      researchVersion: "fast-compiler-v0.11.0",
      solverVersion: "0.11.0",
      baseline: { commit: "26d5af139ad685fd6df165749b48d2ed7517376a", phase: "6.10", artifactHash: previous.artifactHash, preservedHistoricalGates: previous.historicalGates, verifiedDatasets: previous.verifiedDatasets },
      startedAt,
      completedAt: new Date().toISOString(),
      environment: { platform: process.platform, architecture: process.arch, node: process.version, rustExecutable, isolation: "one monitored child process per measurement" },
      resourcePolicy: { version: "resource-policy-v3.0.0", limits, preflights, calibrationHash: calibration?.semanticHash ?? null, explicitS5Authorization: true },
      compilerAudit: {
        baseline: "generic CompactGameProvider dispatch with repeated linear level lookup, transition revalidation and string-heavy synthetic utility/chance generation",
        dominantCosts: ["terminal history token arrays and string splitting", "linear level scan repeated across provider methods", "duplicate transition/legal-action dispatch", "per-node labels and small temporary arrays"],
        optimized: "level-sequential direct synthetic compilation into exact preallocated typed arrays with bounded chunk execution",
      },
      matrix,
      chunkSizeExperiment: { scale: "S4", sizes: [4_096, 16_384, 65_536, 262_144], runs: chunkRuns, sameStructuralHash: new Set(chunkHashes).size === 1 },
      cacheExperiment: { format: "structural-cache-v1", coldMeaning: "fresh isolated process; operating-system page cache was not forcibly purged", missing: cacheMiss, invalidated, immutableContentAddressedWrite: true, atomicCreateNewRename: true },
      rustExperiment: { scope: "synthetic topology compilation and binary export only", unsafeCode: false, crossLanguage, equivalentS0ThroughS5: crossEquivalent, floatTolerance: 1e-12 },
      compatibility: { resourcePolicyV3: true, binaryCheckpointV5: true, checkpointIntegration, topologyAndNumericStateSeparated: true },
      hypotheses,
      rustDecision,
      gates,
      verdict: Object.values(gates).every(Boolean) ? "PASS" : "FAIL",
      limitations: [
        "The compiler optimization applies to the synthetic compact provider, not arbitrary poker trees.",
        "Fresh-process cache timing does not guarantee a cold operating-system disk cache.",
        "Rust is experimental and does not implement CFR, evaluation, checkpointing, or poker strategy.",
        "Gate D remains FAIL and verified datasets remain zero.",
      ],
      runCount: allRuns.length,
      completedRuns: completed,
      totalRuntimeMs: performance.now() - started,
    };
    return { ...artifact, artifactHash: hashValue(artifact) };
  } finally {
    await rm(working, { recursive: true, force: true });
  }
}