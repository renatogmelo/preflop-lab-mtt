import { privateDealDistribution } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import { ContinuationArtifactCache } from "../continuation/cache";
import type { ContinuationRequest, ContinuationResult, StrategicContinuationProvider } from "../continuation/engine";
import { hashValue } from "../core/stable";
import type { BehavioralStrategy } from "../core/types";
import { StrategyEvaluator } from "../evaluation/best-response";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../evaluation/holdem-preflop";
import { applyBettingAction, createPreflopBettingState } from "../game/betting";
import { createHoldemPreflopV2Definition, holdemPreflopActionId, holdemPreflopLegalActions, HoldemPreflopV2Solver, type HoldemPreflopV2Configuration } from "../game/holdem-preflop-v2";
import { RangePostflopHoldemSubgame, solveRangePostflopSubgame, type FutureBoardProvider, type RangePostflopAbstraction, type RangePostflopArtifact, type RangePostflopSolveConfiguration } from "../game/range-postflop-subgame";
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
  convergence: { preflopStrategyDelta: number; conditionalRangeDelta: number; continuationUtilityDelta: number };
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

function evaluatePairs(artifact: RangePostflopArtifact, config: CoupledSolverConfiguration, pot: number, stacks: [number, number]) {
  const values = new Map<string, [number, number]>();
  for (const deal of privateDealDistribution(config.ranges[0], config.ranges[1], config.flop)) {
    const game = new RangePostflopHoldemSubgame({
      id: "pair-evaluation:" + deal.playerZero.id + ":" + deal.playerOne.id,
      ranges: [
        new WeightedRange([{ combo: deal.playerZero, weight: 1 }]),
        new WeightedRange([{ combo: deal.playerOne, weight: 1 }]),
      ],
      flop: config.flop,
      pot,
      stacks,
      firstPlayer: 1,
      abstraction: config.postflopAbstraction,
      boardProvider: config.boardProvider,
      rangeSource: { description: "Pairwise evaluation under the range-solved strategy." },
    });
    values.set(pairKey(deal.playerZero.id, deal.playerOne.id), new StrategyEvaluator(game).evaluate(artifact.strategy));
  }
  return values;
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
  readonly cache = new ContinuationArtifactCache<RangePostflopArtifact>();

  constructor(readonly configuration: CoupledSolverConfiguration, readonly initialContinuation: StrategicContinuationProvider) {
    if (!(configuration.dampingAlpha > 0 && configuration.dampingAlpha <= 1)) throw new Error("Damping alpha must be in (0, 1].");
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
      const solvedValues = evaluatePairs(postflop, this.configuration, pot, stacks);
      const values = damp(previousValues, solvedValues, this.configuration.dampingAlpha);
      const provider = new PairTableContinuationProvider(values, { pot, stacks }, postflop);
      const next = new HoldemPreflopV2Solver(
        { ...this.configuration.preflop, seed: this.configuration.preflop.seed + iteration },
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
        runtimeMs: performance.now() - started,
      });
      postflopArtifacts.push(postflop);
      preflop = next;
      previousStrategy = next.strategy;
      previousSnapshots = snapshots;
      previousPostflop = postflop.strategy;
      previousValues = values;
      finalSnapshots = snapshots;
      if (rangeDelta !== null && continuationDelta !== null
        && preflopDelta <= this.configuration.convergence.preflopStrategyDelta
        && rangeDelta <= this.configuration.convergence.conditionalRangeDelta
        && continuationDelta <= this.configuration.convergence.continuationUtilityDelta) break;
    }

    const last = outerMetrics.at(-1);
    const converged = Boolean(last
      && last.conditionalRangeDelta !== null
      && last.continuationUtilityDelta !== null
      && Number(last.preflopStrategyDelta) <= this.configuration.convergence.preflopStrategyDelta
      && Number(last.conditionalRangeDelta) <= this.configuration.convergence.conditionalRangeDelta
      && Number(last.continuationUtilityDelta) <= this.configuration.convergence.continuationUtilityDelta);
    return {
      id: "coupled-solve:" + hashValue({ outerMetrics, finalPreflop: preflop.id }),
      trust: "Experimental" as const,
      preflop,
      conditionalRanges: finalSnapshots,
      postflopArtifacts,
      outerMetrics,
      cache: this.cache.metrics(),
      converged,
      convergenceCriteria: this.configuration.convergence,
      dampingAlpha: this.configuration.dampingAlpha,
      limitation: "Approximate equilibrium of the declared reduced HU abstractions; not full-game GTO Hold'em.",
    };
  }
}
