import type { SolverCard } from "../cards/cards";
import { privateDealDistribution, type PrivateDealOutcome } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import type { StrategicContinuationProvider } from "../continuation/engine";
import type { BehavioralStrategy, ExtensiveGame, Player } from "../core/types";
import { hashValue } from "../core/stable";
import {
  applyBettingAction,
  createPreflopBettingState,
  type BettingAction,
  type BettingState,
} from "../game/betting";
import {
  createHoldemPreflopV2Definition,
  holdemPreflopActionId,
  holdemPreflopInformationSet,
  holdemPreflopLegalActions,
  type HoldemPreflopV2Configuration,
} from "../game/holdem-preflop-v2";
import { BestResponseEvaluator, StrategyEvaluator } from "./best-response";

type PreflopEvaluationAction = `deal:${number}` | string;
type PreflopEvaluationState = {
  dealIndex: number | null;
  betting: BettingState | null;
};

export type HoldemPreflopEvaluationMetrics = {
  utilities: [number, number];
  bestResponseValues: [number, number];
  nashConv: number;
  exploitability: number;
  informationSetsEvaluated: number;
  nodesEvaluated: number;
  strategyEvaluationMs: number;
  bestResponseEvaluationMs: number;
  totalEvaluationMs: number;
  chanceOutcomes: number;
  chanceResolution: "exact-enumeration";
};

function parseAction(id: string): BettingAction {
  if (id.startsWith("raise:")) return { type: "raise", raiseTo: Number(id.slice(6)) };
  if (id === "fold" || id === "check" || id === "call" || id === "all-in") return { type: id };
  throw new Error(`Unknown preflop action ${id}.`);
}

export class HoldemPreflopEvaluationGame implements ExtensiveGame<PreflopEvaluationState, PreflopEvaluationAction> {
  readonly id: string;
  readonly definition: unknown;
  readonly deals: PrivateDealOutcome[];
  private readonly gameDefinition;

  constructor(
    readonly configuration: HoldemPreflopV2Configuration,
    readonly ranges: [WeightedRange, WeightedRange],
    readonly continuation: StrategicContinuationProvider,
    readonly board: SolverCard[] = configuration.continuationBoard,
  ) {
    this.deals = privateDealDistribution(ranges[0], ranges[1], board);
    this.gameDefinition = createHoldemPreflopV2Definition(configuration);
    this.definition = {
      game: this.gameDefinition,
      ranges: ranges.map((range) => range.entries().filter(({ weight }) => weight > 0).map(({ combo, weight }) => [combo.id, weight])),
      board: board.map((card) => card.id),
      continuation: continuation.id,
      evaluationTraversal: "exact-private-card-enumeration",
    };
    this.id = `holdem-preflop-evaluation:${hashValue(this.definition)}`;
  }

  initialState(): PreflopEvaluationState {
    return { dealIndex: null, betting: null };
  }

  actor(state: PreflopEvaluationState) {
    if (state.dealIndex === null) return "chance" as const;
    if (!state.betting || state.betting.complete) return null;
    return state.betting.actingPlayerId === "SB" ? 0 as const : 1 as const;
  }

  isTerminal(state: PreflopEvaluationState) {
    return state.dealIndex !== null && Boolean(state.betting?.complete);
  }

  utility(state: PreflopEvaluationState, player: Player) {
    if (!this.isTerminal(state) || state.dealIndex === null || !state.betting) throw new Error("Preflop utility requires a terminal dealt state.");
    const deal = this.deals[state.dealIndex];
    const active = state.betting.players.filter((candidate) => !candidate.folded);
    const contributions = state.betting.players.map((candidate) => candidate.committed + candidate.deadCommitted) as [number, number];
    if (active.length === 1) {
      const winner = state.betting.players.indexOf(active[0]) as Player;
      return player === winner ? state.betting.pot - contributions[winner] : -contributions[player];
    }
    const result = this.continuation.evaluate({
      state: {
        street: this.board.length === 0 ? "preflop" : this.board.length === 3 ? "flop" : this.board.length === 4 ? "turn" : "river",
        board: this.board,
        pot: state.betting.pot,
        stacks: state.betting.players.map((candidate) => candidate.stack) as [number, number],
        contributions,
        actingPlayer: 0,
        inPositionPlayer: 0,
        actionHistory: state.betting.history
          .filter((event) => ["fold", "check", "call", "raise", "all-in"].includes(event.action))
          .map((event) => event.action === "raise" ? `raise:${event.raiseTo}` : event.action),
      },
      ranges: {
        playerZero: new WeightedRange([{ combo: deal.playerZero, weight: 1 }]),
        playerOne: new WeightedRange([{ combo: deal.playerOne, weight: 1 }]),
        fixedCombos: [deal.playerZero, deal.playerOne],
      },
      context: { abstractionId: this.configuration.continuationAbstractionId },
    });
    return result.utilities[player];
  }

  actions(state: PreflopEvaluationState): readonly PreflopEvaluationAction[] {
    if (state.dealIndex === null) return [];
    if (!state.betting || state.betting.complete) return [];
    return holdemPreflopLegalActions(this.configuration, state.betting).map(holdemPreflopActionId);
  }

  next(state: PreflopEvaluationState, action: PreflopEvaluationAction): PreflopEvaluationState {
    if (state.dealIndex === null) {
      if (!action.startsWith("deal:")) throw new Error("Preflop evaluation root requires a private deal.");
      const dealIndex = Number(action.slice(5));
      if (!Number.isInteger(dealIndex) || !this.deals[dealIndex]) throw new Error("Invalid private deal index.");
      return { dealIndex, betting: createPreflopBettingState(this.gameDefinition) };
    }
    if (!state.betting) throw new Error("Dealt preflop state is missing betting state.");
    return { dealIndex: state.dealIndex, betting: applyBettingAction(state.betting, parseAction(action)) };
  }

  chanceOutcomes(state: PreflopEvaluationState) {
    if (state.dealIndex !== null) return [];
    return this.deals.map((deal, index) => ({
      action: `deal:${index}` as PreflopEvaluationAction,
      probability: deal.probability,
    }));
  }

  informationSet(state: PreflopEvaluationState) {
    const actor = this.actor(state);
    if (actor === null || actor === "chance" || state.dealIndex === null || !state.betting) {
      throw new Error("Chance and terminal preflop states have no information set.");
    }
    const deal = this.deals[state.dealIndex];
    return holdemPreflopInformationSet(state.betting, actor === 0 ? deal.playerZero : deal.playerOne);
  }
}

export class HoldemPreflopStrategyEvaluator {
  constructor(readonly game: HoldemPreflopEvaluationGame) {}

  evaluate(strategy: BehavioralStrategy): HoldemPreflopEvaluationMetrics {
    const totalStart = performance.now();
    const strategyStart = performance.now();
    const utilities = new StrategyEvaluator(this.game).evaluate(strategy);
    const strategyEvaluationMs = performance.now() - strategyStart;
    if (Math.abs(utilities[0] + utilities[1]) > 1e-8) throw new Error("Hold'em preflop evaluation must be zero-sum.");
    const brStart = performance.now();
    const first = new BestResponseEvaluator(this.game).evaluate(0, strategy);
    const second = new BestResponseEvaluator(this.game).evaluate(1, strategy);
    const bestResponseEvaluationMs = performance.now() - brStart;
    const nashConv = first.value + second.value;
    return {
      utilities,
      bestResponseValues: [first.value, second.value],
      nashConv,
      exploitability: nashConv / 2,
      informationSetsEvaluated: first.informationSets + second.informationSets,
      nodesEvaluated: first.nodesVisited + second.nodesVisited,
      strategyEvaluationMs,
      bestResponseEvaluationMs,
      totalEvaluationMs: performance.now() - totalStart,
      chanceOutcomes: this.game.deals.length,
      chanceResolution: "exact-enumeration",
    };
  }
}