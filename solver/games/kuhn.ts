import {
  type BehavioralStrategy,
  type ExtensiveGame,
  type Player,
} from "../core/types";

export type KuhnCard = "J" | "Q" | "K";
export type KuhnAction = `deal:${KuhnCard}${KuhnCard}` | "check" | "bet" | "fold" | "call";

export type KuhnState = {
  cards: [KuhnCard, KuhnCard] | null;
  history: "" | "c" | "b" | "cc" | "cb" | "bc" | "bf" | "cbc" | "cbf";
};

const CARDS: KuhnCard[] = ["J", "Q", "K"];
const TERMINAL = new Set(["cc", "bc", "bf", "cbc", "cbf"]);

function cardValue(card: KuhnCard) {
  return CARDS.indexOf(card);
}

function strategicActions(history: KuhnState["history"]): KuhnAction[] {
  if (history === "" || history === "c") return ["check", "bet"];
  if (history === "b" || history === "cb") return ["fold", "call"];
  return [];
}

function nextHistory(history: KuhnState["history"], action: KuhnAction): KuhnState["history"] {
  if (history === "" && action === "check") return "c";
  if (history === "" && action === "bet") return "b";
  if (history === "c" && action === "check") return "cc";
  if (history === "c" && action === "bet") return "cb";
  if (history === "b" && action === "fold") return "bf";
  if (history === "b" && action === "call") return "bc";
  if (history === "cb" && action === "fold") return "cbf";
  if (history === "cb" && action === "call") return "cbc";
  throw new Error(`Illegal Kuhn action ${action} after ${history || "root"}.`);
}

export class KuhnPoker implements ExtensiveGame<KuhnState, KuhnAction> {
  readonly id = "kuhn-poker-v1";
  readonly definition = {
    game: "Kuhn Poker",
    players: 2,
    deck: CARDS,
    ante: 1,
    betSize: 1,
    utility: "two-player zero-sum net chips",
  };

  initialState(): KuhnState {
    return { cards: null, history: "" };
  }

  actor(state: KuhnState): Player | "chance" | null {
    if (!state.cards) return "chance";
    if (this.isTerminal(state)) return null;
    return state.history === "" || state.history === "cb" ? 0 : 1;
  }

  isTerminal(state: KuhnState) {
    return TERMINAL.has(state.history);
  }

  utility(state: KuhnState, player: Player) {
    if (!this.isTerminal(state) || !state.cards) throw new Error("Utility requested for a non-terminal Kuhn state.");
    let playerZeroUtility: number;
    if (state.history === "bf") playerZeroUtility = 1;
    else if (state.history === "cbf") playerZeroUtility = -1;
    else {
      const stake = state.history === "cc" ? 1 : 2;
      playerZeroUtility = cardValue(state.cards[0]) > cardValue(state.cards[1]) ? stake : -stake;
    }
    return player === 0 ? playerZeroUtility : -playerZeroUtility;
  }

  actions(state: KuhnState) {
    return strategicActions(state.history);
  }

  next(state: KuhnState, action: KuhnAction): KuhnState {
    if (!state.cards) {
      if (!action.startsWith("deal:")) throw new Error("Kuhn root requires a chance deal.");
      const cards = action.slice(5).split("") as [KuhnCard, KuhnCard];
      if (cards.length !== 2 || cards[0] === cards[1] || cards.some((card) => !CARDS.includes(card))) {
        throw new Error("Invalid Kuhn deal.");
      }
      return { cards, history: "" };
    }
    return { ...state, history: nextHistory(state.history, action) };
  }

  chanceOutcomes(state: KuhnState) {
    if (state.cards) return [];
    const deals = CARDS.flatMap((first) => CARDS.filter((second) => second !== first).map((second) => `deal:${first}${second}` as KuhnAction));
    return deals.map((action) => ({ action, probability: 1 / deals.length }));
  }

  informationSet(state: KuhnState) {
    const actor = this.actor(state);
    if (actor === null || actor === "chance" || !state.cards) throw new Error("Chance and terminal states have no information set.");
    return `${actor}|${state.cards[actor]}|${state.history || "root"}`;
  }

  private actionProbability(strategy: BehavioralStrategy, state: KuhnState, action: KuhnAction) {
    const actions = this.actions(state);
    const key = this.informationSet(state);
    const probability = strategy[key]?.[action];
    return probability === undefined ? 1 / actions.length : probability;
  }

  private evaluateState(state: KuhnState, strategy: BehavioralStrategy, player: Player): number {
    if (this.isTerminal(state)) return this.utility(state, player);
    const actor = this.actor(state);
    if (actor === "chance") {
      return this.chanceOutcomes(state).reduce(
        (value, outcome) => value + outcome.probability * this.evaluateState(this.next(state, outcome.action), strategy, player),
        0,
      );
    }
    if (actor === null) throw new Error("Invalid Kuhn state.");
    return this.actions(state).reduce(
      (value, action) => value + this.actionProbability(strategy, state, action) * this.evaluateState(this.next(state, action), strategy, player),
      0,
    );
  }

  evaluateStrategy(strategy: BehavioralStrategy): [number, number] {
    const value = this.evaluateState(this.initialState(), strategy, 0);
    return [value, -value];
  }

  private playerInfoSets(player: Player) {
    const infosets = new Map<string, KuhnAction[]>();
    const visit = (state: KuhnState) => {
      if (this.isTerminal(state)) return;
      const actor = this.actor(state);
      if (actor === "chance") {
        this.chanceOutcomes(state).forEach((outcome) => visit(this.next(state, outcome.action)));
        return;
      }
      if (actor === player) infosets.set(this.informationSet(state), [...this.actions(state)]);
      this.actions(state).forEach((action) => visit(this.next(state, action)));
    };
    visit(this.initialState());
    return [...infosets.entries()].sort(([left], [right]) => left.localeCompare(right));
  }

  bestResponseValue(player: Player, strategy: BehavioralStrategy) {
    const infosets = this.playerInfoSets(player);
    const policyCount = Math.pow(2, infosets.length);
    let best = Number.NEGATIVE_INFINITY;
    for (let mask = 0; mask < policyCount; mask += 1) {
      const candidate: BehavioralStrategy = Object.fromEntries(
        Object.entries(strategy).map(([key, value]) => [key, { ...value }]),
      );
      infosets.forEach(([key, actions], index) => {
        const selected = (mask >> index) & 1;
        candidate[key] = Object.fromEntries(actions.map((action, actionIndex) => [action, actionIndex === selected ? 1 : 0]));
      });
      best = Math.max(best, this.evaluateState(this.initialState(), candidate, player));
    }
    return best;
  }
}

export function kuhnEquilibriumChecks(strategy: BehavioralStrategy) {
  const game = new KuhnPoker();
  const [value] = game.evaluateStrategy(strategy);
  const nashConv = game.bestResponseValue(0, strategy) + game.bestResponseValue(1, strategy);
  return {
    playerZeroValue: value,
    expectedPlayerZeroValue: -1 / 18,
    valueError: Math.abs(value + 1 / 18),
    nashConv,
    exploitability: nashConv / 2,
    probabilityIntegrity: Object.values(strategy).every((actions) => {
      const values = Object.values(actions);
      return values.every((probability) => Number.isFinite(probability) && probability >= 0 && probability <= 1)
        && Math.abs(values.reduce((sum, probability) => sum + probability, 0) - 1) < 1e-9;
    }),
  };
}
