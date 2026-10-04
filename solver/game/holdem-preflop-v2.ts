import { enumerateHoleCombos, type HoleCombo, type SolverCard } from "../cards/cards";
import { WeightedRange } from "../cards/range";
import { privateDealDistribution, samplePrivateDeal } from "../cards/private-chance";
import type { StrategicContinuationProvider } from "../continuation/engine";
import { DeterministicRandom } from "../core/random";
import { hashValue } from "../core/stable";
import { estimateComputeBudget } from "../core/resources";
import {
  applyBettingAction,
  createPreflopBettingState,
  legalBettingActions,
  type BettingAction,
  type BettingState,
} from "./betting";
import type { GameDefinition } from "./definition";

type RegretState = { actions: string[]; regrets: number[]; strategySum: number[] };

export type HoldemPreflopV2Configuration = {
  id: string;
  seed: number;
  iterations: number;
  metricInterval: number;
  stack: number;
  smallBlind: number;
  bigBlind: number;
  sbOpenRaiseTo: number[];
  bbVsLimpRaiseTo: number[];
  bbThreeBetTo: number[];
  sbFourBetTo: number[];
  maximumRaises: number;
  limpAllowed?: boolean;
  jamAllowed?: boolean;
  continuationBoard: SolverCard[];
  continuationAbstractionId: string;
};

export type HoldemPreflopV2Metric = {
  iteration: number;
  infosets: number;
  averagePositiveRegret: number;
  strategyDelta: number;
  samplesPerSecond: number;
  elapsedMs: number;
};

export type RangeInspectionRow = {
  combo: string;
  canonical: string;
  priorReach: number;
  actionProbability: number;
  conditionalWeight: number;
  normalizedWeight: number;
};

export function holdemPreflopActionId(action: BettingAction) {
  if (action.type === "raise") return `raise:${action.raiseTo}`;
  return action.type;
}

function regretStrategy(regrets: number[]) {
  const positive = regrets.map((regret) => Math.max(0, regret));
  const total = positive.reduce((sum, regret) => sum + regret, 0);
  return total > 1e-15 ? positive.map((regret) => regret / total) : positive.map(() => 1 / positive.length);
}

function averageStrategy(state: RegretState) {
  const total = state.strategySum.reduce((sum, value) => sum + value, 0);
  return total > 1e-15 ? state.strategySum.map((value) => value / total) : regretStrategy(state.regrets);
}

export function createHoldemPreflopV2Definition(configuration: HoldemPreflopV2Configuration): GameDefinition {
  return {
    id: configuration.id,
    game: "NLHE",
    format: "heads-up-preflop-v2",
    utilityModel: "solved-continuation",
    players: [
      { id: "SB", position: "SB", startingStack: configuration.stack },
      { id: "BB", position: "BB", startingStack: configuration.stack },
    ],
    smallBlind: configuration.smallBlind,
    bigBlind: configuration.bigBlind,
    antePerPlayer: 0,
    bigBlindAnte: 0,
    abstraction: {
      openRaiseTo: configuration.sbOpenRaiseTo,
      threeBetTo: configuration.bbThreeBetTo,
      fourBetTo: configuration.sbFourBetTo,
      jamAllowed: configuration.jamAllowed ?? true,
      maximumRaisesPerRound: configuration.maximumRaises,
    },
  };
}

export function holdemPreflopRaiseTargets(configuration: HoldemPreflopV2Configuration, state: BettingState) {
  if (state.raises >= configuration.maximumRaises) return [];
  const voluntary = state.history.filter((event) => ["fold", "check", "call", "raise", "all-in"].includes(event.action));
  if (state.raises === 0 && voluntary.length === 0) return configuration.sbOpenRaiseTo;
  if (state.raises === 0) return configuration.bbVsLimpRaiseTo;
  if (state.raises === 1 && state.actingPlayerId === "BB") return configuration.bbThreeBetTo;
  if (state.raises === 1 && state.actingPlayerId === "SB") return configuration.sbFourBetTo;
  return configuration.sbFourBetTo;
}

export function holdemPreflopLegalActions(configuration: HoldemPreflopV2Configuration, state: BettingState) {
  let actions = legalBettingActions(state, holdemPreflopRaiseTargets(configuration, state));
  if (state.raises >= configuration.maximumRaises) actions = actions.filter((action) => action.type !== "raise" && action.type !== "all-in");
  if (configuration.jamAllowed === false) actions = actions.filter((action) => action.type !== "all-in");
  const voluntary = state.history.filter((event) => ["fold", "check", "call", "raise", "all-in"].includes(event.action));
  if (configuration.limpAllowed === false && state.actingPlayerId === "SB" && voluntary.length === 0) {
    actions = actions.filter((action) => action.type !== "call");
  }
  return actions;
}

export function holdemPreflopInformationSet(state: BettingState, combo: HoleCombo) {
  const actor = state.actingPlayerId;
  const publicHistory = state.history
    .filter((event) => ["fold", "check", "call", "raise", "all-in"].includes(event.action))
    .map((event) => event.action === "raise" ? `${event.playerId}:raise:${event.raiseTo}` : `${event.playerId}:${event.action}`)
    .join(",") || "root";
  return `${actor}|${combo.id}|${publicHistory}`;
}

export class HoldemPreflopV2Solver {
  readonly combos = enumerateHoleCombos();
  readonly definition: GameDefinition;
  readonly solveId: string;
  private readonly random: DeterministicRandom;
  private readonly infosets = new Map<string, RegretState>();
  private iteration = 0;
  private startedAt = 0;
  private metrics: HoldemPreflopV2Metric[] = [];
  private previous = new Map<string, number>();

  constructor(
    readonly configuration: HoldemPreflopV2Configuration,
    readonly continuation: StrategicContinuationProvider,
    readonly dealRanges: [WeightedRange, WeightedRange] | null = null,
  ) {
    this.definition = createHoldemPreflopV2Definition(configuration);
    this.random = new DeterministicRandom(configuration.seed);
    this.solveId = hashValue({
      definition: this.definition,
      configuration,
      continuation: continuation.id,
      dealRanges: dealRanges?.map((range) => range.entries().map(({ combo, weight }) => [combo.id, weight])),
    });
  }

  private sampleDeal(): [HoleCombo, HoleCombo] {
    if (this.dealRanges) {
      const distribution = privateDealDistribution(this.dealRanges[0], this.dealRanges[1], this.configuration.continuationBoard);
      return samplePrivateDeal(distribution, this.random.next());
    }
    const first = this.combos[this.random.integer(this.combos.length)];
    let second = this.combos[this.random.integer(this.combos.length)];
    const blocked = new Set([first.first.id, first.second.id]);
    while (blocked.has(second.first.id) || blocked.has(second.second.id)) second = this.combos[this.random.integer(this.combos.length)];
    return [first, second];
  }

  private raiseTargets(state: BettingState) {
    return holdemPreflopRaiseTargets(this.configuration, state);
  }

  private legal(state: BettingState) {
    return holdemPreflopLegalActions(this.configuration, state);
  }

  private key(state: BettingState, combo: HoleCombo) {
    return holdemPreflopInformationSet(state, combo);
  }

  private info(key: string, actions: BettingAction[]) {
    const ids = actions.map(holdemPreflopActionId);
    const existing = this.infosets.get(key);
    if (existing) {
      if (existing.actions.join("|") !== ids.join("|")) throw new Error(`Preflop V2 infoset ${key} changed legal actions.`);
      return existing;
    }
    const state = { actions: ids, regrets: ids.map(() => 0), strategySum: ids.map(() => 0) };
    this.infosets.set(key, state);
    return state;
  }

  private terminalUtility(state: BettingState, deals: [HoleCombo, HoleCombo], player: 0 | 1) {
    const active = state.players.filter((candidate) => !candidate.folded);
    const contributions = state.players.map((candidate) => candidate.committed + candidate.deadCommitted) as [number, number];
    if (active.length === 1) {
      const winner = state.players.indexOf(active[0]) as 0 | 1;
      const value = state.pot - contributions[winner];
      return player === winner ? value : -contributions[player];
    }
    const ranges = {
      playerZero: new WeightedRange([{ combo: deals[0], weight: 1 }]),
      playerOne: new WeightedRange([{ combo: deals[1], weight: 1 }]),
      fixedCombos: deals,
    };
    return this.continuation.evaluate({
      state: {
        street: this.configuration.continuationBoard.length === 0 ? "preflop" : this.configuration.continuationBoard.length === 3 ? "flop" : this.configuration.continuationBoard.length === 4 ? "turn" : "river",
        board: this.configuration.continuationBoard,
        pot: state.pot,
        stacks: state.players.map((candidate) => candidate.stack) as [number, number],
        contributions,
        actingPlayer: 0,
        inPositionPlayer: 0,
        actionHistory: state.history.map((event) => holdemPreflopActionId(event.action === "raise" ? { type: "raise", raiseTo: event.raiseTo! } : { type: event.action as BettingAction["type"] } as BettingAction)),
      },
      ranges,
      context: { abstractionId: this.configuration.continuationAbstractionId },
    }).utilities[player];
  }

  private traverse(state: BettingState, deals: [HoleCombo, HoleCombo], updatingPlayer: 0 | 1, reach: [number, number]): number {
    if (state.complete) return this.terminalUtility(state, deals, updatingPlayer);
    const actor = state.actingPlayerId === "SB" ? 0 : 1;
    const actions = this.legal(state);
    const key = this.key(state, deals[actor]);
    const info = this.info(key, actions);
    const strategy = regretStrategy(info.regrets);
    const utilities = actions.map((action, index) => {
      const nextReach: [number, number] = [...reach];
      nextReach[actor] *= strategy[index];
      return this.traverse(applyBettingAction(state, action), deals, updatingPlayer, nextReach);
    });
    const value = utilities.reduce((sum, utility, index) => sum + strategy[index] * utility, 0);
    if (actor === updatingPlayer) {
      const opponentReach = reach[actor === 0 ? 1 : 0];
      info.regrets = info.regrets.map((regret, index) => regret + opponentReach * (utilities[index] - value));
      info.strategySum = info.strategySum.map((sum, index) => sum + reach[actor] * strategy[index]);
    }
    return value;
  }

  iterate() {
    if (!this.startedAt) this.startedAt = Date.now();
    const deals = this.sampleDeal();
    this.traverse(createPreflopBettingState(this.definition), deals, 0, [1, 1]);
    this.traverse(createPreflopBettingState(this.definition), deals, 1, [1, 1]);
    this.iteration += 1;
  }

  private measure() {
    let delta = 0;
    const positives: number[] = [];
    this.infosets.forEach((state, key) => {
      state.regrets.forEach((regret) => positives.push(Math.max(0, regret)));
      averageStrategy(state).forEach((probability, index) => {
        const snapshotKey = `${key}|${state.actions[index]}`;
        delta = Math.max(delta, Math.abs(probability - (this.previous.get(snapshotKey) ?? 0)));
        this.previous.set(snapshotKey, probability);
      });
    });
    const elapsedMs = Math.max(1, Date.now() - this.startedAt);
    this.metrics.push({
      iteration: this.iteration,
      infosets: this.infosets.size,
      averagePositiveRegret: positives.reduce((sum, value) => sum + value, 0) / Math.max(1, positives.length) / this.iteration,
      strategyDelta: delta,
      samplesPerSecond: this.iteration / (elapsedMs / 1000),
      elapsedMs,
    });
  }

  solve() {
    while (this.iteration < this.configuration.iterations) {
      this.iterate();
      if (this.iteration % this.configuration.metricInterval === 0 || this.iteration === this.configuration.iterations) this.measure();
    }
    return {
      id: this.solveId,
      game: this.definition,
      configuration: this.configuration,
      continuation: { id: this.continuation.id, level: this.continuation.level },
      iterations: this.iteration,
      infosets: this.infosets.size,
      metrics: [...this.metrics],
      strategy: Object.fromEntries([...this.infosets].map(([key, state]) => [
        key,
        Object.fromEntries(state.actions.map((action, index) => [action, averageStrategy(state)[index]])),
      ])),
      exploitability: null,
      nashConv: null,
      trust: "Experimental" as const,
    };
  }

  estimateTree(iterations = this.configuration.iterations) {
    let nodes = 0;
    let decisionNodes = 0;
    let terminalNodes = 0;
    const visit = (state: BettingState) => {
      nodes += 1;
      if (state.complete) {
        terminalNodes += 1;
        return;
      }
      decisionNodes += 1;
      this.legal(state).forEach((action) => visit(applyBettingAction(state, action)));
    };
    visit(createPreflopBettingState(this.definition));
    const estimatedInfosets = decisionNodes * 1326;
    return {
      nodesPerDeal: nodes,
      decisionNodesPerDeal: decisionNodes,
      terminalNodesPerDeal: terminalNodes,
      estimatedInfosets,
      compute: estimateComputeBudget(estimatedInfosets, 3, iterations),
    };
  }

  inspectRange(player: 0 | 1, publicActions: string[], blockedCards: SolverCard[] = []): RangeInspectionRow[] {
    const blocked = new Set(blockedCards.map((card) => card.id));
    const source = this.dealRanges?.[player] ?? WeightedRange.uniform(this.combos);
    const compatible = source.entries().filter(({ combo, weight }) => weight > 0 && !blocked.has(combo.first.id) && !blocked.has(combo.second.id));
    const rows = compatible.map(({ combo, weight }) => {
      let state = createPreflopBettingState(this.definition);
      let actionProbability = 1;
      publicActions.forEach((selected) => {
        if (state.complete) throw new Error("Range inspection path continues after a terminal node.");
        const actor = state.actingPlayerId === "SB" ? 0 : 1;
        const actions = this.legal(state);
        const chosen = actions.find((action) => holdemPreflopActionId(action) === selected);
        if (!chosen) throw new Error(`Action ${selected} is illegal on the inspected path.`);
        if (actor === player) {
          const key = this.key(state, combo);
          const info = this.infosets.get(key);
          const probabilities = info ? averageStrategy(info) : actions.map(() => 1 / actions.length);
          actionProbability *= probabilities[actions.indexOf(chosen)];
        }
        state = applyBettingAction(state, chosen);
      });
      return { combo: combo.notation, canonical: combo.canonical, priorReach: weight, actionProbability, conditionalWeight: weight * actionProbability, normalizedWeight: 0 };
    });
    const total = rows.reduce((sum, row) => sum + row.conditionalWeight, 0);
    return rows.map((row) => ({ ...row, normalizedWeight: total > 0 ? row.conditionalWeight / total : 0 }));
  }
}
