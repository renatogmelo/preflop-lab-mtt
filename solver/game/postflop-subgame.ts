import { compareHoldemHands } from "../cards/hand-evaluator";
import { createHoldemDeck, type HoleCombo, type SolverCard } from "../cards/cards";
import type { ExtensiveGame, Player } from "../core/types";
import { compileGameTree } from "../tree/compiled";

export type HoldemStreet = "flop" | "turn" | "river";
export type PostflopAction = "check" | "fold" | "call" | `bet:${number}` | `deal:${number}`;

export type PostflopAbstraction = {
  flopBetFractions: number[];
  turnBetFractions: number[];
  riverBetFractions: number[];
  maxRaisesPerStreet: 0;
};

export type PostflopSubgameDefinition = {
  id: string;
  hero: HoleCombo;
  villain: HoleCombo;
  flop: [SolverCard, SolverCard, SolverCard];
  pot: number;
  stacks: [number, number];
  firstPlayer: Player;
  abstraction: PostflopAbstraction;
};

export type PostflopState = {
  street: HoldemStreet;
  board: SolverCard[];
  pot: number;
  stacks: [number, number];
  contributions: [number, number];
  actingPlayer: Player | "chance" | null;
  streetHistory: PostflopAction[];
  history: PostflopAction[];
  folded: Player | null;
  terminal: boolean;
};

function copy(state: PostflopState): PostflopState {
  return {
    ...state,
    board: [...state.board],
    stacks: [...state.stacks],
    contributions: [...state.contributions],
    streetHistory: [...state.streetHistory],
    history: [...state.history],
  };
}

function fractions(definition: PostflopSubgameDefinition, street: HoldemStreet) {
  if (street === "flop") return definition.abstraction.flopBetFractions;
  if (street === "turn") return definition.abstraction.turnBetFractions;
  return definition.abstraction.riverBetFractions;
}

export class PostflopHoldemSubgame implements ExtensiveGame<PostflopState, PostflopAction> {
  readonly id: string;
  readonly definition: PostflopSubgameDefinition;
  private readonly deadIds: Set<number>;

  constructor(definition: PostflopSubgameDefinition) {
    this.id = definition.id;
    this.definition = definition;
    const cards = [definition.hero.first, definition.hero.second, definition.villain.first, definition.villain.second, ...definition.flop];
    if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error("Postflop subgame contains duplicate cards.");
    if (!(definition.pot > 0) || definition.stacks.some((stack) => stack < 0)) throw new Error("Postflop pot/stacks are invalid.");
    this.deadIds = new Set(cards.slice(0, 4).map((card) => card.id));
  }

  initialState(): PostflopState {
    return {
      street: "flop",
      board: [...this.definition.flop],
      pot: this.definition.pot,
      stacks: [...this.definition.stacks],
      contributions: [this.definition.pot / 2, this.definition.pot / 2],
      actingPlayer: this.definition.firstPlayer,
      streetHistory: [],
      history: [],
      folded: null,
      terminal: false,
    };
  }

  actor(state: PostflopState) {
    return state.terminal ? null : state.actingPlayer;
  }

  isTerminal(state: PostflopState) {
    return state.terminal;
  }

  utility(state: PostflopState, player: Player) {
    if (!state.terminal) throw new Error("Postflop utility requested before terminal state.");
    let winner: Player | null;
    if (state.folded !== null) winner = state.folded === 0 ? 1 : 0;
    else {
      const comparison = compareHoldemHands(
        [this.definition.hero.first, this.definition.hero.second, ...state.board],
        [this.definition.villain.first, this.definition.villain.second, ...state.board],
      );
      winner = comparison === 0 ? null : comparison > 0 ? 0 : 1;
    }
    if (winner === null) return state.pot / 2 - state.contributions[player];
    return player === winner ? state.pot - state.contributions[player] : -state.contributions[player];
  }

  actions(state: PostflopState): readonly PostflopAction[] {
    if (state.terminal || state.actingPlayer === "chance" || state.actingPlayer === null) return [];
    const last = state.streetHistory.at(-1);
    if (last?.startsWith("bet:")) return ["fold", "call"];
    const actor = state.actingPlayer;
    const bets = fractions(this.definition, state.street)
      .map((fraction) => Math.min(state.pot * fraction, state.stacks[0], state.stacks[1]))
      .filter((amount) => amount > 1e-9 && amount <= state.stacks[actor] + 1e-9)
      .map((amount) => `bet:${Number(amount.toFixed(6))}` as PostflopAction);
    return ["check", ...new Set(bets)];
  }

  private finishStreet(state: PostflopState) {
    if (state.street === "river") {
      state.terminal = true;
      state.actingPlayer = null;
      return;
    }
    state.actingPlayer = "chance";
  }

  next(state: PostflopState, action: PostflopAction): PostflopState {
    const next = copy(state);
    if (state.actingPlayer === "chance") {
      if (!action.startsWith("deal:")) throw new Error("Postflop chance node requires a board card.");
      const cardId = Number(action.slice(5));
      const card = createHoldemDeck().find((candidate) => candidate.id === cardId);
      if (!card || next.board.some((existing) => existing.id === cardId) || this.deadIds.has(cardId)) {
        throw new Error("Invalid postflop chance card.");
      }
      next.board.push(card);
      next.street = next.board.length === 4 ? "turn" : "river";
      next.streetHistory = [];
      next.history.push(action);
      next.actingPlayer = this.definition.firstPlayer;
      return next;
    }
    const actor = state.actingPlayer;
    if (actor === null || !this.actions(state).includes(action)) throw new Error(`Illegal postflop action ${action}.`);
    next.streetHistory.push(action);
    next.history.push(action);
    if (action === "fold") {
      next.folded = actor;
      next.terminal = true;
      next.actingPlayer = null;
      return next;
    }
    if (action === "call") {
      const previous = state.streetHistory.at(-1);
      if (!previous?.startsWith("bet:")) throw new Error("Call requires an outstanding bet.");
      const amount = Number(previous.slice(4));
      next.stacks[actor] -= amount;
      next.contributions[actor] += amount;
      next.pot += amount;
      this.finishStreet(next);
      return next;
    }
    if (action.startsWith("bet:")) {
      const amount = Number(action.slice(4));
      next.stacks[actor] -= amount;
      next.contributions[actor] += amount;
      next.pot += amount;
      next.actingPlayer = actor === 0 ? 1 : 0;
      return next;
    }
    if (state.streetHistory.at(-1) === "check") this.finishStreet(next);
    else next.actingPlayer = actor === 0 ? 1 : 0;
    return next;
  }

  chanceOutcomes(state: PostflopState) {
    if (state.actingPlayer !== "chance") return [];
    const blocked = new Set([...this.deadIds, ...state.board.map((card) => card.id)]);
    const cards = createHoldemDeck().filter((card) => !blocked.has(card.id));
    return cards.map((card) => ({ action: `deal:${card.id}` as PostflopAction, probability: 1 / cards.length }));
  }

  informationSet(state: PostflopState) {
    const actor = this.actor(state);
    if (actor === null || actor === "chance") throw new Error("Chance and terminal postflop states have no information set.");
    const combo = actor === 0 ? this.definition.hero : this.definition.villain;
    return [actor, combo.id, state.street, state.board.map((card) => card.id).join("-"), state.history.join(",") || "root"].join("|");
  }

  estimateTree() {
    return compileGameTree(this).statistics;
  }
}
