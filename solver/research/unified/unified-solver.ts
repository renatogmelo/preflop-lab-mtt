import { performance } from "node:perf_hooks";
import { Dcfr } from "../../algorithms/cfr";
import { hashValue } from "../../core/stable";
import { NashConvEvaluator } from "../../evaluation/best-response";
import type { UnifiedResearchGame } from "./game-tree";

export const UNIFIED_ALGORITHM_VERSION = "unified-cfr-dcfr-v0.7.0";

export type UnifiedSolveConfiguration = {
  iterations: number;
  metricInterval?: number;
  seed?: number;
};

export function solveUnifiedGame(game: UnifiedResearchGame, configuration: UnifiedSolveConfiguration) {
  const solver = new Dcfr(game, { seed: configuration.seed ?? 67, exactMetrics: true, engine: "indexed-tree", dcfr: { alpha: 2, beta: 0, gamma: 3 } });
  const beforeMemory = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = solver.solve({ maxIterations: configuration.iterations, metricInterval: configuration.metricInterval ?? Math.max(1, Math.floor(configuration.iterations / 10)) });
  const runtimeMs = performance.now() - started;
  const evaluator = new NashConvEvaluator(game);
  const strategyEvaluationStarted = performance.now();
  const utilities = evaluator.strategyEvaluator.evaluate(result.strategy);
  const strategyEvaluationRuntimeMs = performance.now() - strategyEvaluationStarted;
  const bestResponseStarted = performance.now();
  const bestResponses = [evaluator.bestResponseEvaluator.evaluate(0, result.strategy), evaluator.bestResponseEvaluator.evaluate(1, result.strategy)] as const;
  const bestResponseRuntimeMs = performance.now() - bestResponseStarted;
  const nashConv = bestResponses[0].value + bestResponses[1].value;
  const evaluation = { utilities, bestResponses, nashConv, exploitability: nashConv / 2 };
  const evaluationRuntimeMs = strategyEvaluationRuntimeMs + bestResponseRuntimeMs;
  const checkpoint = solver.checkpoint();
  return {
    approach: "unified" as const,
    algorithmVersion: UNIFIED_ALGORITHM_VERSION,
    configuration,
    configurationHash: hashValue({ algorithmVersion: UNIFIED_ALGORITHM_VERSION, configuration }),
    gameHash: solver.gameDefinitionHash,
    experimentId: hashValue({ game: solver.gameDefinitionHash, configuration, approach: "unified" }),
    strategyHash: hashValue(result.strategy),
    checkpointHash: hashValue({ ...checkpoint, createdAt: undefined, convergenceHistory: checkpoint.convergenceHistory.map((point) => ({ ...point, elapsedMs: undefined })) }),
    strategy: result.strategy,
    metrics: result.metrics,
    evaluation,
    performance: {
      runtimeMs,
      millisecondsPerIteration: runtimeMs / Math.max(1, result.metrics.iteration),
      nodesVisited: result.metrics.nodesVisited,
      informationSets: result.metrics.infosets,
      heapUsedBeforeBytes: beforeMemory,
      heapUsedAfterBytes: process.memoryUsage().heapUsed,
      heapDeltaBytes: process.memoryUsage().heapUsed - beforeMemory,
      evaluationRuntimeMs,
      strategyEvaluationRuntimeMs,
      bestResponseRuntimeMs,
    },
    checkpoint,
  };
}

export function verifyUnifiedCheckpointResume(game: UnifiedResearchGame, iterations = 1000) {
  const configuration = { seed: 67, exactMetrics: true, engine: "indexed-tree" as const, dcfr: { alpha: 2, beta: 0, gamma: 3 } };
  const continuous = new Dcfr(game, configuration);
  continuous.solve({ maxIterations: iterations, metricInterval: Math.max(1, Math.floor(iterations / 2)) });
  const interrupted = new Dcfr(game, configuration);
  interrupted.solve({ maxIterations: Math.floor(iterations / 2), metricInterval: Math.max(1, Math.floor(iterations / 2)) });
  const checkpoint = interrupted.checkpoint();
  const resumed = new Dcfr(game, configuration);
  resumed.restore(checkpoint);
  resumed.solve({ maxIterations: iterations, metricInterval: Math.max(1, Math.floor(iterations / 2)) });
  const continuousStrategy = continuous.averageStrategy();
  const resumedStrategy = resumed.averageStrategy();
  return {
    identical: hashValue(continuousStrategy) === hashValue(resumedStrategy),
    continuousStrategyHash: hashValue(continuousStrategy),
    resumedStrategyHash: hashValue(resumedStrategy),
    checkpointHash: hashValue({ ...checkpoint, createdAt: undefined, convergenceHistory: checkpoint.convergenceHistory.map((point) => ({ ...point, elapsedMs: undefined })) }),
  };
}
