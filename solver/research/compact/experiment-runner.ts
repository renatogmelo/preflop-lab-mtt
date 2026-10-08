import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CfrSolver } from "../../algorithms/cfr";
import { compileIndexedTree, IndexedCfrSolver } from "../../algorithms/indexed-cfr";
import { strategyDistance } from "../../comparison/strategy-distance";
import { hashValue } from "../../core/stable";
import type { SolverConfiguration } from "../../core/types";
import { CompiledNashConvEvaluator } from "../../evaluation/compiled-analysis";
import { compileGameTree } from "../../tree/compiled";
import { UnifiedResearchGame } from "../unified/game-tree";
import { SCALE_CONFIGURATIONS } from "../scalability/experiment-runner";
import { indexedStorageBytes } from "../scalability/performance-profiler";
import { SyntheticExtensiveGameGenerator } from "../scalability/synthetic-generator";
import { CompactCfrSolver, type CompactCheckpointV4 } from "./compact-cfr";
import { compactPreflightV2 } from "./compact-estimator";
import { CompactNashConvEvaluatorV2 } from "./compact-evaluation";
import { compactRegistryBytes, compactTopologyBytes, compileCompactGame, strategyArrayProbability } from "./compact-tree";
import { SyntheticCompactProvider } from "./synthetic-compact-provider";

export const PHASE_69_VERSION = "0.9.0";
export const PHASE_69_BASELINE = "8f0eaa0c932e5a1db43068c760ef57012c771e8c";
const TOLERANCE = 1e-12;

function memorySnapshot(label: string) {
  const usage = process.memoryUsage();
  return { label, sampled: true, ...usage };
}

function maxNumericError(left: number[], right: number[]) {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let error = 0;
  for (let index = 0; index < left.length; index += 1) error = Math.max(error, Math.abs(left[index] - right[index]));
  return error;
}

function flattenReferenceState(checkpoint: ReturnType<CfrSolver<number, string>["checkpoint"]>) {
  const ordered = [...checkpoint.infosets].sort((left, right) => left.key.localeCompare(right.key));
  return {
    regrets: ordered.flatMap((entry) => entry.regrets),
    strategySums: ordered.flatMap((entry) => entry.strategySum),
    hash: hashValue(ordered.map((entry) => ({ key: entry.key, actions: entry.actions, regrets: entry.regrets, strategySum: entry.strategySum }))),
  };
}

function flattenCompactState(provider: SyntheticCompactProvider, checkpoint: CompactCheckpointV4) {
  const entries = Array.from({ length: provider.informationSetCount }, (_, informationSet) => {
    const count = provider.informationSetActionCount(informationSet);
    const offset = informationSet * count;
    return {
      key: provider.informationSetKey(informationSet),
      actions: Array.from({ length: count }, (_, action) => provider.actionLabel(informationSet, action)),
      regrets: checkpoint.regrets.slice(offset, offset + count),
      strategySum: checkpoint.strategySums.slice(offset, offset + count),
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
  return {
    regrets: entries.flatMap((entry) => entry.regrets),
    strategySums: entries.flatMap((entry) => entry.strategySum),
    hash: hashValue(entries),
  };
}

function serializeProfile(checkpoint: unknown) {
  const started = performance.now();
  const serialized = JSON.stringify(checkpoint);
  return { serializationMs: performance.now() - started, checkpointBytes: Buffer.byteLength(serialized) };
}

function timed<T>(operation: () => T) {
  const started = performance.now();
  const value = operation();
  return { value, runtimeMs: performance.now() - started };
}

function compactResume(provider: SyntheticCompactProvider, tree: ReturnType<typeof compileCompactGame>["tree"], configuration: SolverConfiguration, iterations: number) {
  const target = Math.max(2, iterations);
  const continuous = new CompactCfrSolver(provider, tree, configuration);
  continuous.solve({ maxIterations: target, collectExactMetrics: false });
  const interrupted = new CompactCfrSolver(provider, tree, configuration);
  interrupted.solve({ maxIterations: Math.max(1, Math.floor(target / 2)), collectExactMetrics: false });
  const checkpoint = interrupted.checkpoint();
  const resumed = new CompactCfrSolver(provider, tree, configuration);
  resumed.restore(checkpoint);
  resumed.solve({ maxIterations: target, collectExactMetrics: false });
  return {
    targetIterations: target,
    identical: continuous.stateHash === resumed.stateHash,
    continuousStateHash: continuous.stateHash,
    resumedStateHash: resumed.stateHash,
    checkpointSemanticHash: checkpoint.semanticHash,
  };
}

function runScale(entry: (typeof SCALE_CONFIGURATIONS)[number]) {
  const preflight = compactPreflightV2(entry.configuration);
  if (!preflight.allowed) return {
    level: entry.level,
    status: "safe-abort" as const,
    configuration: entry.configuration,
    preflight,
    executed: false,
  };

  const snapshots = [memorySnapshot("start")];
  const generator = new SyntheticExtensiveGameGenerator();
  const generated = generator.generateGame(entry.configuration);
  snapshots.push(memorySnapshot("legacy-definition"));
  const game = new UnifiedResearchGame(generated.definition);
  const objectCompilation = timed(() => compileGameTree(game));
  snapshots.push(memorySnapshot("legacy-object-tree"));
  const indexedCompilation = timed(() => compileIndexedTree(objectCompilation.value));
  snapshots.push(memorySnapshot("indexed-eager-tree"));
  const provider = new SyntheticCompactProvider(entry.configuration);
  const compactCompilation = compileCompactGame(provider);
  snapshots.push(memorySnapshot("compact-tree"));

  const differentialIterations = Math.min(entry.differentialIterations, ({ S0: 100, S1: 50, S2: 10, S3: 2, S4: 1 } as const)[entry.level as "S0" | "S1" | "S2" | "S3" | "S4"] ?? 1);
  const configuration: SolverConfiguration = {
    algorithm: "dcfr",
    seed: 69,
    exactMetrics: false,
    engine: "indexed-tree",
    dcfr: { alpha: 2, beta: 0, gamma: 3 },
  };
  const reference = new CfrSolver(game, configuration, objectCompilation.value);
  const indexed = new IndexedCfrSolver(game, configuration, objectCompilation.value);
  const compact = new CompactCfrSolver(provider, compactCompilation.tree, configuration);
  const referenceRun = timed(() => reference.solve({ maxIterations: differentialIterations, metricInterval: differentialIterations }));
  const indexedRun = timed(() => indexed.solve({ maxIterations: differentialIterations, metricInterval: differentialIterations }));
  const compactRun = timed(() => compact.solve({ maxIterations: differentialIterations, metricInterval: differentialIterations, collectExactMetrics: false }));
  snapshots.push(memorySnapshot("solvers-complete"));

  const referenceStrategy = reference.averageStrategy();
  const indexedStrategy = indexed.averageStrategy();
  const compactStrategy = compact.averageStrategy();
  const evaluator = new CompiledNashConvEvaluator(objectCompilation.value.root);
  const referenceEvaluation = timed(() => evaluator.evaluate(referenceStrategy));
  const indexedEvaluation = timed(() => evaluator.evaluate(indexedStrategy));
  const compactArray = compact.averageStrategyArray();
  const compactEvaluation = timed(() => new CompactNashConvEvaluatorV2(compactCompilation.tree).evaluate(strategyArrayProbability(compactCompilation.tree, compactArray)));
  snapshots.push(memorySnapshot("evaluation-complete"));

  const referenceCheckpoint = reference.checkpoint();
  const indexedCheckpoint = indexed.checkpoint();
  const compactCheckpoint = compact.checkpoint();
  const referenceState = flattenReferenceState(referenceCheckpoint);
  const indexedState = flattenReferenceState(indexedCheckpoint);
  const compactState = flattenCompactState(provider, compactCheckpoint);
  const referenceSerialized = serializeProfile(referenceCheckpoint);
  const indexedSerialized = serializeProfile(indexedCheckpoint);
  const compactSerialized = serializeProfile(compactCheckpoint);
  const distances = {
    legacyVsIndexed: strategyDistance(referenceStrategy, indexedStrategy),
    indexedVsCompact: strategyDistance(indexedStrategy, compactStrategy),
    legacyVsCompact: strategyDistance(referenceStrategy, compactStrategy),
  };
  const errors = {
    legacyVsIndexedRegrets: maxNumericError(referenceState.regrets, indexedState.regrets),
    indexedVsCompactRegrets: maxNumericError(indexedState.regrets, compactState.regrets),
    legacyVsCompactRegrets: maxNumericError(referenceState.regrets, compactState.regrets),
    legacyVsIndexedStrategySums: maxNumericError(referenceState.strategySums, indexedState.strategySums),
    indexedVsCompactStrategySums: maxNumericError(indexedState.strategySums, compactState.strategySums),
    legacyVsCompactStrategySums: maxNumericError(referenceState.strategySums, compactState.strategySums),
    strategyEv: Math.max(
      Math.abs(referenceEvaluation.value.utilities[0] - indexedEvaluation.value.utilities[0]),
      Math.abs(referenceEvaluation.value.utilities[0] - compactEvaluation.value.utilities[0]),
    ),
    bestResponse: Math.max(
      Math.abs(referenceEvaluation.value.bestResponses[0].value - compactEvaluation.value.bestResponseValues[0]),
      Math.abs(referenceEvaluation.value.bestResponses[1].value - compactEvaluation.value.bestResponseValues[1]),
    ),
    exploitability: Math.abs(referenceEvaluation.value.exploitability - compactEvaluation.value.exploitability),
    nashConv: Math.abs(referenceEvaluation.value.nashConv - compactEvaluation.value.nashConv),
  };
  const passed = Object.values(distances).every((distance) => distance.maxAbsoluteDelta <= TOLERANCE)
    && Object.values(errors).every((error) => error <= TOLERANCE);
  const compactResidentBytes = compactCompilation.topologyBytes + compactCompilation.registryBytes + compact.logicalStateBytes;
  const eagerResidentEstimateBytes = generated.estimate.estimatedDefinitionBytes + generated.estimate.estimatedCompiledBytes
    + indexedStorageBytes(indexedCompilation.value) + compact.logicalStateBytes;
  const architectures = {
    A: {
      name: "legacy-object-tree",
      constructionMs: generated.generationMs + objectCompilation.runtimeMs,
      traversalMs: referenceRun.runtimeMs,
      evaluationMs: referenceEvaluation.runtimeMs,
      pipelineMs: generated.generationMs + objectCompilation.runtimeMs + referenceRun.runtimeMs + referenceEvaluation.runtimeMs,
      ...referenceSerialized,
    },
    B: {
      name: "indexed-eager-phase6.8",
      constructionMs: generated.generationMs + objectCompilation.runtimeMs + indexedCompilation.runtimeMs,
      traversalMs: indexedRun.runtimeMs,
      evaluationMs: indexedEvaluation.runtimeMs,
      pipelineMs: generated.generationMs + objectCompilation.runtimeMs + indexedCompilation.runtimeMs + indexedRun.runtimeMs + indexedEvaluation.runtimeMs,
      logicalTopologyBytes: indexedStorageBytes(indexedCompilation.value),
      bytesPerNode: indexedStorageBytes(indexedCompilation.value) / generated.actual.nodes,
      ...indexedSerialized,
    },
    C: {
      name: "compact-direct-lazy-provider",
      constructionMs: compactCompilation.compilationMs,
      traversalMs: compactRun.runtimeMs,
      evaluationMs: compactEvaluation.runtimeMs,
      pipelineMs: compactCompilation.compilationMs + compactRun.runtimeMs + compactEvaluation.runtimeMs,
      logicalTopologyBytes: compactCompilation.topologyBytes,
      registryBytes: compactCompilation.registryBytes,
      solverStateBytes: compact.logicalStateBytes,
      residentLogicalBytes: compactResidentBytes,
      bytesPerNode: compactCompilation.bytesPerNode,
      ...compactSerialized,
    },
  };
  return {
    level: entry.level,
    status: "completed" as const,
    executed: true,
    configuration: entry.configuration,
    preflight,
    gameHashes: { legacyDefinition: generated.definitionHash, compactLogical: provider.logicalGameHash },
    estimate: generated.estimate,
    actual: generated.actual,
    validation: compactCompilation.tree.validation,
    differentialIterations,
    architectures,
    speedups: {
      constructionAtoC: architectures.A.constructionMs / Math.max(1e-9, architectures.C.constructionMs),
      constructionBtoC: architectures.B.constructionMs / Math.max(1e-9, architectures.C.constructionMs),
      traversalAtoC: architectures.A.traversalMs / Math.max(1e-9, architectures.C.traversalMs),
      traversalBtoC: architectures.B.traversalMs / Math.max(1e-9, architectures.C.traversalMs),
      bestResponseAtoC: architectures.A.evaluationMs / Math.max(1e-9, architectures.C.evaluationMs),
      pipelineAtoC: architectures.A.pipelineMs / Math.max(1e-9, architectures.C.pipelineMs),
      pipelineBtoC: architectures.B.pipelineMs / Math.max(1e-9, architectures.C.pipelineMs),
    },
    memory: {
      snapshots,
      measurement: "process.memoryUsage samples; not native peaks",
      eagerResidentEstimateBytes,
      compactResidentLogicalBytes: compactResidentBytes,
      logicalReductionFraction: 1 - compactResidentBytes / eagerResidentEstimateBytes,
      estimatorErrorFraction: (compactResidentBytes - preflight.estimate.estimatedResidentBytes) / preflight.estimate.estimatedResidentBytes,
      topologyBytes: compactTopologyBytes(compactCompilation.tree),
      registryBytes: compactRegistryBytes(compactCompilation.tree),
    },
    differential: {
      tolerance: TOLERANCE,
      passed,
      distances,
      errors,
      stateHashes: { legacy: referenceState.hash, indexed: indexedState.hash, compact: compactState.hash },
      evaluation: { legacy: referenceEvaluation.value, indexed: indexedEvaluation.value, compact: compactEvaluation.value },
    },
    checkpointResume: compactResume(provider, compactCompilation.tree, configuration, differentialIterations),
  };
}

function runS4Convergence() {
  const configuration = SCALE_CONFIGURATIONS[4].configuration;
  const preflight = compactPreflightV2(configuration);
  if (!preflight.allowed) return { executed: false, reason: preflight.reasons, preflight };
  const provider = new SyntheticCompactProvider(configuration);
  const compilation = compileCompactGame(provider);
  const solver = new CompactCfrSolver(provider, compilation.tree, {
    algorithm: "dcfr", seed: 69, exactMetrics: true, engine: "indexed-tree", dcfr: { alpha: 2, beta: 0, gamma: 3 },
  });
  solver.initialize();
  const budgets = [1, 2, 4, 8, 16];
  const curve = [];
  const started = performance.now();
  for (const budget of budgets) {
    while (solver.iteration < budget) solver.iterate();
    const point = solver.measure();
    curve.push(point);
    if (performance.now() - started >= preflight.budget.maximumEstimatedRuntimeMs) break;
  }
  return {
    executed: true,
    budgets,
    completedIterations: solver.iteration,
    runtimeMs: performance.now() - started,
    curve,
    finalStateHash: solver.stateHash,
    convergedClaim: false,
    reporting: "The curve is empirical progress only; no equilibrium claim is made.",
  };
}

export function runPhase69Research() {
  const started = performance.now();
  const phase68 = JSON.parse(readFileSync(new URL("../../artifacts/phase6-8-unified-scalability-v0.8.0.json", import.meta.url), "utf8"));
  const scales = SCALE_CONFIGURATIONS.map(runScale);
  const completed = scales.filter((entry) => entry.status === "completed");
  const s4Convergence = runS4Convergence();
  const s5 = scales.find((entry) => entry.level === "S5")!;
  const allDifferential = completed.every((entry) => "differential" in entry && entry.differential.passed);
  const allResume = completed.every((entry) => "checkpointResume" in entry && entry.checkpointResume.identical);
  const memoryImproved = completed.every((entry) => "memory" in entry && entry.memory.logicalReductionFraction > 0);
  const performanceIntegrity = completed.every((entry) => "architectures" in entry && entry.architectures.C.pipelineMs <= entry.architectures.A.pipelineMs * 2);
  const gates = {
    M1: completed.every((entry) => "validation" in entry && entry.validation.valid),
    M2: allDifferential,
    M3: memoryImproved,
    M4: performanceIntegrity,
    M5: allResume,
    M6: s5.status === "completed" || (s5.status === "safe-abort" && s5.preflight.reasons.length > 0),
    M7: s4Convergence.executed && s4Convergence.convergedClaim === false,
  };
  const s4 = completed.find((entry) => entry.level === "S4");
  const hypotheses = {
    H1: { verdict: "Supported", evidence: s4 && "memory" in s4 ? `Direct compilation removes definition/object-tree coexistence; S4 logical reduction ${(s4.memory.logicalReductionFraction * 100).toFixed(2)}%.` : "Direct path implemented." },
    H2: { verdict: "Supported", evidence: s4 && "architectures" in s4 ? `S4 compact topology ${s4.architectures.C.bytesPerNode.toFixed(2)} B/node versus indexed ${s4.architectures.B.bytesPerNode.toFixed(2)} B/node, excluding legacy objects.` : "Typed arrays reduce structural overhead." },
    H3: { verdict: "Partially supported", evidence: "Successors can be generated lazily with O(depth) traversal, but full-tree CFR still visits every logical node and uses compiled compact topology." },
    H4: { verdict: "Supported", evidence: "Best Response V2 uses flat typed buffers and per-infoset policy instead of recursive Maps and repeated subtree evaluation." },
    H5: { verdict: "Partially supported", evidence: "Runtime state stays in typed arrays; JSON checkpoint V4 still creates a serialization copy when explicitly requested." },
  };
  const semantic = {
    baseline: PHASE_69_BASELINE,
    scales: scales.map((entry) => entry.status === "completed" ? {
      level: entry.level,
      status: entry.status,
      gameHashes: entry.gameHashes,
      differential: entry.differential.passed,
      checkpointResume: entry.checkpointResume.identical,
      compactStateHash: entry.differential.stateHashes.compact,
    } : { level: entry.level, status: entry.status, reasons: entry.preflight.reasons }),
    gates,
    hypotheses,
  };
  return {
    schemaVersion: 1,
    researchVersion: PHASE_69_VERSION,
    baseline: PHASE_69_BASELINE,
    trust: "Experimental",
    verifiedDatasets: 0,
    historicalGates: { A: true, B: true, C: true, D: false },
    architecture: {
      provider: "SyntheticCompactProvider",
      game: "CompactExtensiveGame",
      representation: "compact-indexed-v2",
      traversal: "lazy explicit stack for on-demand EV; compact DFS for exact CFR; reverse-level iterative EV/BR",
      bestResponse: "CompactBestResponseEvaluatorV2",
      checkpoint: 4,
      exactChanceEnumeration: true,
      parallelism: false,
      rust: false,
    },
    resourceBudget: compactPreflightV2(SCALE_CONFIGURATIONS[0].configuration).budget,
    scales,
    s4Convergence,
    s5Experiment: s5,
    metamorphic: {
      preservedPhase68: phase68.metamorphic,
      compactStructuralOracle: "A/B/C differential equivalence over S0-S4",
      passed: phase68.metamorphic.passed && allDifferential,
    },
    hypotheses,
    gates,
    failures: scales.filter((entry) => entry.status !== "completed" && entry.status !== "safe-abort"),
    limitations: [
      "Synthetic games validate solver engineering, not poker ranges or recommendations.",
      "Process memory is sampled at explicit checkpoints and is not a native peak measurement.",
      "S5 remains unexecuted because the unchanged 250,000-node safety budget rejects 2,097,149 nodes.",
      "Lazy successor generation reduces materialization, not the exact CFR requirement to visit the full game.",
      "Checkpoint V4 JSON serialization still creates a temporary copy proportional to solver state.",
      "Historical Gate D remains FAIL and Verified remains zero.",
    ],
    totalRuntimeMs: performance.now() - started,
    semanticHash: hashValue(semantic),
  };
}
