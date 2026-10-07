import { performance } from "node:perf_hooks";
import type { BehavioralStrategy } from "../../core/types";
import { hashValue } from "../../core/stable";
import { residualNorms, SafeguardedAnderson, vectorNorms } from "../../analysis/phase6-6";
import { NashConvEvaluator } from "../../evaluation/best-response";
import type { UnifiedResearchGame } from "../unified/game-tree";
import { ContinuationOperator, gameInformationSets, uniformStageStrategy } from "./continuation-operator";

export type DecompositionMethod = "undamped" | "damped" | "anderson";
export type DecomposedConfiguration = {
  innerIterations: number;
  outerIterations: number;
  damping: number;
  method: DecompositionMethod;
  initialization: "uniform" | "first-action" | "second-action";
};

export type DecompositionCheckpoint = {
  schemaVersion: 1;
  algorithmVersion: string;
  gameHash: string;
  configurationHash: string;
  completedIterations: number;
  strategy: BehavioralStrategy;
  metrics: DecompositionIteration[];
  accelerator: ReturnType<SafeguardedAnderson["checkpoint"]> | null;
  previousState: number[] | null;
  previousMapped: number[] | null;
};

export type DecompositionIteration = {
  iteration: number;
  residual: ReturnType<typeof residualNorms>;
  updateDistance: ReturnType<typeof vectorNorms>;
  localResponseRatio: number | null;
  strategyEv: number;
  bestResponseEv: [number, number];
  exploitability: number;
  nashConv: number;
  averagePositiveRegret: number;
  nodesVisited: number;
  accelerated: boolean;
};

const ALGORITHM_VERSION = "decomposed-fixed-point-v0.7.0";

function codec(game: UnifiedResearchGame) {
  const entries = gameInformationSets(game, "initial");
  return {
    entries,
    vector(strategy: BehavioralStrategy) { return entries.flatMap(([key, actions]) => actions.map((action) => strategy[key]?.[action] ?? 0)); },
    strategy(vector: readonly number[]) {
      let offset = 0;
      return Object.fromEntries(entries.map(([key, actions]) => {
        const values = actions.map(() => Math.max(0, vector[offset++] ?? 0));
        const total = values.reduce((sum, value) => sum + value, 0);
        const probabilities = total > 1e-15 ? values.map((value) => value / total) : values.map(() => 1 / values.length);
        return [key, Object.fromEntries(actions.map((action, index) => [action, probabilities[index]]))];
      }));
    },
  };
}

export function decompositionInitialization(game: UnifiedResearchGame, kind: DecomposedConfiguration["initialization"]) {
  const uniform = uniformStageStrategy(game, "initial");
  if (kind === "uniform") return uniform;
  return Object.fromEntries(gameInformationSets(game, "initial").map(([key, actions], infoIndex) => {
    const favored = kind === "first-action" ? infoIndex % actions.length : (infoIndex + 1) % actions.length;
    const remainder = actions.length > 1 ? 0.1 / (actions.length - 1) : 0;
    return [key, Object.fromEntries(actions.map((action, index) => [action, index === favored ? 0.9 : remainder]))];
  }));
}

export class DecomposedSolver {
  readonly gameHash: string;
  readonly configurationHash: string;
  readonly experimentId: string;
  private current: BehavioralStrategy;
  private completedIterations = 0;
  private metricsHistory: DecompositionIteration[] = [];
  private accelerator: SafeguardedAnderson | null;
  private previousState: number[] | null = null;
  private previousMapped: number[] | null = null;

  constructor(readonly game: UnifiedResearchGame, readonly configuration: DecomposedConfiguration) {
    if (!(configuration.damping > 0 && configuration.damping <= 1)) throw new Error("Damping must be in (0, 1].");
    this.gameHash = hashValue(game.definition);
    this.configurationHash = hashValue({ algorithmVersion: ALGORITHM_VERSION, configuration });
    this.experimentId = hashValue({ gameHash: this.gameHash, configurationHash: this.configurationHash });
    this.current = decompositionInitialization(game, configuration.initialization);
    this.accelerator = configuration.method === "anderson" ? new SafeguardedAnderson(3, 1e-8, 1.25) : null;
  }

  solve(maxOuterIterations = this.configuration.outerIterations) {
    const started = performance.now();
    const memoryBefore = process.memoryUsage().heapUsed;
    const operator = new ContinuationOperator(this.game, this.configuration.innerIterations);
    const strategyCodec = codec(this.game);
    let finalContinuation: BehavioralStrategy = {};
    let totalNodes = this.metricsHistory.reduce((sum, metric) => sum + metric.nodesVisited, 0);
    while (this.completedIterations < maxOuterIterations) {
      const state = strategyCodec.vector(this.current);
      const mappedResult = operator.map(this.current);
      const mapped = strategyCodec.vector(mappedResult.initialStrategy);
      const residual = residualNorms(state, mapped);
      const alpha = this.configuration.method === "undamped" ? 1 : this.configuration.damping;
      const baseline = state.map((value, index) => value + alpha * residual.residual[index]);
      let next = baseline;
      let accelerated = false;
      let extraNodes = 0;
      if (this.accelerator) {
        const proposal = this.accelerator.propose(state, mapped, baseline);
        if (proposal.accelerated) {
          const projected = strategyCodec.vector(strategyCodec.strategy(proposal.candidate));
          const candidateMap = operator.map(strategyCodec.strategy(projected));
          extraNodes = candidateMap.nodesVisited;
          const candidateResidual = residualNorms(projected, strategyCodec.vector(candidateMap.initialStrategy)).l2;
          if (this.accelerator.safeguard(candidateResidual, residual.l2)) {
            next = projected;
            accelerated = true;
          }
        }
      }
      const nextStrategy = strategyCodec.strategy(next);
      const completeStrategy = { ...nextStrategy, ...mappedResult.continuationStrategy };
      const evaluation = new NashConvEvaluator(this.game).evaluate(completeStrategy);
      const updateDistance = vectorNorms(next.map((value, index) => value - state[index]));
      const inputMovement = this.previousState ? vectorNorms(state.map((value, index) => value - this.previousState![index])).l2 : 0;
      const outputMovement = this.previousMapped ? vectorNorms(mapped.map((value, index) => value - this.previousMapped![index])).l2 : 0;
      const nodesVisited = mappedResult.nodesVisited + extraNodes;
      totalNodes += nodesVisited;
      this.completedIterations += 1;
      this.metricsHistory.push({
        iteration: this.completedIterations,
        residual,
        updateDistance,
        localResponseRatio: inputMovement > 1e-15 ? outputMovement / inputMovement : null,
        strategyEv: evaluation.utilities[0],
        bestResponseEv: [evaluation.bestResponses[0].value, evaluation.bestResponses[1].value],
        exploitability: evaluation.exploitability,
        nashConv: evaluation.nashConv,
        averagePositiveRegret: mappedResult.averagePositiveRegret,
        nodesVisited,
        accelerated,
      });
      this.previousState = state;
      this.previousMapped = mapped;
      this.current = nextStrategy;
      finalContinuation = mappedResult.continuationStrategy;
    }
    const strategy = { ...this.current, ...finalContinuation };
    const runtimeMs = performance.now() - started;
    const checkpoint = this.checkpoint();
    return {
      approach: "decomposed" as const,
      method: this.configuration.method,
      algorithmVersion: ALGORITHM_VERSION,
      configuration: this.configuration,
      configurationHash: this.configurationHash,
      gameHash: this.gameHash,
      experimentId: this.experimentId,
      strategy,
      strategyHash: hashValue(strategy),
      metrics: [...this.metricsHistory],
      final: this.metricsHistory.at(-1)!,
      performance: { runtimeMs, nodesVisited: totalNodes, heapUsedBeforeBytes: memoryBefore, heapUsedAfterBytes: process.memoryUsage().heapUsed, heapDeltaBytes: process.memoryUsage().heapUsed - memoryBefore },
      checkpoint,
      checkpointHash: hashValue(checkpoint),
    };
  }

  checkpoint(): DecompositionCheckpoint {
    return { schemaVersion: 1, algorithmVersion: ALGORITHM_VERSION, gameHash: this.gameHash, configurationHash: this.configurationHash, completedIterations: this.completedIterations, strategy: this.current, metrics: [...this.metricsHistory], accelerator: this.accelerator?.checkpoint() ?? null, previousState: this.previousState, previousMapped: this.previousMapped };
  }

  restore(checkpoint: DecompositionCheckpoint) {
    if (checkpoint.schemaVersion !== 1 || checkpoint.algorithmVersion !== ALGORITHM_VERSION || checkpoint.gameHash !== this.gameHash || checkpoint.configurationHash !== this.configurationHash) throw new Error("Decomposition checkpoint is incompatible.");
    this.completedIterations = checkpoint.completedIterations;
    this.current = checkpoint.strategy;
    this.metricsHistory = [...checkpoint.metrics];
    this.previousState = checkpoint.previousState;
    this.previousMapped = checkpoint.previousMapped;
    if (this.accelerator && checkpoint.accelerator) this.accelerator.restore(checkpoint.accelerator);
  }
}
