import { performance } from "node:perf_hooks";
import { CfrSolver } from "../../algorithms/cfr";
import { compileIndexedTree, IndexedCfrSolver, type IndexedCompiledTree } from "../../algorithms/indexed-cfr";
import { strategyDistance } from "../../comparison/strategy-distance";
import { hashValue } from "../../core/stable";
import type { AlgorithmName, BehavioralStrategy, SolverConfiguration } from "../../core/types";
import { CompiledNashConvEvaluator, evaluateCompiledNode } from "../../evaluation/compiled-analysis";
import { compileGameTree, type CompiledGameTree } from "../../tree/compiled";
import type { UnifiedResearchGame } from "../unified/game-tree";
import { createResearchCheckpointV3, semanticSolverCheckpoint, validateResearchCheckpointV3 } from "./checkpoint-v3";
import type { ResearchResourceBudget } from "./resource-safety";
import type { TreeSizeEstimate } from "./tree-size-estimator";

export const SCALABILITY_ALGORITHM_VERSION = "scalability-benchmark-v0.8.0";

export function indexedStorageBytes<Action extends string>(tree: IndexedCompiledTree<Action>) {
  return tree.kind.byteLength + tree.actor.byteLength + tree.firstEdge.byteLength + tree.edgeCount.byteLength
    + tree.edgeChild.byteLength + tree.edgeProbability.byteLength + tree.informationSet.byteLength
    + tree.terminalP0.byteLength + tree.terminalP1.byteLength;
}

export function compileWithProfile(game: UnifiedResearchGame) {
  const objectStarted = performance.now();
  const compiled = compileGameTree(game);
  const objectCompileMs = performance.now() - objectStarted;
  const indexedStarted = performance.now();
  const indexed = compileIndexedTree(compiled);
  const indexedCompileMs = performance.now() - indexedStarted;
  return {
    compiled,
    indexed,
    objectCompileMs,
    indexedCompileMs,
    indexedStorageBytes: indexedStorageBytes(indexed),
    bytesPerNode: indexedStorageBytes(indexed) / compiled.statistics.nodes,
  };
}

function semanticStrategyHash(strategy: BehavioralStrategy) { return hashValue(strategy); }

function kernelProfile(operations: number) {
  const measuredOperations = Math.max(1, Math.min(operations, 2_000_000));
  const regrets = new Float64Array(1024);
  const utilities = new Float64Array(1024);
  utilities.fill(0.125);
  let started = performance.now();
  for (let index = 0; index < measuredOperations; index += 1) {
    const offset = index & 1023;
    regrets[offset] += utilities[offset] - 0.0625;
  }
  const regretMeasuredMs = performance.now() - started;
  const sums = new Float64Array(1024);
  started = performance.now();
  for (let index = 0; index < measuredOperations; index += 1) sums[index & 1023] += 0.5;
  const accumulationMeasuredMs = performance.now() - started;
  const scale = operations / measuredOperations;
  return {
    method: "calibrated-numeric-kernel-estimate" as const,
    operations,
    measuredOperations,
    regretUpdateEstimatedMs: regretMeasuredMs * scale,
    strategyAccumulationEstimatedMs: accumulationMeasuredMs * scale,
    warning: "Kernel estimates are not additive wall-clock attribution and exclude tree traversal/cache effects.",
  };
}

export type AlgorithmRun = ReturnType<typeof runIndexedAlgorithm>;

export function runIndexedAlgorithm(
  game: UnifiedResearchGame,
  compiled: CompiledGameTree<string>,
  estimate: TreeSizeEstimate,
  algorithm: AlgorithmName,
  budgets: readonly number[],
  resourceBudget: ResearchResourceBudget,
) {
  const configuration: SolverConfiguration = {
    algorithm,
    seed: 68,
    exactMetrics: true,
    engine: "indexed-tree",
    ...(algorithm === "dcfr" ? { dcfr: { alpha: 2, beta: 0, gamma: 3 } } : {}),
    ...(algorithm === "cfr-plus" ? { cfrPlusAveragingDelay: 0 } : {}),
  };
  const constructionStarted = performance.now();
  const solver = new IndexedCfrSolver(game, configuration, compiled);
  const constructionMs = performance.now() - constructionStarted;
  const heapBeforeBytes = process.memoryUsage().heapUsed;
  let peakHeapBytes = heapBeforeBytes;
  const curve: Array<{
    iteration: number;
    cumulativeRuntimeMs: number;
    incrementalRuntimeMs: number;
    nodesVisited: number;
    exploitability: number | null;
    nashConv: number | null;
    averagePositiveRegret: number;
    stoppedBy: string;
  }> = [];
  let previousRuntime = 0;
  const solveStarted = performance.now();
  for (const budget of budgets) {
    if (budget > resourceBudget.maximumIterations) break;
    const result = solver.solve({ maxIterations: budget, metricInterval: Math.max(1, budget), maxRuntimeMs: resourceBudget.maximumRuntimeMs });
    const cumulativeRuntimeMs = performance.now() - solveStarted;
    peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    curve.push({
      iteration: result.metrics.iteration,
      cumulativeRuntimeMs,
      incrementalRuntimeMs: cumulativeRuntimeMs - previousRuntime,
      nodesVisited: result.metrics.nodesVisited,
      exploitability: result.metrics.exploitability,
      nashConv: result.metrics.nashConv,
      averagePositiveRegret: result.metrics.averagePositiveRegret,
      stoppedBy: result.metrics.stoppedBy,
    });
    previousRuntime = cumulativeRuntimeMs;
    if (result.metrics.stoppedBy === "runtime") break;
  }
  const traversalRuntimeMs = performance.now() - solveStarted;
  const strategy = solver.averageStrategy();
  const evaluationStarted = performance.now();
  const evaluation = new CompiledNashConvEvaluator(compiled.root).evaluate(strategy);
  const bestResponseEvaluationMs = performance.now() - evaluationStarted;
  const checkpointStarted = performance.now();
  const rawCheckpoint = solver.checkpoint();
  const checkpoint = createResearchCheckpointV3(rawCheckpoint);
  const checkpointMs = performance.now() - checkpointStarted;
  const serializationStarted = performance.now();
  const serializedCheckpoint = JSON.stringify(checkpoint);
  const serializationMs = performance.now() - serializationStarted;
  const iterations = rawCheckpoint.iteration;
  const numericOperations = estimate.decisionNodes * estimate.informationSets / Math.max(1, estimate.informationSets) * estimate.nodes / Math.max(1, estimate.nodes)
    * estimate.traversalNodesPerIteration / Math.max(1, estimate.nodes * 2) * 2 * iterations;
  const actionOperations = Math.round(estimate.decisionNodes * 2 * iterations);
  return {
    algorithm,
    configuration,
    configurationHash: hashValue(configuration),
    strategyHash: semanticStrategyHash(strategy),
    strategy,
    evaluation,
    curve,
    final: curve.at(-1)!,
    performance: {
      constructionMs,
      traversalRuntimeMs,
      bestResponseEvaluationMs,
      checkpointMs,
      serializationMs,
      iterationsPerSecond: iterations / Math.max(1e-9, traversalRuntimeMs / 1000),
      nodesPerSecond: rawCheckpoint.nodesVisited / Math.max(1e-9, traversalRuntimeMs / 1000),
      heapBeforeBytes,
      heapAfterBytes: process.memoryUsage().heapUsed,
      peakObservedHeapBytes: peakHeapBytes,
      checkpointBytes: Buffer.byteLength(serializedCheckpoint),
      garbageCollectionMs: null,
      garbageCollectionMeasurement: "global.gc unavailable/not forced",
      regretAndAccumulation: kernelProfile(Math.max(actionOperations, Math.round(numericOperations))),
    },
    checkpoint: {
      schemaVersion: checkpoint.schemaVersion,
      structuralRepresentationVersion: checkpoint.structuralRepresentationVersion,
      semanticHash: checkpoint.semanticHash,
      valid: validateResearchCheckpointV3(checkpoint).valid,
    },
    rawCheckpoint,
  };
}

export function differentialReferenceVsIndexed(game: UnifiedResearchGame, compiled: CompiledGameTree<string>, algorithm: AlgorithmName, iterations: number) {
  const configuration: SolverConfiguration = {
    algorithm,
    seed: 68,
    exactMetrics: false,
    ...(algorithm === "dcfr" ? { dcfr: { alpha: 2, beta: 0, gamma: 3 } } : {}),
  };
  const reference = new CfrSolver(game, configuration, compiled);
  const optimized = new IndexedCfrSolver(game, configuration, compiled);
  let started = performance.now();
  const referenceResult = reference.solve({ maxIterations: iterations, metricInterval: iterations });
  const referenceRuntimeMs = performance.now() - started;
  started = performance.now();
  const optimizedResult = optimized.solve({ maxIterations: iterations, metricInterval: iterations });
  const optimizedRuntimeMs = performance.now() - started;
  const referenceCheckpoint = reference.checkpoint();
  const optimizedCheckpoint = optimized.checkpoint();
  const referenceRegrets = referenceCheckpoint.infosets.map((informationSet) => ({ key: informationSet.key, values: informationSet.regrets }));
  const optimizedRegrets = optimizedCheckpoint.infosets.map((informationSet) => ({ key: informationSet.key, values: informationSet.regrets }));
  const referenceStrategySums = referenceCheckpoint.infosets.map((informationSet) => ({ key: informationSet.key, values: informationSet.strategySum }));
  const optimizedStrategySums = optimizedCheckpoint.infosets.map((informationSet) => ({ key: informationSet.key, values: informationSet.strategySum }));
  const distance = strategyDistance(referenceResult.strategy, optimizedResult.strategy);
  const referenceUtilities = evaluateCompiledNode(compiled.root, referenceResult.strategy);
  const optimizedUtilities = evaluateCompiledNode(compiled.root, optimizedResult.strategy);
  const referenceEvaluation = new CompiledNashConvEvaluator(compiled.root).evaluate(referenceResult.strategy);
  const optimizedEvaluation = new CompiledNashConvEvaluator(compiled.root).evaluate(optimizedResult.strategy);
  return {
    algorithm,
    iterations,
    tolerance: 1e-12,
    passed: distance.maxAbsoluteDelta <= 1e-12
      && Math.max(...referenceUtilities.map((value, index) => Math.abs(value - optimizedUtilities[index]))) <= 1e-12
      && Math.abs(referenceEvaluation.nashConv - optimizedEvaluation.nashConv) <= 1e-12
      && hashValue(referenceRegrets) === hashValue(optimizedRegrets)
      && hashValue(referenceStrategySums) === hashValue(optimizedStrategySums),
    strategyDistance: distance,
    utilities: { reference: referenceUtilities, optimized: optimizedUtilities },
    nashConv: { reference: referenceEvaluation.nashConv, optimized: optimizedEvaluation.nashConv },
    exploitability: { reference: referenceEvaluation.exploitability, optimized: optimizedEvaluation.exploitability },
    checkpointStateHash: { reference: hashValue(referenceCheckpoint.infosets), optimized: hashValue(optimizedCheckpoint.infosets) },
    regretHash: { reference: hashValue(referenceRegrets), optimized: hashValue(optimizedRegrets) },
    strategySumHash: { reference: hashValue(referenceStrategySums), optimized: hashValue(optimizedStrategySums) },
    runtime: { referenceRuntimeMs, optimizedRuntimeMs, speedup: referenceRuntimeMs / Math.max(1e-9, optimizedRuntimeMs) },
  };
}

export function verifyIndexedCheckpointResume(game: UnifiedResearchGame, compiled: CompiledGameTree<string>, iterations: number) {
  const configuration: SolverConfiguration = { algorithm: "dcfr", seed: 68, exactMetrics: false, dcfr: { alpha: 2, beta: 0, gamma: 3 }, engine: "indexed-tree" };
  const continuous = new IndexedCfrSolver(game, configuration, compiled);
  continuous.solve({ maxIterations: iterations, metricInterval: Math.max(1, Math.floor(iterations / 2)) });
  const partial = new IndexedCfrSolver(game, configuration, compiled);
  partial.solve({ maxIterations: Math.floor(iterations / 2), metricInterval: Math.max(1, Math.floor(iterations / 2)) });
  const envelope = createResearchCheckpointV3(partial.checkpoint());
  const resumed = new IndexedCfrSolver(game, configuration, compiled);
  resumed.restore(envelope.solver);
  resumed.solve({ maxIterations: iterations, metricInterval: Math.max(1, Math.floor(iterations / 2)) });
  const continuousCheckpoint = continuous.checkpoint();
  const resumedCheckpoint = resumed.checkpoint();
  return {
    identicalStrategy: hashValue(continuous.averageStrategy()) === hashValue(resumed.averageStrategy()),
    identicalCheckpoint: hashValue(semanticSolverCheckpoint(continuousCheckpoint)) === hashValue(semanticSolverCheckpoint(resumedCheckpoint)),
    continuousStrategyHash: hashValue(continuous.averageStrategy()),
    resumedStrategyHash: hashValue(resumed.averageStrategy()),
    envelopeValid: validateResearchCheckpointV3(envelope).valid,
    envelopeHash: envelope.semanticHash,
  };
}
