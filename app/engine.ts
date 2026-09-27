export type Position = "UTG" | "UTG+1" | "LJ" | "HJ" | "CO" | "BTN" | "SB" | "BB";
export type ScenarioKey = "rfi" | "vs-open" | "vs-3bet" | "bb-defense" | "bvb" | "squeeze" | "vs-jam";
export type ActionKey = "fold" | "call" | "limp" | "raise" | "threebet" | "fourbet" | "jam";
export type Card = { rank: string; suit: string };
export type StrategyAction = { action: ActionKey; frequency: number; ev: number };
export type Spot = { id: string; cards: Card[]; notation: string; hero: Position; villain?: Position; caller?: Position; scenario: ScenarioKey; stack: number; history: string[]; pot: number; strategy: StrategyAction[] };
export type HandRecord = Spot & { selected: ActionKey; loss: number; score: number; marked: boolean; timestamp: number };

export const POSITIONS: Position[] = ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export const STACKS = [10, 15, 20, 25, 30, 40, 60, 100];
const SUITS = ["♠", "♥", "♦", "♣"];
export const SCENARIOS: Record<ScenarioKey, { label: string; short: string; copy: string }> = {
  rfi: { label: "Pote não aberto", short: "RFI", copy: "Decida se entra no pote como primeiro agressor." },
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
  raise: { label: "Raise", compact: "RAISE", color: "#ef9c46", hotkey: "R" },
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
type RankMode = "open" | "call" | "aggressive" | "jam-call";
type HandShape = { high: number; low: number; pair: boolean; suited: boolean; gap: number; ace: boolean; king: boolean; broadway: boolean; wheelAce: boolean };
function shape(hand: string): HandShape {
  const high = RANKS.indexOf(hand[0]) + 2, low = RANKS.indexOf(hand[1]) + 2;
  const pair = hand.length === 2, suited = hand.endsWith("s");
  return { high, low, pair, suited, gap: Math.abs(high - low), ace: high === 14, king: high === 13, broadway: high >= 10 && low >= 10, wheelAce: high === 14 && low <= 5 };
}
function handScore(hand: string, mode: RankMode) {
  const h = shape(hand);
  if (h.pair) return 58 + h.high * 4.35;
  let score = h.high * 3.65 + h.low * 1.7;
  if (h.suited) score += 7.4;
  if (h.gap === 1) score += 5.4;
  else if (h.gap === 2) score += 3.1;
  else if (h.gap === 3) score += 1.1;
  else if (h.gap >= 5) score -= (h.gap - 4) * 1.45;
  if (h.broadway) score += 6.2;
  if (h.ace) score += 3.3;
  if (h.wheelAce && h.suited) score += 6.5;
  if (mode === "call") {
    if (h.suited) score += 5.2;
    if (h.gap <= 2) score += 3.2;
    if (!h.suited && !h.broadway) score -= 4.2;
    if (h.ace && !h.suited && h.low <= 8) score -= 3.6;
  }
  if (mode === "aggressive") {
    if (h.ace) score += 5.5;
    if (h.king) score += 2.7;
    if (h.wheelAce && h.suited) score += 6.8;
    if (h.suited && h.gap <= 2) score += 1.7;
  }
  if (mode === "jam-call") {
    if (h.pair) score += 8;
    if (h.ace) score += 4.8;
    if (!h.suited && h.high < 12) score -= 3;
    if (h.suited && h.gap <= 2) score += 1.4;
  }
  return score;
}
const HAND_CLASSES = (() => {
  const hands: { hand: string; combos: number }[] = [], ranks = [...RANKS].reverse();
  ranks.forEach((high, i) => ranks.forEach((low, j) => {
    if (i === j) hands.push({ hand: high + low, combos: 6 });
    else if (i < j) hands.push({ hand: high + low + "s", combos: 4 });
    else hands.push({ hand: low + high + "o", combos: 12 });
  }));
  return hands;
})();
const percentileCache = new Map<string, number>();
function percentile(hand: string, mode: RankMode) {
  const key = mode + ":" + hand, cached = percentileCache.get(key);
  if (cached !== undefined) return cached;
  const ordered = HAND_CLASSES.map((item) => ({ ...item, score: handScore(item.hand, mode) }))
    .sort((a, b) => b.score - a.score || a.hand.localeCompare(b.hand));
  let seen = 0;
  for (const item of ordered) {
    percentileCache.set(mode + ":" + item.hand, (seen + item.combos / 2) / 1326 * 100);
    seen += item.combos;
  }
  return percentileCache.get(key) ?? 100;
}
function frequencyAt(target: number, handPercentile: number, band = 1.5) {
  if (handPercentile <= target - band) return 100;
  if (handPercentile >= target + band) return 0;
  return Math.round((target + band - handPercentile) / (band * 2) * 100);
}
function evAt(frequency: number, edge: number, scale = .012, cap = .6) {
  if (frequency <= 0) return round(clamp(edge * scale, -.24, -.03));
  return round(clamp(edge * scale, -.08, cap));
}
function exact(items: StrategyAction[]) {
  const clean = items.map((item) => ({ ...item, frequency: Math.round(clamp(item.frequency, 0, 100)) }));
  const total = clean.reduce((sum, item) => sum + item.frequency, 0);
  if (total !== 100) {
    const target = clean.find((item) => item.action === "fold") ?? [...clean].sort((a, b) => b.frequency - a.frequency)[0];
    target.frequency = clamp(target.frequency + 100 - total, 0, 100);
  }
  return clean;
}
function depthAdjustment(stack: number) {
  if (stack <= 10) return 1.5;
  if (stack <= 20) return 1;
  if (stack >= 60) return -1;
  return 0;
}
function rfiTarget(hero: Position, stack: number) {
  const base: Record<Position, number> = { UTG: 18, "UTG+1": 20, LJ: 23, HJ: 28, CO: 36, BTN: 51, SB: 84, BB: 0 };
  const depth = hero === "BTN" || hero === "SB" ? depthAdjustment(stack) : depthAdjustment(stack) * .55;
  return base[hero] + depth;
}
function villainLateness(villain?: Position) {
  return villain ? clamp(POSITIONS.indexOf(villain) / 6, 0, 1) : .5;
}
export function strategy(hand: string, scenario: ScenarioKey, hero: Position, stack: number, villain?: Position, caller?: Position): StrategyAction[] {
  const openP = percentile(hand, "open"), callP = percentile(hand, "call");
  const aggressiveP = percentile(hand, "aggressive"), jamCallP = percentile(hand, "jam-call");
  const late = villainLateness(villain);
  if (scenario === "rfi" && hero !== "SB") {
    const target = rfiTarget(hero, stack), play = frequencyAt(target, openP, 1.35);
    let jam = 0;
    if (stack <= 15 && play > 0) {
      const h = shape(hand), premiumTrap = openP < 4;
      const naturalJam = h.pair || h.wheelAce || (h.ace && h.low >= 9) || h.broadway;
      const share = premiumTrap ? 8 : naturalJam ? (stack <= 10 ? 78 : 42) : (stack <= 10 ? 30 : 12);
      jam = Math.round(play * share / 100);
    }
    const raise = play - jam;
    return exact([
      { action: "fold", frequency: 100 - play, ev: 0 },
      { action: "raise", frequency: raise, ev: evAt(raise, target - openP, .012, .75) },
      ...(stack <= 15 ? [{ action: "jam" as ActionKey, frequency: jam, ev: evAt(jam, target - jamCallP, .015, .9) }] : []),
    ]);
  }
  if (scenario === "rfi" || scenario === "bvb") {
    const target = rfiTarget("SB", stack), play = frequencyAt(target, openP, 1.8);
    const raiseTarget = stack <= 15 ? 43 : stack <= 30 ? 39 : 36;
    const raiseSignal = frequencyAt(raiseTarget, aggressiveP, 1.7);
    let jam = 0;
    if (stack <= 15) {
      const jamTarget = stack <= 10 ? 19 : 12, jamSignal = frequencyAt(jamTarget, jamCallP, 1.4);
      jam = Math.min(play, Math.round(jamSignal * (jamCallP < 3 ? .15 : 1)));
    }
    const raise = Math.min(play - jam, Math.round(raiseSignal * (stack <= 15 ? .45 : 1)));
    const limp = play - raise - jam;
    return exact([
      { action: "fold", frequency: 100 - play, ev: 0 },
      { action: "limp", frequency: limp, ev: evAt(limp, target - callP, .009, .4) },
      { action: "raise", frequency: raise, ev: evAt(raise, raiseTarget - aggressiveP, .012, .65) },
      ...(stack <= 15 ? [{ action: "jam" as ActionKey, frequency: jam, ev: evAt(jam, (stack <= 10 ? 19 : 12) - jamCallP, .017, .9) }] : []),
    ]);
  }
  if (scenario === "bb-defense" || (scenario === "vs-open" && hero === "BB")) {
    const totalTarget = 45 + late * 25 + (stack <= 20 ? 3 : stack >= 60 ? -2 : 0);
    const aggressiveTarget = 5.5 + late * 5.5 + (stack <= 20 ? 2 : 0);
    const callSignal = frequencyAt(totalTarget, callP, 2.1), aggressive = frequencyAt(aggressiveTarget, aggressiveP, 1.25);
    const total = Math.max(callSignal, aggressive), call = Math.max(0, total - aggressive);
    const aggressiveAction: ActionKey = stack <= 20 ? "jam" : "threebet";
    return exact([
      { action: "fold", frequency: 100 - total, ev: 0 },
      { action: "call", frequency: call, ev: evAt(call, totalTarget - callP, .0065, .42) },
      { action: aggressiveAction, frequency: aggressive, ev: evAt(aggressive, aggressiveTarget - aggressiveP, .016, .8) },
    ]);
  }
  if (scenario === "vs-open") {
    const totalTarget = 9 + late * 15 + (hero === "BTN" ? 3 : hero === "CO" ? 1.5 : 0) - (hero === "SB" ? 1 : 0) + (stack <= 20 ? -1 : 0);
    const aggressiveTarget = 4 + late * 5 + (stack <= 20 ? 2 : 0);
    const callSignal = frequencyAt(totalTarget, callP, 1.5), aggressive = frequencyAt(aggressiveTarget, aggressiveP, 1.15);
    const total = Math.max(callSignal, aggressive), call = Math.max(0, total - aggressive);
    const aggressiveAction: ActionKey = stack <= 20 ? "jam" : "threebet";
    return exact([
      { action: "fold", frequency: 100 - total, ev: 0 },
      { action: "call", frequency: call, ev: evAt(call, totalTarget - callP, .008, .48) },
      { action: aggressiveAction, frequency: aggressive, ev: evAt(aggressive, aggressiveTarget - aggressiveP, .017, .85) },
    ]);
  }
  if (scenario === "vs-3bet") {
    const opened = rfiTarget(hero, stack), heroHasPosition = villain === "SB" || villain === "BB";
    const totalTarget = opened * (heroHasPosition ? .54 : .44) + (stack >= 40 ? 1.5 : 0);
    const aggressiveTarget = Math.min(totalTarget, 3.4 + opened * .12 + (stack <= 25 ? 2.2 : 0));
    const callSignal = frequencyAt(totalTarget, callP, 1.35), aggressive = frequencyAt(aggressiveTarget, aggressiveP, 1.05);
    const total = Math.max(callSignal, aggressive), call = Math.max(0, total - aggressive);
    const aggressiveAction: ActionKey = stack <= 30 ? "jam" : "fourbet";
    return exact([
      { action: "fold", frequency: 100 - total, ev: 0 },
      { action: "call", frequency: call, ev: evAt(call, totalTarget - callP, .009, .55) },
      { action: aggressiveAction, frequency: aggressive, ev: evAt(aggressive, aggressiveTarget - aggressiveP, .019, 1.1) },
    ]);
  }
  if (scenario === "squeeze") {
    const openerLate = villainLateness(villain), callerLate = villainLateness(caller);
    const callTarget = hero === "BB" ? 18 + openerLate * 13 + callerLate * 4 : 7 + openerLate * 7;
    const aggressiveTarget = 4.5 + openerLate * 4.5 + (stack <= 25 ? 2 : 0);
    const callSignal = frequencyAt(callTarget, callP, 1.45), aggressive = frequencyAt(aggressiveTarget, aggressiveP, 1.05);
    const total = Math.max(callSignal, aggressive), call = Math.max(0, total - aggressive);
    const aggressiveAction: ActionKey = stack <= 25 ? "jam" : "threebet";
    return exact([
      { action: "fold", frequency: 100 - total, ev: 0 },
      { action: "call", frequency: call, ev: evAt(call, callTarget - callP, .007, .4) },
      { action: aggressiveAction, frequency: aggressive, ev: evAt(aggressive, aggressiveTarget - aggressiveP, .018, 1) },
    ]);
  }
  if (scenario === "vs-jam") {
    const stackPenalty = stack <= 10 ? 0 : stack <= 15 ? 2 : stack <= 20 ? 4 : 6;
    const callTarget = 8 + late * 10 - stackPenalty, call = frequencyAt(callTarget, jamCallP, 1.05);
    return exact([
      { action: "fold", frequency: 100 - call, ev: 0 },
      { action: "call", frequency: call, ev: evAt(call, callTarget - jamCallP, .022, 1.2) },
    ]);
  }
  return [{ action: "fold", frequency: 100, ev: 0 }];
}
export function scenarioIsCompatible(scenario: ScenarioKey, hero: Position | "Todos", stack?: number) {
  if (scenario === "vs-jam" && stack !== undefined && stack > 25) return false;
  if (hero === "Todos") return true;
  const index = POSITIONS.indexOf(hero);
  if (scenario === "rfi") return hero !== "BB";
  if (scenario === "vs-open" || scenario === "vs-jam") return index >= 1;
  if (scenario === "vs-3bet") return hero !== "BB";
  if (scenario === "bb-defense") return hero === "BB";
  if (scenario === "bvb") return hero === "SB";
  return index >= 2;
}
function postedBlind(position?: Position) { return position === "SB" ? .5 : position === "BB" ? 1 : 0; }
function drawReachableHand(scenario: ScenarioKey, hero: Position, stack: number) {
  let cards = deal();
  if (scenario !== "vs-3bet") return cards;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const hand = notation(cards);
    const reach = strategy(hand, "rfi", hero, stack).filter((item) => item.action !== "fold").reduce((sum, item) => sum + item.frequency, 0);
    if (Math.random() * 100 <= reach) return cards;
    cards = deal();
  }
  return cards;
}
export function makeSpot(stack: number, scenarioFilter: ScenarioKey | "Todos", heroFilter: Position | "Todos"): Spot {
  const choices = (Object.keys(SCENARIOS) as ScenarioKey[]).filter((item) => scenarioIsCompatible(item, heroFilter, stack));
  let scenario = scenarioFilter === "Todos" ? pick(choices) : scenarioFilter;
  if (!scenarioIsCompatible(scenario, heroFilter, stack)) scenario = heroFilter === "BB" ? "bb-defense" : "rfi";

  let hero: Position;
  if (heroFilter !== "Todos") hero = heroFilter;
  else if (scenario === "bb-defense") hero = "BB";
  else if (scenario === "bvb") hero = "SB";
  else if (scenario === "rfi" || scenario === "vs-3bet") hero = pick(POSITIONS.slice(0, 7));
  else if (scenario === "squeeze") hero = pick(POSITIONS.slice(2));
  else hero = pick(POSITIONS.slice(1));

  const heroIndex = POSITIONS.indexOf(hero);
  let villain: Position | undefined, caller: Position | undefined;
  if (scenario === "bvb") villain = "BB";
  else if (scenario === "vs-3bet") villain = pick(POSITIONS.slice(heroIndex + 1));
  else if (scenario === "squeeze") {
    const before = POSITIONS.slice(0, heroIndex), openerIndex = Math.floor(Math.random() * (before.length - 1));
    villain = before[openerIndex];
    caller = pick(before.slice(openerIndex + 1));
  } else if (scenario !== "rfi") villain = scenario === "bb-defense" ? pick(POSITIONS.slice(0, 6)) : pick(POSITIONS.slice(0, heroIndex));

  const cards = drawReachableHand(scenario, hero, stack), hand = notation(cards);
  const openSize = stack <= 25 ? 2 : stack <= 40 ? 2.1 : 2.2;
  const oop = villain === "SB" || villain === "BB";
  const threeBetSize = stack <= 25 ? (oop ? 6 : 5.2) : (oop ? 8 : 6.8);
  const history: string[] = [];
  let pot = 2.5;
  if (scenario === "rfi" || scenario === "bvb") {
    history.push(scenario === "rfi" && hero === "UTG" ? "UTG é o primeiro a agir" : "Fold até " + hero);
  }
  if (scenario === "vs-open" || scenario === "bb-defense") {
    history.push(villain + " raise " + openSize + "bb");
    pot += openSize - postedBlind(villain);
  }
  if (scenario === "vs-3bet") {
    history.push("Fold até " + hero, hero + " raise " + openSize + "bb", villain + " 3-bet " + threeBetSize + "bb");
    pot += openSize - postedBlind(hero) + threeBetSize - postedBlind(villain);
  }
  if (scenario === "squeeze") {
    history.push(villain + " raise " + openSize + "bb", caller + " call " + openSize + "bb");
    pot += openSize - postedBlind(villain) + openSize - postedBlind(caller);
  }
  if (scenario === "vs-jam") {
    history.push(villain + " all-in " + stack + "bb");
    pot += stack - postedBlind(villain);
  }
  return { id: Math.random().toString(36).slice(2), cards, notation: hand, hero, villain, caller, scenario, stack, history, pot: round(pot, 1), strategy: strategy(hand, scenario, hero, stack, villain, caller) };
}
export const INITIAL_SPOT: Spot = { id: "initial", cards: [{ rank: "A", suit: "♠" }, { rank: "J", suit: "♠" }], notation: "AJs", hero: "BTN", scenario: "rfi", stack: 25, history: ["Fold até BTN"], pot: 2.5, strategy: strategy("AJs", "rfi", "BTN", 25) };
export function grade(items: StrategyAction[], selected: ActionKey) {
  const maxEV = Math.max(...items.map((item) => item.ev));
  const choice = items.find((item) => item.action === selected);
  const loss = round(Math.max(0, maxEV - (choice?.ev ?? -.18)));
  const frequency = choice?.frequency ?? 0;
  return { loss, frequency, score: clamp(Math.round(100 - loss * 145 - (frequency < 3 ? 18 : 0)), 0, 100) };
}
