import { CfrPlus, Dcfr, VanillaCfr } from "../algorithms/cfr";
import { IndexedCfrSolver } from "../algorithms/indexed-cfr";
import { hashValue, stableStringify } from "../core/stable";
import { SOLVER_VERSION } from "../core/version";
import type {
  AlgorithmName,
  BehavioralStrategy,
  ExtensiveGame,
  SolverAlgorithm,
  SolverCheckpoint,
  SolverConfiguration,
} from "../core/types";
import {
  CompiledBestResponseEvaluator,
  compiledInformationSetReach,
  counterfactualActionDiagnostics,
  evaluateCompiledNode,
  strategyStability,
  type CounterfactualActionDiagnostic,
  type StrategyStabilityMetrics,
} from "../evaluation/compiled-analysis";
import { strategyDistance } from "../comparison/strategy-distance";
import { compileGameTree, type CompiledGameTree } from "../tree/compiled";

export const PHASE6_EXPLOITABILITY_THRESHOLDS = {
  T0: 0.25,
  T1: 0.10,
  T2: 0.05,
  T3: 0.02,
  T4: 0.01,
  T5: 0.005,
  T6: 0.001,
} as const;

export type ConvergenceCheckpoint = {
  iterations: number;
  runtimeMs: number;
  traversalMs: number;
  iterationsPerSecond: number;
  evP0: number;
  evP1: number;
  nashConv: number;
  exploitability: number;
  averagePositiveRegret: number;
  strategyDelta: StrategyStabilityMetrics | null;
  infosets: number;
  nodesVisited: number;
  heapUsedBytes: number;
  heapDeltaBytes: number;
  strategyEvaluationMs: number;
  bestResponseEvaluationMs: number;
  diagnosticMs: number;
  strategyHash: string;
};

export type ThresholdAchievement = {
  threshold: number;
  firstMeasuredIteration: number;
  runtimeMs: number;
  heapUsedBytes: number;
  algorithm: AlgorithmName;
  seed: number;
};

export type Phase6SolverCheckpoint = {
  schemaVersion: 1;
  solverVersion: string;
  referenceGameId: string;
  gameDefinitionHash: string;
  configuration: SolverConfiguration;
  solver: SolverCheckpoint;
  convergenceHistory: ConvergenceCheckpoint[];
  lastStrategy: BehavioralStrategy;
};

export type ConvergenceExperimentOptions = {
  referenceGameId: string;
  configuration: SolverConfiguration;
  budgets: number[];
  targetExploitability?: number;
  maximumRuntimeMs?: number;
  maximumHeapBytes?: number;
  plateau?: { checkpoints: number; minimumImprovement: number };
  activeReachThreshold?: number;
  resume?: Phase6SolverCheckpoint;
};

export type ConvergenceExperimentResult = {
  referenceGameId: string;
  gameDefinitionHash: string;
  solverVersion: string;
  configuration: SolverConfiguration;
  tree: CompiledGameTree<string>["statistics"];
  history: ConvergenceCheckpoint[];
  thresholds: Record<string, ThresholdAchievement | null>;
  stoppedBy: "iterations" | "target-exploitability" | "runtime" | "memory" | "plateau";
  finalStrategy: BehavioralStrategy;
  finalCounterfactualDiagnostics: CounterfactualActionDiagnostic[];
  checkpoint: Phase6SolverCheckpoint;
  profiling: {
    compileMs: number;
    traversalMs: number;
    strategyEvaluationMs: number;
    bestResponseEvaluationMs: number;
    diagnosticsMs: number;
    serializationMs: number;
    hashingMs: number;
    measuredTotalMs: number;
    approximatePercent: Record<string, number>;
    structuralCounters: CompiledGameTree<string>["statistics"] & { totalTraversalNodeVisits: number };
    note: string;
  };
};

function createSolver<State, Action extends string>(
  game: ExtensiveGame<State, Action>,
  configuration: SolverConfiguration,
  compiled: CompiledGameTree<Action>,
): SolverAlgorithm {
  if (configuration.engine === "indexed-tree") return new IndexedCfrSolver(game, configuration, compiled);
  const common = {
    seed: configuration.seed,
    exactMetrics: false,
    dcfr: configuration.dcfr,
    cfrPlusAveragingDelay: configuration.cfrPlusAveragingDelay,
  };
  if (configuration.algorithm === "vanilla-cfr") return new VanillaCfr(game, common, compiled);
  if (configuration.algorithm === "cfr-plus") return new CfrPlus(game, common, compiled);
  return new Dcfr(game, common, compiled);
}

function averagePositiveRegret(checkpoint: SolverCheckpoint) {
  const values = checkpoint.infosets.flatMap((info) => info.regrets.map((value) => Math.max(0, value)));
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length / Math.max(1, checkpoint.iteration)
    : 0;
}

function percentage(value: number, total: number) {
  return total > 0 ? value / total * 100 : 0;
}

export class ConvergenceExperimentRunner<State, Action extends string> {
  constructor(
    readonly game: ExtensiveGame<State, Action>,
    readonly options: ConvergenceExperimentOptions,
  ) {}

  run(): ConvergenceExperimentResult {
    const budgets = [...new Set(this.options.budgets)]
      .filter((value) => Number.isInteger(value) && value > 0)
      .sort((left, right) => left - right);
    if (!budgets.length) throw new Error("Convergence experiment requires at least one positive checkpoint.");

    const compileStarted = performance.now();
    const compiled = compileGameTree(this.game);
    const compileMs = performance.now() - compileStarted;
    const gameDefinitionHash = hashValue(this.game.definition);
    if (this.options.resume) {
      if (this.options.resume.referenceGameId !== this.options.referenceGameId) throw new Error("Resume checkpoint belongs to another reference game.");
      if (this.options.resume.gameDefinitionHash !== gameDefinitionHash) throw new Error("Resume checkpoint game hash mismatch.");
      if (hashValue(this.options.resume.configuration) !== hashValue(this.options.configuration)) throw new Error("Resume checkpoint configuration mismatch.");
    }

    const solver = createSolver(this.game, this.options.configuration, compiled);
    let history: ConvergenceCheckpoint[] = [];
    let previousStrategy: BehavioralStrategy | null = null;
    if (this.options.resume) {
      solver.restore(this.options.resume.solver);
      history = [...this.options.resume.convergenceHistory];
      previousStrategy = this.options.resume.lastStrategy;
    } else {
      solver.initialize();
    }

    const heapStart = process.memoryUsage().heapUsed;
    const wallStarted = performance.now();
    let traversalMs = 0;
    let strategyEvaluationMs = 0;
    let bestResponseEvaluationMs = 0;
    let diagnosticsMs = 0;
    let stoppedBy: ConvergenceExperimentResult["stoppedBy"] = "iterations";
    const evaluator = new CompiledBestResponseEvaluator(compiled.root);
    const thresholds = Object.fromEntries(
      Object.keys(PHASE6_EXPLOITABILITY_THRESHOLDS).map((key) => [key, null]),
    ) as Record<string, ThresholdAchievement | null>;

    history.forEach((point) => {
      Object.entries(PHASE6_EXPLOITABILITY_THRESHOLDS).forEach(([key, threshold]) => {
        if (thresholds[key] === null && point.exploitability < threshold) {
          thresholds[key] = {
            threshold,
            firstMeasuredIteration: point.iterations,
            runtimeMs: point.runtimeMs,
            heapUsedBytes: point.heapUsedBytes,
            algorithm: this.options.configuration.algorithm,
            seed: this.options.configuration.seed,
          };
        }
      });
    });

    let completedIterations = solver.checkpoint().iteration;
    for (const budget of budgets) {
      if (budget <= completedIterations) continue;
      const traversalStarted = performance.now();
      while (completedIterations < budget) {
        solver.iterate();
        completedIterations += 1;
      }
      traversalMs += performance.now() - traversalStarted;

      const strategy = solver.averageStrategy();
      const evaluationStarted = performance.now();
      const utilities = evaluateCompiledNode(compiled.root, strategy);
      const currentStrategyEvaluationMs = performance.now() - evaluationStarted;
      strategyEvaluationMs += currentStrategyEvaluationMs;

      const bestResponseStarted = performance.now();
      const first = evaluator.evaluate(0, strategy);
      const second = evaluator.evaluate(1, strategy);
      const currentBestResponseMs = performance.now() - bestResponseStarted;
      bestResponseEvaluationMs += currentBestResponseMs;
      const nashConv = first.value + second.value;

      const diagnosticStarted = performance.now();
      const reach = compiledInformationSetReach(compiled.root, strategy);
      const stability = previousStrategy
        ? strategyStability(previousStrategy, strategy, reach, this.options.activeReachThreshold ?? 1e-9)
        : null;
      const solverCheckpoint = solver.checkpoint();
      completedIterations = solverCheckpoint.iteration;
      const diagnosticElapsed = performance.now() - diagnosticStarted;
      diagnosticsMs += diagnosticElapsed;
      const heapUsedBytes = process.memoryUsage().heapUsed;
      const runtimeMs = performance.now() - wallStarted;
      const point: ConvergenceCheckpoint = {
        iterations: solverCheckpoint.iteration,
        runtimeMs,
        traversalMs,
        iterationsPerSecond: solverCheckpoint.iteration / Math.max(1e-9, traversalMs / 1000),
        evP0: utilities[0],
        evP1: utilities[1],
        nashConv,
        exploitability: nashConv / 2,
        averagePositiveRegret: averagePositiveRegret(solverCheckpoint),
        strategyDelta: stability,
        infosets: solverCheckpoint.infosets.length,
        nodesVisited: solverCheckpoint.nodesVisited,
        heapUsedBytes,
        heapDeltaBytes: heapUsedBytes - heapStart,
        strategyEvaluationMs: currentStrategyEvaluationMs,
        bestResponseEvaluationMs: currentBestResponseMs,
        diagnosticMs: diagnosticElapsed,
        strategyHash: hashValue(strategy),
      };
      history.push(point);
      previousStrategy = strategy;

      Object.entries(PHASE6_EXPLOITABILITY_THRESHOLDS).forEach(([key, threshold]) => {
        if (thresholds[key] === null && point.exploitability < threshold) {
          thresholds[key] = {
            threshold,
            firstMeasuredIteration: point.iterations,
            runtimeMs: point.runtimeMs,
            heapUsedBytes: point.heapUsedBytes,
            algorithm: this.options.configuration.algorithm,
            seed: this.options.configuration.seed,
          };
        }
      });

      if (this.options.targetExploitability !== undefined && point.exploitability <= this.options.targetExploitability) {
        stoppedBy = "target-exploitability";
        break;
      }
      if (this.options.maximumRuntimeMs !== undefined && runtimeMs >= this.options.maximumRuntimeMs) {
        stoppedBy = "runtime";
        break;
      }
      if (this.options.maximumHeapBytes !== undefined && heapUsedBytes >= this.options.maximumHeapBytes) {
        stoppedBy = "memory";
        break;
      }
      const plateau = this.options.plateau;
      if (plateau && history.length >= plateau.checkpoints) {
        const recent = history.slice(-plateau.checkpoints);
        const improvement = recent[0].exploitability - recent.at(-1)!.exploitability;
        if (improvement >= 0 && improvement < plateau.minimumImprovement) {
          stoppedBy = "plateau";
          break;
        }
      }
    }

    const finalStrategy = solver.averageStrategy();
    const counterfactualStarted = performance.now();
    const finalCounterfactualDiagnostics = [
      ...counterfactualActionDiagnostics(compiled.root, finalStrategy, 0),
      ...counterfactualActionDiagnostics(compiled.root, finalStrategy, 1),
    ];
    diagnosticsMs += performance.now() - counterfactualStarted;
    const checkpoint: Phase6SolverCheckpoint = {
      schemaVersion: 1,
      solverVersion: SOLVER_VERSION,
      referenceGameId: this.options.referenceGameId,
      gameDefinitionHash,
      configuration: this.options.configuration,
      solver: solver.checkpoint(),
      convergenceHistory: history,
      lastStrategy: finalStrategy,
    };

    const serializationStarted = performance.now();
    stableStringify({ history, finalCounterfactualDiagnostics });
    const serializationMs = performance.now() - serializationStarted;
    const hashingStarted = performance.now();
    hashValue({ finalStrategy, gameDefinitionHash });
    const hashingMs = performance.now() - hashingStarted;
    const measuredTotalMs = compileMs + traversalMs + strategyEvaluationMs
      + bestResponseEvaluationMs + diagnosticsMs + serializationMs + hashingMs;
    return {
      referenceGameId: this.options.referenceGameId,
      gameDefinitionHash,
      solverVersion: SOLVER_VERSION,
      configuration: this.options.configuration,
      tree: compiled.statistics as CompiledGameTree<string>["statistics"],
      history,
      thresholds,
      stoppedBy,
      finalStrategy,
      finalCounterfactualDiagnostics,
      checkpoint,
      profiling: {
        compileMs,
        traversalMs,
        strategyEvaluationMs,
        bestResponseEvaluationMs,
        diagnosticsMs,
        serializationMs,
        hashingMs,
        measuredTotalMs,
        approximatePercent: {
          treeCompilationIncludingPrivateChanceBoardAbstractionAndHandEvaluation: percentage(compileMs, measuredTotalMs),
          cfrTraversalIncludingRegretMatchingAndInfosetLookup: percentage(traversalMs, measuredTotalMs),
          strategyEvaluation: percentage(strategyEvaluationMs, measuredTotalMs),
          bestResponse: percentage(bestResponseEvaluationMs, measuredTotalMs),
          reachAndCounterfactualDiagnostics: percentage(diagnosticsMs, measuredTotalMs),
          serialization: percentage(serializationMs, measuredTotalMs),
          hashingAndCacheIdentity: percentage(hashingMs, measuredTotalMs),
        },
        structuralCounters: { ...compiled.statistics, totalTraversalNodeVisits: solver.checkpoint().nodesVisited },
        note: "Wall-clock groups are measured around high-level phases. Traversal subcomponents are grouped to avoid perturbing the hot loop with per-node timers.",
      },
    };
  }
}

export type DescriptiveStatistics = {
  count: number;
  mean: number;
  median: number;
  standardDeviation: number;
  minimum: number;
  maximum: number;
  confidence95: [number, number] | null;
};

export function descriptiveStatistics(values: number[]): DescriptiveStatistics {
  if (!values.length) throw new Error("Statistics require at least one value.");
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.length > 1
    ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length - 1)
    : 0;
  const standardDeviation = Math.sqrt(variance);
  const median = sorted.length % 2
    ? sorted[Math.floor(sorted.length / 2)]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const margin = sorted.length >= 5 ? 1.96 * standardDeviation / Math.sqrt(sorted.length) : null;
  return {
    count: sorted.length,
    mean,
    median,
    standardDeviation,
    minimum: sorted[0],
    maximum: sorted.at(-1)!,
    confidence95: margin === null ? null : [mean - margin, mean + margin],
  };
}

export function withinProviderSeedNoise(strategies: BehavioralStrategy[]) {
  if (strategies.length < 2) throw new Error("Seed-noise analysis requires at least two strategies.");
  const distances: number[] = [];
  for (let left = 0; left < strategies.length; left += 1) {
    for (let right = left + 1; right < strategies.length; right += 1) {
      distances.push(strategyDistance(strategies[left], strategies[right]).weightedMeanAbsoluteDelta);
    }
  }
  return { pairwiseDistances: distances, statistics: descriptiveStatistics(distances) };
}

export function providerSeparationRatio(betweenProviderDistance: number, withinProviderNoise: number) {
  if (betweenProviderDistance < 0 || withinProviderNoise < 0) throw new Error("Provider separation inputs must be non-negative.");
  return {
    name: "ProviderSeparationRatio",
    value: withinProviderNoise > 0 ? betweenProviderDistance / withinProviderNoise : null,
    betweenProviderDistance,
    withinProviderNoise,
    interpretation: "Preflop Lab diagnostic ratio, not a standard academic metric. Values above one mean provider separation exceeds measured within-provider seed noise.",
  };
}
