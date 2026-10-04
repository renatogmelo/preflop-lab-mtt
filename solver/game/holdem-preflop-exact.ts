import { ExactChanceCfrSolver } from "../algorithms/exact-chance-cfr";
import type { SolverCard } from "../cards/cards";
import { WeightedRange } from "../cards/range";
import type { StrategicContinuationProvider } from "../continuation/engine";
import { hashValue } from "../core/stable";
import type { AlgorithmName, DcfrParameters, SolverCheckpoint } from "../core/types";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../evaluation/holdem-preflop";
import type { HoldemPreflopV2Configuration } from "./holdem-preflop-v2";

export type ExactPreflopSolveConfiguration = {
  algorithm: AlgorithmName;
  iterations: number;
  metricInterval: number;
  dcfr?: DcfrParameters;
  cfrPlusAveragingDelay?: number;
  maxRuntimeMs?: number;
  targetExploitability?: number;
  provenanceSeed?: number;
};

export class ExactHoldemPreflopSolver {
  readonly game: HoldemPreflopEvaluationGame;
  readonly solver: ExactChanceCfrSolver<ReturnType<HoldemPreflopEvaluationGame["initialState"]>, string>;
  readonly evaluator: HoldemPreflopStrategyEvaluator;

  constructor(
    readonly preflop: HoldemPreflopV2Configuration,
    readonly ranges: [WeightedRange, WeightedRange],
    readonly continuation: StrategicContinuationProvider,
    readonly configuration: ExactPreflopSolveConfiguration,
    readonly board: SolverCard[] = preflop.continuationBoard,
  ) {
    const canonicalPreflop = { ...preflop, seed: 0 };
    this.game = new HoldemPreflopEvaluationGame(canonicalPreflop, ranges, continuation, board);
    this.evaluator = new HoldemPreflopStrategyEvaluator(this.game);
    this.solver = new ExactChanceCfrSolver(this.game, {
      algorithm: configuration.algorithm,
      seed: 0,
      exactMetrics: true,
      dcfr: configuration.dcfr,
      cfrPlusAveragingDelay: configuration.cfrPlusAveragingDelay,
      engine: "indexed-tree",
    }, this.evaluator.compiled);
  }

  solve(checkpoint?: SolverCheckpoint) {
    if (checkpoint) this.solver.restore(checkpoint);
    const started = performance.now();
    const solved = this.solver.solve({
      maxIterations: this.configuration.iterations,
      metricInterval: this.configuration.metricInterval,
      maxRuntimeMs: this.configuration.maxRuntimeMs,
      targetExploitability: this.configuration.targetExploitability,
    });
    const evaluation = this.evaluator.evaluate(solved.strategy);
    const actionEvs = this.evaluator.counterfactualActionEvs(solved.strategy);
    return {
      id: hashValue({ solveId: this.solver.solveId, iterations: solved.metrics.iteration, strategy: solved.strategy }),
      solveId: this.solver.solveId,
      gameId: this.game.id,
      traversal: "exact-private-deal-enumeration" as const,
      chanceOutcomes: this.game.deals.length,
      seedRole: "provenance-only" as const,
      provenanceSeed: this.configuration.provenanceSeed ?? this.preflop.seed,
      configuration: this.configuration,
      strategy: solved.strategy,
      currentStrategy: solved.currentStrategy,
      metrics: solved.metrics.history,
      solveMetrics: solved.metrics,
      evaluation,
      actionEvs,
      checkpoint: this.solver.checkpoint(),
      runtimeMs: performance.now() - started,
      trust: "Experimental" as const,
      verifiedDatasets: 0,
    };
  }
}