import { WeightedRange } from "../cards/range";
import { ContinuationArtifactCache } from "../continuation/cache";
import type { ContinuationRequest, ContinuationResult, StrategicContinuationProvider } from "../continuation/engine";
import { hashValue } from "../core/stable";
import type { BehavioralStrategy } from "../core/types";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../evaluation/holdem-preflop";
import { applyBettingAction, createPreflopBettingState } from "../game/betting";
import { createHoldemPreflopV2Definition, holdemPreflopActionId, holdemPreflopLegalActions, HoldemPreflopV2Solver, type HoldemPreflopV2Configuration } from "../game/holdem-preflop-v2";
import { solveRangePostflopSubgame, type FutureBoardProvider, type RangePostflopAbstraction, type RangePostflopArtifact, type RangePostflopSolveConfiguration } from "../game/range-postflop-subgame";
import { conditionalRangeL1, deriveConditionalRangeSnapshots, weightedRangeFromSnapshot, type ConditionalRangeSnapshot } from "../ranges/conditional";
import { strategyDistance } from "../comparison/strategy-distance";
import type { SolverCard } from "../cards/cards";

const pairKey = (first: string, second: string) => first + "|" + second;

export class PairTableContinuationProvider implements StrategicContinuationProvider {
  readonly level = 2 as const;
  readonly eligibleForVerified = false;
  readonly id: string;

  constructor(
    readonly utilities: ReadonlyMap<string, [number, number]>,
    readonly expectedState: { pot: number; stacks: [number, number] },
    readonly sourceArtifact: RangePostflopArtifact,
  ) {
    this.id = "pair-table-continuation:" + hashValue({
      utilities: [...utilities].sort(([left], [right]) => left.localeCompare(right)),
      expectedState,
      artifact: sourceArtifact.id,
    });
  }

  evaluate(request: ContinuationRequest): ContinuationResult {
    const fixed = request.ranges.fixedCombos;
    if (!fixed) throw new Error("Pair-table continuation requires a concrete private-card pair.");
    if (Math.abs(request.state.pot - this.expectedState.pot) > 1e-9 || request.state.stacks.some((stack, index) => Math.abs(stack - this.expectedState.stacks[index]) > 1e-9)) {
      throw new Error("Pair-table continuation request is incompatible with its solved pot or stacks.");
    }
    const utilities = this.utilities.get(pairKey(fixed[0].id, fixed[1].id));
    if (!utilities) throw new Error("No solved continuation value for private pair " + fixed[0].id + "/" + fixed[1].id + ".");
    return {
      utilities,
      model: this.id,
      chanceResolution: {
        method: this.sourceArtifact.chanceAbstraction.method as "exact-enumeration" | "sampled" | "abstracted",
        description: String(this.sourceArtifact.chanceAbstraction.warning ?? "Future boards use the artifact chance model."),
      },
      strategicSolution: {
        status: "approximate-equilibrium",
        algorithm: this.sourceArtifact.algorithm.algorithm,
        iterations: this.sourceArtifact.convergence.iteration,
        nashConv: this.sourceArtifact.convergence.nashConv,
        exploitability: this.sourceArtifact.convergence.exploitability,
        averageRegret: this.sourceArtifact.convergence.averagePositiveRegret,
        strategyDelta: this.sourceArtifact.convergence.strategyDelta,
        convergenceHistory: this.sourceArtifact.convergence.history,
      },
      metadata: { artifactId: this.sourceArtifact.id, trust: "Experimental", gameScope: this.sourceArtifact.gameScope },
      computationId: hashValue({ provider: this.id, pair: fixed.map((combo) => combo.id), utilities }),
    };
  }
}

export type CoupledSolverConfiguration = {
  preflop: HoldemPreflopV2Configuration;
  ranges: [WeightedRange, WeightedRange];
  actionHistory: string[];
  flop: [SolverCard, SolverCard, SolverCard];
  postflopAbstraction: RangePostflopAbstraction;
  boardProvider: FutureBoardProvider;
  postflopSolve: RangePostflopSolveConfiguration;
  outerIterations: number;
  dampingAlpha: number;
  preflopSeedMode?: "fixed" | "incrementing";
  maximumRuntimeMs?: number;
  stopOnOscillation?: boolean;
  divergenceWindow?: number;
  rangeHashQuantization?: number;
  convergence: {
    preflopStrategyDelta: number;
    conditionalRangeDelta: number;
    continuationUtilityDelta: number;
    postflopStrategyDelta?: number;
    patience?: number;
  };
};

function terminalState(configuration: HoldemPreflopV2Configuration, history: string[]) {
  let state = createPreflopBettingState(createHoldemPreflopV2Definition(configuration));
  history.forEach((selected) => {
    const action = holdemPreflopLegalActions(configuration, state).find((candidate) => holdemPreflopActionId(candidate) === selected);
    if (!action) throw new Error("Illegal coupling path action " + selected + ".");
    state = applyBettingAction(state, action);
  });
  if (!state.complete) throw new Error("Coupling path must end at a continuation terminal.");
  return state;
}

function evaluatePairs(artifact: RangePostflopArtifact) {
  return new Map(artifact.pairUtilities.map((entry) => [
    entry.pairKey,
    entry.utilities,
  ] as [string, [number, number]]));
}

function damp(previous: ReadonlyMap<string, [number, number]> | null, solved: ReadonlyMap<string, [number, number]>, alpha: number) {
  if (!previous) return new Map(solved);
  const result = new Map<string, [number, number]>();
  solved.forEach((value, key) => {
    const old = previous.get(key) ?? value;
    const first = alpha * value[0] + (1 - alpha) * old[0];
    result.set(key, [first, -first]);
  });
  return result;
}

export function detectDivergence(values: number[], window = 3, minimumIncrease = 1e-6) {
  if (values.length < window || window < 2) return false;
  const recent = values.slice(-window);
  return recent.slice(1).every((value, index) => value > recent[index] + minimumIncrease);
}

export function detectPeriodTwoOscillation(values: number[], tolerance = 1e-6, minimumAmplitude = tolerance * 4) {
  if (values.length < 4) return { detected: false, period: null, amplitude: 0 };
  const recent = values.slice(-4);
  const recurrence = Math.max(Math.abs(recent[2] - recent[0]), Math.abs(recent[3] - recent[1]));
  const amplitude = Math.max(Math.abs(recent[1] - recent[0]), Math.abs(recent[2] - recent[1]), Math.abs(recent[3] - recent[2]));
  return { detected: recurrence <= tolerance && amplitude >= minimumAmplitude, period: recurrence <= tolerance && amplitude >= minimumAmplitude ? 2 : null, amplitude };
}

export function satisfiesConvergencePatience(passes: boolean[], patience: number) {
  if (!Number.isInteger(patience) || patience <= 0) throw new Error("Convergence patience must be a positive integer.");
  return passes.length >= patience && passes.slice(-patience).every(Boolean);
}

function valueDelta(previous: ReadonlyMap<string, [number, number]> | null, current: ReadonlyMap<string, [number, number]>) {
  if (!previous) return null;
  let result = 0;
  current.forEach((value, key) => {
    const old = previous.get(key);
    if (old) result = Math.max(result, Math.abs(value[0] - old[0]));
  });
  return result;
}

export class CoupledPreflopPostflopSolver {
  readonly cache: ContinuationArtifactCache<RangePostflopArtifact>;

  constructor(readonly configuration: CoupledSolverConfiguration, readonly initialContinuation: StrategicContinuationProvider) {
    if (!(configuration.dampingAlpha > 0 && configuration.dampingAlpha <= 1)) throw new Error("Damping alpha must be in (0, 1].");
    this.cache = new ContinuationArtifactCache(configuration.rangeHashQuantization ?? 1e-9);
  }

  solve() {
    const terminal = terminalState(this.configuration.preflop, this.configuration.actionHistory);
    const pot = terminal.pot;
    const stacks = terminal.players.map((player) => player.stack) as [number, number];
    let preflop = new HoldemPreflopV2Solver(this.configuration.preflop, this.initialContinuation, this.configuration.ranges).solve();
    let previousStrategy: BehavioralStrategy = preflop.strategy;
    let previousSnapshots: [ConditionalRangeSnapshot, ConditionalRangeSnapshot] | null = null;
    let previousPostflop: BehavioralStrategy | null = null;
    let previousValues: Map<string, [number, number]> | null = null;
    const outerMetrics: Array<Record<string, number | boolean | null>> = [];
    const postflopArtifacts: RangePostflopArtifact[] = [];
    const continuationValueHistory: Array<{ outerIteration: number; values: Array<{ pairKey: string; utilityP0: number }> }> = [];
    const convergencePasses: boolean[] = [];
    const instabilityScores: number[] = [];
    const continuationProbes: number[] = [];
    const patience = this.configuration.convergence.patience ?? 1;
    const couplingStarted = performance.now();
    let stopReason: "iterations" | "converged" | "oscillating" | "diverging" | "runtime" = "iterations";
    let finalSnapshots: [ConditionalRangeSnapshot, ConditionalRangeSnapshot] | null = null;

    for (let iteration = 1; iteration <= this.configuration.outerIterations; iteration += 1) {
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
      const cached = this.cache.getOrCreate(identity, () => solveRangePostflopSubgame({
        id: "coupled-postflop:" + hashValue(identity),
        ranges: conditioned,
        flop: this.configuration.flop,
        pot,
        stacks,
        firstPlayer: 1,
        abstraction: this.configuration.postflopAbstraction,
        boardProvider: this.configuration.boardProvider,
        rangeSource: {
          playerZeroSnapshotId: snapshots[0].id,
          playerOneSnapshotId: snapshots[1].id,
          description: "Bayesian ranges conditioned on the preflop path.",
        },
      }, this.configuration.postflopSolve));
      const postflop = cached.value;
      const solvedValues = evaluatePairs(postflop);
      const values = damp(previousValues, solvedValues, this.configuration.dampingAlpha);
      const provider = new PairTableContinuationProvider(values, { pot, stacks }, postflop);
      const next = new HoldemPreflopV2Solver(
        { ...this.configuration.preflop, seed: this.configuration.preflop.seed + (this.configuration.preflopSeedMode === "fixed" ? 0 : iteration) },
        provider,
        this.configuration.ranges,
      ).solve();
      const evaluation = new HoldemPreflopStrategyEvaluator(
        new HoldemPreflopEvaluationGame(this.configuration.preflop, this.configuration.ranges, provider, this.configuration.flop),
      ).evaluate(next.strategy);
      const preflopDelta = strategyDistance(previousStrategy, next.strategy).maxAbsoluteDelta;
      const rangeDelta = previousSnapshots
        ? Math.max(conditionalRangeL1(previousSnapshots[0], snapshots[0]), conditionalRangeL1(previousSnapshots[1], snapshots[1]))
        : null;
      const continuationDelta = valueDelta(previousValues, values);
      const postflopDelta = previousPostflop ? strategyDistance(previousPostflop, postflop.strategy).maxAbsoluteDelta : null;
      const postflopThreshold = this.configuration.convergence.postflopStrategyDelta;
      const convergencePass = rangeDelta !== null
        && continuationDelta !== null
        && (postflopThreshold === undefined || (postflopDelta !== null && postflopDelta <= postflopThreshold))
        && preflopDelta <= this.configuration.convergence.preflopStrategyDelta
        && rangeDelta <= this.configuration.convergence.conditionalRangeDelta
        && continuationDelta <= this.configuration.convergence.continuationUtilityDelta;
      convergencePasses.push(convergencePass);
      const score = Math.max(preflopDelta, rangeDelta ?? 0, continuationDelta ?? 0, postflopDelta ?? 0);
      instabilityScores.push(score);
      const sortedValues = [...values].sort(([left], [right]) => left.localeCompare(right));
      const continuationProbe = sortedValues[0]?.[1][0] ?? 0;
      continuationProbes.push(continuationProbe);
      const oscillation = detectPeriodTwoOscillation(continuationProbes, 1e-5, 1e-4);
      const diverging = detectDivergence(instabilityScores, this.configuration.divergenceWindow ?? 3);
      continuationValueHistory.push({
        outerIteration: iteration,
        values: sortedValues.map(([key, utility]) => ({ pairKey: key, utilityP0: utility[0] })),
      });
      outerMetrics.push({
        outerIteration: iteration,
        preflopStrategyDelta: preflopDelta,
        conditionalRangeDelta: rangeDelta,
        continuationUtilityDelta: continuationDelta,
        postflopStrategyDelta: postflopDelta,
        preflopNashConv: evaluation.nashConv,
        preflopExploitability: evaluation.exploitability,
        postflopNashConv: postflop.convergence.nashConv,
        postflopExploitability: postflop.convergence.exploitability,
        dampingAlpha: this.configuration.dampingAlpha,
        cacheHit: cached.cacheHit,
        convergencePass,
        consecutivePasses: [...convergencePasses].reverse().findIndex((value) => !value) < 0
          ? convergencePasses.length
          : [...convergencePasses].reverse().findIndex((value) => !value),
        oscillating: oscillation.detected,
        oscillationPeriod: oscillation.period,
        oscillationAmplitude: oscillation.amplitude,
        diverging,
        continuationProbe,
        runtimeMs: performance.now() - started,
      });
      postflopArtifacts.push(postflop);
      preflop = next;
      previousStrategy = next.strategy;
      previousSnapshots = snapshots;
      previousPostflop = postflop.strategy;
      previousValues = values;
      finalSnapshots = snapshots;
      if (satisfiesConvergencePatience(convergencePasses, patience)) {
        stopReason = "converged";
        break;
      }
      if (diverging) {
        stopReason = "diverging";
        break;
      }
      if (oscillation.detected && this.configuration.stopOnOscillation) {
        stopReason = "oscillating";
        break;
      }
      if (this.configuration.maximumRuntimeMs !== undefined
        && performance.now() - couplingStarted >= this.configuration.maximumRuntimeMs) {
        stopReason = "runtime";
        break;
      }
    }

    const converged = stopReason === "converged";
    return {
      id: "coupled-solve:" + hashValue({ outerMetrics, finalPreflop: preflop.id }),
      trust: "Experimental" as const,
      preflop,
      conditionalRanges: finalSnapshots,
      postflopArtifacts,
      outerMetrics,
      continuationValueHistory,
      cache: this.cache.metrics(),
      converged,
      stopReason,
      convergencePatience: patience,
      convergenceCriteria: this.configuration.convergence,
      dampingAlpha: this.configuration.dampingAlpha,
      limitation: "Approximate equilibrium of the declared reduced HU abstractions; not full-game GTO Hold'em.",
    };
  }
}
