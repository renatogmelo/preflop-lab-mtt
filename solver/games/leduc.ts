import type { ExtensiveGame, Player } from "../core/types";

export type LeducRank = "J" | "Q" | "K";
export type LeducCard = `${LeducRank}${0 | 1}`;
export type LeducAction = `deal:${LeducCard}` | "fold" | "call" | "raise";
export type LeducPhase = "private" | "round-1" | "public" | "round-2" | "terminal";

export type LeducState = {
  phase: LeducPhase;
  privateCards: [LeducCard | null, LeducCard | null];
  publicCard: LeducCard | null;
  remainingDeck: LeducCard[];
  actingPlayer: Player | null;
  contributions: [number, number];
  stake: number;
  raises: number;
  calls: number;
  roundOne: Array<"f" | "c" | "r">;
  roundTwo: Array<"f" | "c" | "r">;
  folded: Player | null;
};

const DECK: LeducCard[] = ["J0", "J1", "Q0", "Q1", "K0", "K1"];
const RANKS: LeducRank[] = ["J", "Q", "K"];

function rank(card: LeducCard) {
  return card[0] as LeducRank;
}

function rankValue(card: LeducCard) {
  return RANKS.indexOf(rank(card));
}

function copy(state: LeducState): LeducState {
  return {
    ...state,
    privateCards: [...state.privateCards],
    remainingDeck: [...state.remainingDeck],
    contributions: [...state.contributions],
    roundOne: [...state.roundOne],
    roundTwo: [...state.roundTwo],
  };
}

function actionToken(action: LeducAction): "f" | "c" | "r" {
  if (action === "fold") return "f";
  if (action === "call") return "c";
  if (action === "raise") return "r";
  throw new Error("Chance deals do not belong in a betting history.");
}

function showdownWinner(state: LeducState): Player | null {
  if (!state.publicCard || !state.privateCards[0] || !state.privateCards[1]) {
    throw new Error("Leduc showdown requires two private cards and one public card.");
  }
  const publicRank = rank(state.publicCard);
  const firstPair = rank(state.privateCards[0]) === publicRank;
  const secondPair = rank(state.privateCards[1]) === publicRank;
  if (firstPair !== secondPair) return firstPair ? 0 : 1;
  const difference = rankValue(state.privateCards[0]) - rankValue(state.privateCards[1]);
  return difference === 0 ? null : difference > 0 ? 0 : 1;
}

/**
 * OpenSpiel-compatible two-player Leduc.
 *
 * - six physical cards: J/Q/K in two suits;
 * - ante 1 each;
 * - player 0 starts both betting rounds;
 * - two raises maximum per round, of 2 pre-public and 4 post-public;
 * - `call` represents check when nothing is owed;
 * - physical suits are observed (the default OpenSpiel variant).
 */
export class LeducPoker implements ExtensiveGame<LeducState, LeducAction> {
  readonly id = "leduc-poker-open-spiel-compatible-v1";
  readonly definition = {
    game: "Leduc Poker",
    referenceVariant: "OpenSpiel default two-player Leduc",
    players: 2,
    deck: [...DECK],
    ranks: [...RANKS],
    suitsPerRank: 2,
    ante: 1,
    startingPlayer: 0,
    rounds: 2,
    raiseSizes: [2, 4],
    maxRaisesPerRound: 2,
    suitIsomorphism: false,
    utility: "two-player zero-sum net chips",
    expectedInformationSets: 936,
  } as const;

  initialState(): LeducState {
    return {
      phase: "private",
      privateCards: [null, null],
      publicCard: null,
      remainingDeck: [...DECK],
      actingPlayer: null,
      contributions: [1, 1],
      stake: 1,
      raises: 0,
      calls: 0,
      roundOne: [],
      roundTwo: [],
      folded: null,
    };
  }

  actor(state: LeducState): Player | "chance" | null {
    if (state.phase === "terminal") return null;
    if (state.phase === "private" || state.phase === "public") return "chance";
    return state.actingPlayer;
  }

  isTerminal(state: LeducState) {
    return state.phase === "terminal";
  }

  utility(state: LeducState, player: Player) {
    if (!this.isTerminal(state)) throw new Error("Utility requested for a non-terminal Leduc state.");
    let winner: Player | null;
    if (state.folded !== null) winner = state.folded === 0 ? 1 : 0;
    else winner = showdownWinner(state);
    if (winner === null) {
      const half = (state.contributions[0] + state.contributions[1]) / 2;
      return half - state.contributions[player];
    }
    return player === winner
      ? state.contributions[player === 0 ? 1 : 0]
      : -state.contributions[player];
  }

  actions(state: LeducState): readonly LeducAction[] {
    const actor = this.actor(state);
    if (actor === null || actor === "chance") return [];
    const outstanding = state.stake - state.contributions[actor];
    const actions: LeducAction[] = [];
    if (outstanding > 0) actions.push("fold");
    actions.push("call");
    if (state.raises < 2) actions.push("raise");
    return actions;
  }

  next(state: LeducState, action: LeducAction): LeducState {
    const next = copy(state);
    if (state.phase === "private" || state.phase === "public") {
      if (!action.startsWith("deal:")) throw new Error("Leduc chance node requires a card deal.");
      const card = action.slice(5) as LeducCard;
      const index = next.remainingDeck.indexOf(card);
      if (index < 0) throw new Error(`Leduc card ${card} is unavailable.`);
      next.remainingDeck.splice(index, 1);
      if (state.phase === "private") {
        if (next.privateCards[0] === null) next.privateCards[0] = card;
        else if (next.privateCards[1] === null) next.privateCards[1] = card;
        else throw new Error("Both Leduc private cards were already dealt.");
        if (next.privateCards[1] !== null) {
          next.phase = "round-1";
          next.actingPlayer = 0;
        }
      } else {
        next.publicCard = card;
        next.phase = "round-2";
        next.actingPlayer = 0;
      }
      return next;
    }

    const actor = state.actingPlayer;
    if (actor === null || !this.actions(state).includes(action)) {
      throw new Error(`Illegal Leduc action ${action}.`);
    }
    const history = next.phase === "round-1" ? next.roundOne : next.roundTwo;
    history.push(actionToken(action));
    if (action === "fold") {
      next.folded = actor;
      next.phase = "terminal";
      next.actingPlayer = null;
      return next;
    }
    const outstanding = next.stake - next.contributions[actor];
    if (action === "call") {
      next.contributions[actor] += outstanding;
      next.calls += 1;
      const roundComplete = next.raises === 0 ? next.calls === 2 : next.calls === 1;
      if (roundComplete) {
        if (next.phase === "round-1") {
          next.phase = "public";
          next.raises = 0;
          next.calls = 0;
          next.actingPlayer = null;
        } else {
          next.phase = "terminal";
          next.actingPlayer = null;
        }
      } else next.actingPlayer = actor === 0 ? 1 : 0;
      return next;
    }
    const raiseSize = next.phase === "round-1" ? 2 : 4;
    next.contributions[actor] += outstanding + raiseSize;
    next.stake += raiseSize;
    next.raises += 1;
    next.calls = 0;
    next.actingPlayer = actor === 0 ? 1 : 0;
    return next;
  }

  chanceOutcomes(state: LeducState) {
    if (state.phase !== "private" && state.phase !== "public") return [];
    const probability = 1 / state.remainingDeck.length;
    return state.remainingDeck.map((card) => ({
      action: `deal:${card}` as LeducAction,
      probability,
    }));
  }

  informationSet(state: LeducState) {
    const actor = this.actor(state);
    if (actor === null || actor === "chance") throw new Error("Chance and terminal Leduc states have no information set.");
    const privateCard = state.privateCards[actor];
    if (!privateCard) throw new Error("Leduc player cannot act before receiving a private card.");
    return [
      actor,
      privateCard,
      state.publicCard ?? "-",
      state.roundOne.join("") || "-",
      state.roundTwo.join("") || "-",
    ].join("|");
  }
}

export function inspectLeducTree(game = new LeducPoker()) {
  let nodes = 0;
  let terminals = 0;
  let chanceNodes = 0;
  let maximumDepth = 0;
  const informationSets = new Set<string>();
  const visit = (state: LeducState, depth: number) => {
    nodes += 1;
    maximumDepth = Math.max(maximumDepth, depth);
    if (game.isTerminal(state)) {
      terminals += 1;
      return;
    }
    const actor = game.actor(state);
    if (actor === "chance") {
      chanceNodes += 1;
      game.chanceOutcomes(state).forEach((outcome) => visit(game.next(state, outcome.action), depth + 1));
      return;
    }
    informationSets.add(game.informationSet(state));
    game.actions(state).forEach((action) => visit(game.next(state, action), depth + 1));
  };
  visit(game.initialState(), 0);
  return { nodes, terminals, chanceNodes, informationSets: informationSets.size, maximumDepth };
}
