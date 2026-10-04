import type { SolverCard } from "../cards/cards";
import { WeightedRange } from "../cards/range";
import { ContinuationArtifactCache } from "../continuation/cache";
import type { StrategicContinuationProvider } from "../continuation/engine";
import { PairTableContinuationProvider } from "./engine";
import { hashValue } from "../core/stable";
import type { BehavioralStrategy } from "../core/types";
import { compiledInformationSetReach, strategyStability } from "../evaluation/compiled-analysis";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../evaluation/holdem-preflop";
import { ExactHoldemPreflopSolver, type ExactPreflopSolveConfiguration } from "../game/holdem-preflop-exact";
import { applyBettingAction, createPreflopBettingState } from "../game/betting";
import { createHoldemPreflopV2Definition, holdemPreflopActionId, holdemPreflopLegalActions, type HoldemPreflopV2Configuration } from "../game/holdem-preflop-v2";
import {
  RangePostflopHoldemSubgame,
  solveRangePostflopSubgame,
  type FutureBoardProvider,
  type RangePostflopAbstraction,
  type RangePostflopArtifact,
  type RangePostflopSolveConfiguration,
} from "../game/range-postflop-subgame";
import { conditionalRangeL1, deriveConditionalRangeSnapshots, weightedRangeFromSnapshot, type ConditionalRangeSnapshot } from "../ranges/conditional";
import { compileGameTree } from "../tree/compiled";
import { contractionRatios, detectApproximateCycle } from "../analysis/phase6-5";
import { satisfiesConvergencePatience } from "./engine";

export type DeterministicCouplingMetric = {
  outerIteration: number;
  preflopMaxStrategyDelta: number;
  preflopReachWeightedDelta: number;
  conditionalRangeDelta: number | null;
  rawContinuationUtilityDelta: number | null;
  dampedContinuationUtilityDelta: number | null;
  postflopMaxStrategyDelta: number | null;
  postflopReachWeightedDelta: number | null;
  preflopNashConv: number;
  preflopExploitability: number;
  postflopNashConv: number | null;
  postflopExploitability: number | null;
  convergencePass: boolean;
  consecutivePasses: number;
  cycleDetected: boolean;
  cyclePeriod: number | null;
  cycleDistance: number | null;
  cycleAmplitude: number;
  runtimeMs: number;
};

export type DeterministicCouplingCheckpoint = {
  schemaVersion: 1;
  configurationHash: string;
  completedIterations: number;
  preflop: { id: string; strategy: BehavioralStrategy };
  previousSnapshots: [ConditionalRangeSnapshot, ConditionalRangeSnapshot] | null;
  previousPostflop: BehavioralStrategy | null;
  previousRawValues: Array<[string, [number, number]]> | null;
  previousDampedValues: Array<[string, [number, number]]> | null;
  outerMetrics: DeterministicCouplingMetric[];
  continuationValueHistory: Array<{
    outerIteration: number;
    raw: Array<{ pairKey: string; utilityP0: number }>;
    damped: Array<{ pairKey: string; utilityP0: number }>;
  }>;
  convergencePasses: boolean[];
  stateVectors: number[][];
};

export type DeterministicCouplingConfiguration = {
  preflop: HoldemPreflopV2Configuration;
  exactPreflop: ExactPreflopSolveConfiguration;
  ranges: [WeightedRange, WeightedRange];
  actionHistory: string[];
  flop: [SolverCard, SolverCard, SolverCard];
  postflopAbstraction: RangePostflopAbstraction;
  boardProvider: FutureBoardProvider;
  postflopSolve: RangePostflopSolveConfiguration;
  outerIterations: number;
  dampingAlpha: number;
  rangeHashQuantization?: number;
  convergence: {
    preflopStrategyDelta: number;
    conditionalRangeDelta: number;
    continuationUtilityDelta: number;
    postflopStrategyDelta: number;
    patience: number;
  };
  cycleTolerance?: number;
};

function terminalState(configuration: HoldemPreflopV2Configuration, history: string[]) {
  let state = createPreflopBettingState(createHoldemPreflopV2Definition(configuration));
  history.forEach((selected) => {
    const action = holdemPreflopLegalActions(configuration, state).find((candidate) => holdemPreflopActionId(candidate) === selected);
    if (!action) throw new Error(`Illegal deterministic coupling path action ${selected}.`);
    state = applyBettingAction(state, action);
  });
  if (!state.complete) throw new Error("Deterministic coupling path must end at a continuation terminal.");
  return state;
}

function pairValues(artifact: RangePostflopArtifact) {
  return new Map(artifact.pairUtilities.map((entry) => [entry.pairKey, entry.utilities] as [string, [number, number]]));
}

function dampValues(previous: ReadonlyMap<string, [number, number]> | null, solved: ReadonlyMap<string, [number, number]>, alpha: number) {
  if (!(alpha > 0 && alpha <= 1)) throw new Error("Damping alpha must be in (0, 1].");
  if (!previous) return new Map(solved);
  return new Map([...solved].map(([key, utility]) => {
    const prior = previous.get(key) ?? utility;
    const playerZero = alpha * utility[0] + (1 - alpha) * prior[0];
    return [key, [playerZero, -playerZero]] as [string, [number, number]];
  }));
}

function maximumValueDelta(previous: ReadonlyMap<string, [number, number]> | null, current: ReadonlyMap<string, [number, number]>) {
  if (!previous) return null;
  let maximum = 0;
  current.forEach((value, key) => {
    const old = previous.get(key);
    if (old) maximum = Math.max(maximum, Math.abs(value[0] - old[0]));
  });
  return maximum;
}

function consecutivePasses(values: boolean[]) {
  let count = 0;
  for (let index = values.length - 1; index >= 0 && values[index]; index -= 1) count += 1;
  return count;
}

export class DeterministicCoupledPreflopPostflopSolver {
  readonly cache: ContinuationArtifactCache<RangePostflopArtifact>;
  readonly configurationHash: string;

  constructor(readonly configuration: DeterministicCouplingConfiguration, readonly initialContinuation: StrategicContinuationProvider) {
    if (!(configuration.dampingAlpha > 0 && configuration.dampingAlpha <= 1)) throw new Error("Damping alpha must be in (0, 1].");
    if (configuration.convergence.patience !== 3) throw new Error("Phase 6.5 Gate D requires exactly three consecutive passes.");
    this.cache = new ContinuationArtifactCache(configuration.rangeHashQuantization ?? 1e-9);
    this.configurationHash = hashValue({
      ...configuration,
      ranges: configuration.ranges.map((range) => range.entries().map(({ combo, weight }) => [combo.id, weight])),
      boardProvider: configuration.boardProvider.metadata(),
    });
  }

  private exactPreflop(provider: StrategicContinuationProvider) {
    return new ExactHoldemPreflopSolver(
      this.configuration.preflop,
      this.configuration.ranges,
      provider,
      this.configuration.exactPreflop,
      this.configuration.flop,
    ).solve();
  }

  solve(resume?: DeterministicCouplingCheckpoint, stopAfterOuterIteration = this.configuration.outerIterations) {
    if (resume && resume.configurationHash !== this.configurationHash) throw new Error("Outer checkpoint configuration mismatch.");
    if (!Number.isInteger(stopAfterOuterIteration) || stopAfterOuterIteration <= 0 || stopAfterOuterIteration > this.configuration.outerIterations) {
      throw new Error("Outer stop iteration must be within the configured budget.");
    }
    const terminal = terminalState(this.configuration.preflop, this.configuration.actionHistory);
    const pot = terminal.pot;
    const stacks = terminal.players.map((player) => player.stack) as [number, number];
    let preflop = resume?.preflop ?? this.exactPreflop(this.initialContinuation);
    let previousStrategy = preflop.strategy;
    let previousSnapshots = resume?.previousSnapshots ?? null;
    let previousPostflop = resume?.previousPostflop ?? null;
    let previousRawValues = resume?.previousRawValues ? new Map(resume.previousRawValues) : null;
    let previousDampedValues = resume?.previousDampedValues ? new Map(resume.previousDampedValues) : null;
    const outerMetrics = resume ? [...resume.outerMetrics] : [];
    const continuationValueHistory = resume ? [...resume.continuationValueHistory] : [];
    const convergencePasses = resume ? [...resume.convergencePasses] : [];
    const stateVectors = resume ? [...resume.stateVectors] : [];
    const postflopArtifacts: RangePostflopArtifact[] = [];
    let finalSnapshots = previousSnapshots;
    let stopReason: "iterations" | "converged" = "iterations";
    const firstIteration = (resume?.completedIterations ?? 0) + 1;

    for (let iteration = firstIteration; iteration <= stopAfterOuterIteration; iteration += 1) {
      const started = performance.now();
      const snapshots = deriveConditionalRangeSnapshots({
        configuration: this.configuration.preflop,
        ranges: this.configuration.ranges,
        strategy: preflop.strategy,
        actionHistory: this.configuration.actionHistory,
        board: this.configuration.flop,
        sourceSolveId: preflop.id,
      });
      const conditioned: [WeightedRange, WeightedRange] = [
        weightedRangeFromSnapshot(snapshots[0], this.configuration.ranges[0]),
        weightedRangeFromSnapshot(snapshots[1], this.configuration.ranges[1]),
      ];
      const definition = {
        id: `phase6-5-coupled-postflop:${iteration}`,
        ranges: conditioned,
        flop: this.configuration.flop,
        pot,
        stacks,
        firstPlayer: 1 as const,
        abstraction: this.configuration.postflopAbstraction,
        boardProvider: this.configuration.boardProvider,
        rangeSource: {
          playerZeroSnapshotId: snapshots[0].id,
          playerOneSnapshotId: snapshots[1].id,
          description: "Exact-preflop Bayesian ranges conditioned on the frozen continuation path.",
        },
      };
      const identity = {
        board: [...this.configuration.flop],
        pot,
        stacks,
        actingPlayer: 1 as const,
        position: "BB",
        actionHistory: this.configuration.actionHistory,
        ranges: conditioned,
        bettingAbstraction: this.configuration.postflopAbstraction,
        algorithmConfiguration: this.configuration.postflopSolve,
      };
      const cached = this.cache.getOrCreate(identity, () => solveRangePostflopSubgame(definition, this.configuration.postflopSolve));
      const postflop = cached.value;
      const rawValues = pairValues(postflop);
      const dampedValues = dampValues(previousDampedValues, rawValues, this.configuration.dampingAlpha);
      const provider = new PairTableContinuationProvider(dampedValues, { pot, stacks }, postflop);
      const next = this.exactPreflop(provider);
      const preflopGame = new HoldemPreflopEvaluationGame(this.configuration.preflop, this.configuration.ranges, provider, this.configuration.flop);
      const preflopEvaluator = new HoldemPreflopStrategyEvaluator(preflopGame);
      const preflopEvaluation = preflopEvaluator.evaluate(next.strategy);
      const preflopReach = compiledInformationSetReach(preflopEvaluator.compiled.root, next.strategy);
      const preflopStability = strategyStability(previousStrategy, next.strategy, preflopReach, 1e-10);
      const rangeDelta = previousSnapshots
        ? Math.max(conditionalRangeL1(previousSnapshots[0], snapshots[0]), conditionalRangeL1(previousSnapshots[1], snapshots[1]))
        : null;
      const rawValueDelta = maximumValueDelta(previousRawValues, rawValues);
      const dampedValueDelta = maximumValueDelta(previousDampedValues, dampedValues);
      let postflopMaxDelta: number | null = null;
      let postflopReachDelta: number | null = null;
      if (previousPostflop) {
        const compiledPostflop = compileGameTree(new RangePostflopHoldemSubgame(definition));
        const postflopReach = compiledInformationSetReach(compiledPostflop.root, postflop.strategy);
        const postflopStability = strategyStability(previousPostflop, postflop.strategy, postflopReach, 1e-10);
        postflopMaxDelta = postflopStability.maxStrategyDelta;
        postflopReachDelta = postflopStability.reachWeightedStrategyDelta;
      }
      const pass = rangeDelta !== null
        && dampedValueDelta !== null
        && postflopReachDelta !== null
        && preflopStability.reachWeightedStrategyDelta <= this.configuration.convergence.preflopStrategyDelta
        && rangeDelta <= this.configuration.convergence.conditionalRangeDelta
        && dampedValueDelta <= this.configuration.convergence.continuationUtilityDelta
        && postflopReachDelta <= this.configuration.convergence.postflopStrategyDelta;
      convergencePasses.push(pass);
      const sortedRaw = [...rawValues].sort(([left], [right]) => left.localeCompare(right));
      const sortedDamped = [...dampedValues].sort(([left], [right]) => left.localeCompare(right));
      const vector = [
        ...sortedDamped.map(([, utility]) => utility[0]),
        preflopStability.reachWeightedStrategyDelta,
        rangeDelta ?? 0,
        postflopReachDelta ?? 0,
      ];
      stateVectors.push(vector);
      const cycle = detectApproximateCycle(stateVectors, [2, 3], this.configuration.cycleTolerance ?? 1e-4);
      const metric: DeterministicCouplingMetric = {
        outerIteration: iteration,
        preflopMaxStrategyDelta: preflopStability.maxStrategyDelta,
        preflopReachWeightedDelta: preflopStability.reachWeightedStrategyDelta,
        conditionalRangeDelta: rangeDelta,
        rawContinuationUtilityDelta: rawValueDelta,
        dampedContinuationUtilityDelta: dampedValueDelta,
        postflopMaxStrategyDelta: postflopMaxDelta,
        postflopReachWeightedDelta: postflopReachDelta,
        preflopNashConv: preflopEvaluation.nashConv,
        preflopExploitability: preflopEvaluation.exploitability,
        postflopNashConv: postflop.convergence.nashConv,
        postflopExploitability: postflop.convergence.exploitability,
        convergencePass: pass,
        consecutivePasses: consecutivePasses(convergencePasses),
        cycleDetected: cycle.detected,
        cyclePeriod: cycle.period,
        cycleDistance: cycle.distance,
        cycleAmplitude: cycle.amplitude,
        runtimeMs: performance.now() - started,
      };
      outerMetrics.push(metric);
      continuationValueHistory.push({
        outerIteration: iteration,
        raw: sortedRaw.map(([pairKey, utility]) => ({ pairKey, utilityP0: utility[0] })),
        damped: sortedDamped.map(([pairKey, utility]) => ({ pairKey, utilityP0: utility[0] })),
      });
      postflopArtifacts.push(postflop);
      preflop = next;
      previousStrategy = next.strategy;
      previousSnapshots = snapshots;
      previousPostflop = postflop.strategy;
      previousRawValues = rawValues;
      previousDampedValues = dampedValues;
      finalSnapshots = snapshots;
      if (satisfiesConvergencePatience(convergencePasses, this.configuration.convergence.patience)) {
        stopReason = "converged";
        break;
      }
    }

    const checkpoint: DeterministicCouplingCheckpoint = {
      schemaVersion: 1,
      configurationHash: this.configurationHash,
      completedIterations: outerMetrics.at(-1)?.outerIteration ?? 0,
      preflop: { id: preflop.id, strategy: preflop.strategy },
      previousSnapshots,
      previousPostflop,
      previousRawValues: previousRawValues ? [...previousRawValues] : null,
      previousDampedValues: previousDampedValues ? [...previousDampedValues] : null,
      outerMetrics,
      continuationValueHistory,
      convergencePasses,
      stateVectors,
    };
    const deltaSeries = outerMetrics.map((metric) => Math.max(
      metric.preflopReachWeightedDelta,
      metric.conditionalRangeDelta ?? 0,
      metric.dampedContinuationUtilityDelta ?? 0,
      metric.postflopReachWeightedDelta ?? 0,
    ));
    return {
      id: hashValue({ configurationHash: this.configurationHash, checkpoint }),
      trust: "Experimental" as const,
      verifiedDatasets: 0,
      converged: stopReason === "converged",
      stopReason,
      preflop,
      conditionalRanges: finalSnapshots,
      postflopArtifacts,
      outerMetrics,
      continuationValueHistory,
      contraction: contractionRatios(deltaSeries),
      cache: this.cache.metrics(),
      checkpoint,
      gateD: {
        threshold: 0.02,
        patience: 3,
        usesReachWeightedPostflopDelta: true,
        passed: stopReason === "converged",
      },
      limitation: "Deterministic fixed point of the frozen reduced HU abstraction; not full-game GTO Hold'em.",
    };
  }
}