export type Position = "UTG" | "UTG+1" | "LJ" | "HJ" | "CO" | "BTN" | "SB" | "BB";
export type ScenarioKey = "rfi" | "vs-open" | "vs-3bet" | "bb-defense" | "bvb" | "squeeze" | "vs-jam";
export type ActionKey = "fold" | "call" | "limp" | "raise" | "threebet" | "fourbet" | "jam";
export type Card = { rank: string; suit: string };
export type StrategyAction = { action: ActionKey; frequency: number; ev: number };
export type Spot = { id: string; cards: Card[]; notation: string; hero: Position; villain?: Position; scenario: ScenarioKey; stack: number; history: string[]; pot: number; strategy: StrategyAction[] };
export type HandRecord = Spot & { selected: ActionKey; loss: number; score: number; marked: boolean; timestamp: number };

export const POSITIONS: Position[] = ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export const STACKS = [10, 15, 20, 25, 30, 40, 60, 100];
const SUITS = ["♠", "♥", "♦", "♣"];
export const SCENARIOS: Record<ScenarioKey, { label: string; short: string; copy: string }> = {
  rfi: { label: "Pote não aberto", short: "RFI", copy: "A ação chega em fold até você." },
  "vs-open": { label: "Contra open", short: "vs RFI", copy: "Defenda, 3-bete ou abandone contra uma abertura." },
  "vs-3bet": { label: "Contra 3-bet", short: "vs 3-bet", copy: "Continue corretamente depois de abrir e enfrentar uma 3-bet." },
  "bb-defense": { label: "Defesa do BB", short: "BB defend", copy: "Proteja o big blind contra diferentes posições." },
  bvb: { label: "Blind vs blind", short: "BvB", copy: "Jogue a árvore completa de SB contra BB." },
  squeeze: { label: "Spot de squeeze", short: "Squeeze", copy: "Há uma abertura e um call antes de você." },
  "vs-jam": { label: "Contra all-in", short: "vs Jam", copy: "Decida o range de call contra um shove pré-flop." },
};
export const ACTIONS: Record<ActionKey, { label: string; compact: string; color: string; hotkey: string }> = {
  fold: { label: "Fold", compact: "FOLD", color: "#64706c", hotkey: "F" },
  call: { label: "Call", compact: "CALL", color: "#2e9c76", hotkey: "C" },
  limp: { label: "Limp", compact: "LIMP", color: "#4e88d8", hotkey: "L" },
  raise: { label: "Raise 2bb", compact: "RAISE", color: "#ef9c46", hotkey: "R" },
  threebet: { label: "3-bet", compact: "3-BET", color: "#d76b52", hotkey: "3" },
  fourbet: { label: "4-bet", compact: "4-BET", color: "#b86fe0", hotkey: "4" },
  jam: { label: "All-in", compact: "JAM", color: "#e14f63", hotkey: "A" },
};

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

function notation(cards: Card[]) {
  const sorted = [...cards].sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank));
  if (sorted[0].rank === sorted[1].rank) return `${sorted[0].rank}${sorted[1].rank}`;
  return `${sorted[0].rank}${sorted[1].rank}${sorted[0].suit === sorted[1].suit ? "s" : "o"}`;
}
function deal(): Card[] {
  const deck = RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
  return [deck.splice(Math.floor(Math.random() * deck.length), 1)[0], deck.splice(Math.floor(Math.random() * deck.length), 1)[0]];
}
function strength(hand: string) {
  const high = RANKS.indexOf(hand[0]) + 2, low = RANKS.indexOf(hand[1]) + 2;
  const pair = hand.length === 2, suited = hand.endsWith("s"), gap = Math.abs(high - low);
  let value = high * 3.05 + low * 1.55;
  if (pair) value = 43 + high * 4.15;
  if (suited) value += 6.5;
  if (!pair && gap === 1) value += 5;
  if (!pair && gap === 2) value += 2.5;
  if (high >= 11 && low >= 10) value += 5;
  if (high === 14) value += Math.max(0, low - 5) * .65 + 3;
  if (!pair && gap > 4) value -= (gap - 4) * 1.5;
  return clamp(value, 4, 100);
}
function normalize(items: StrategyAction[]) {
  const total = items.reduce((sum, item) => sum + item.frequency, 0) || 1;
  return items.map((item) => ({ ...item, frequency: Math.round(item.frequency / total * 100) }));
}
export function strategy(hand: string, scenario: ScenarioKey, hero: Position, stack: number): StrategyAction[] {
  const power = strength(hand), pos = POSITIONS.indexOf(hero);
  const mix = (edge: number) => clamp(50 + edge * 18, 5, 95);
  const ev = (threshold: number, scale = .026) => round((power - threshold) * scale + .04);
  let items: StrategyAction[] = [];
  if (scenario === "rfi") {
    const base = [67, 64, 61, 57, 52, 45, 47, 101][pos], edge = power - base;
    if (hero === "SB" && stack > 15 && power < base + 15) {
      const raise = mix(edge - 1), limp = clamp(68 - Math.abs(edge) * 8, 8, 72);
      items = [{ action: "fold", frequency: clamp(100 - raise - limp, 3, 84), ev: 0 }, { action: "limp", frequency: limp, ev: Math.max(.02, ev(base - 5, .012)) }, { action: "raise", frequency: raise, ev: ev(base) }];
    } else if (stack <= 15 && power > base - 7 && power < base + 17) {
      const jam = mix(edge + 1);
      items = [{ action: "fold", frequency: 100 - jam, ev: 0 }, { action: "jam", frequency: jam, ev: ev(base - 3, .032) }];
    } else {
      const raise = mix(edge);
      items = [{ action: "fold", frequency: 100 - raise, ev: 0 }, { action: "raise", frequency: raise, ev: ev(base) }];
    }
  }
  if (scenario === "vs-open" || scenario === "bb-defense") {
    const isBB = scenario === "bb-defense" || hero === "BB";
    const cont = isBB ? 38 : 52 - Math.max(0, pos - 4) * 2, aggro = stack <= 20 ? 72 : 78;
    const call = clamp(74 - Math.abs(power - (cont + 14)) * 3.2, 4, 78), reRaise = mix((power - aggro) / 1.6);
    items = [{ action: "fold", frequency: clamp(100 - call - reRaise, 3, 94), ev: 0 }, { action: "call", frequency: call, ev: ev(cont, isBB ? .018 : .014) }, { action: stack <= 18 ? "jam" : "threebet", frequency: reRaise, ev: ev(aggro, .025) }];
  }
  if (scenario === "vs-3bet") {
    const cont = 65 - (pos >= 5 ? 5 : 0), aggro = stack <= 25 ? 80 : 86;
    const call = clamp(68 - Math.abs(power - (cont + 11)) * 3.4, 4, 72), reRaise = mix((power - aggro) / 1.5);
    items = [{ action: "fold", frequency: clamp(100 - call - reRaise, 3, 94), ev: 0 }, { action: "call", frequency: call, ev: ev(cont, .017) }, { action: stack <= 30 ? "jam" : "fourbet", frequency: reRaise, ev: ev(aggro, .034) }];
  }
  if (scenario === "bvb") {
    const raise = clamp(26 + (power - 38) * 2.1, 8, 84), limp = clamp(66 - Math.abs(power - 45) * 1.6, 10, 70), jam = stack <= 15 ? clamp((power - 62) * 3.2, 0, 72) : 0;
    items = [{ action: "fold", frequency: clamp(100 - raise - limp - jam, 2, 68), ev: 0 }, { action: "limp", frequency: limp, ev: ev(32, .013) }, { action: "raise", frequency: raise, ev: ev(44, .018) }, ...(jam ? [{ action: "jam" as ActionKey, frequency: jam, ev: ev(64, .027) }] : [])];
  }
  if (scenario === "squeeze") {
    const cont = hero === "BB" ? 54 : 66, aggro = stack <= 25 ? 77 : 84;
    const call = clamp(58 - Math.abs(power - (cont + 9)) * 3, 2, 62), squeeze = mix((power - aggro) / 1.4);
    items = [{ action: "fold", frequency: clamp(100 - call - squeeze, 4, 96), ev: 0 }, { action: "call", frequency: call, ev: ev(cont, .013) }, { action: stack <= 22 ? "jam" : "threebet", frequency: squeeze, ev: ev(aggro, .031) }];
  }
  if (scenario === "vs-jam") {
    const threshold = stack <= 12 ? 66 : 76, call = mix((power - threshold) / 1.4);
    items = [{ action: "fold", frequency: 100 - call, ev: 0 }, { action: "call", frequency: call, ev: ev(threshold, .041) }];
  }
  return normalize(items);
}
export function makeSpot(stack: number, scenarioFilter: ScenarioKey | "Todos", heroFilter: Position | "Todos"): Spot {
  let scenario = scenarioFilter === "Todos" ? pick(Object.keys(SCENARIOS) as ScenarioKey[]) : scenarioFilter;
  let hero: Position = heroFilter !== "Todos" ? heroFilter : scenario === "bb-defense" ? "BB" : scenario === "bvb" ? "SB" : scenario === "rfi" ? pick(POSITIONS.slice(0, 7)) : pick(POSITIONS.slice(2));
  if (heroFilter !== "Todos" && hero === "BB" && scenario === "rfi") scenario = "bb-defense";
  if (heroFilter !== "Todos" && hero !== "SB" && scenario === "bvb") scenario = "rfi";
  const villain = scenario === "rfi" ? undefined : scenario === "bb-defense" ? pick(POSITIONS.slice(0, 6)) : scenario === "bvb" ? "BB" : pick(POSITIONS.slice(0, Math.max(1, POSITIONS.indexOf(hero))));
  const cards = deal(), hand = notation(cards), size = stack <= 15 ? 2 : 2.1;
  const history: string[] = []; let pot = 2.5;
  if (scenario === "rfi" || scenario === "bvb") history.push(`Fold até ${hero}`);
  if (scenario === "vs-open" || scenario === "bb-defense") { history.push(`${villain} raise ${size}bb`); pot += size; }
  if (scenario === "vs-3bet") { history.push(`${hero} raise ${size}bb`, `${villain} 3-bet ${stack <= 25 ? 5.5 : 7}bb`); pot += stack <= 25 ? 7.5 : 9; }
  if (scenario === "squeeze") { const caller = pick(POSITIONS.filter((p) => p !== hero && p !== villain && p !== "BB")); history.push(`${villain} raise ${size}bb`, `${caller} call ${size}bb`); pot += size * 2; }
  if (scenario === "vs-jam") { history.push(`${villain} all-in ${Math.min(stack, 15)}bb`); pot += Math.min(stack, 15); }
  return { id: Math.random().toString(36).slice(2), cards, notation: hand, hero, villain, scenario, stack, history, pot: round(pot, 1), strategy: strategy(hand, scenario, hero, stack) };
}
export const INITIAL_SPOT: Spot = { id: "initial", cards: [{ rank: "A", suit: "♠" }, { rank: "J", suit: "♠" }], notation: "AJs", hero: "BTN", scenario: "rfi", stack: 25, history: ["Fold até BTN"], pot: 2.5, strategy: strategy("AJs", "rfi", "BTN", 25) };
export function grade(items: StrategyAction[], selected: ActionKey) {
  const maxEV = Math.max(...items.map((item) => item.ev));
  const choice = items.find((item) => item.action === selected);
  const loss = round(Math.max(0, maxEV - (choice?.ev ?? -.18)));
  const frequency = choice?.frequency ?? 0;
  return { loss, frequency, score: clamp(Math.round(100 - loss * 145 - (frequency < 3 ? 18 : 0)), 0, 100) };
}
