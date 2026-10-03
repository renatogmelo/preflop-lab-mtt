import {
  POSITIONS,
  clamp,
  type ActionKey,
  type Position,
  type StrategyAction,
  type StrategyQuery,
} from "./domain";
import { HAND_CLASSES, handFeatures } from "./hands";

type RankMode = "open" | "call" | "aggressive" | "jam-call";

function handScore(hand: string, mode: RankMode) {
  const h = handFeatures(hand);
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

const percentileCache = new Map<string, number>();

function percentile(hand: string, mode: RankMode) {
  const key = mode + ":" + hand;
  const cached = percentileCache.get(key);
  if (cached !== undefined) return cached;
  const ordered = HAND_CLASSES.map((item) => ({ hand: item, combos: handFeatures(item).combos, score: handScore(item, mode) }))
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

function exact(items: Array<{ action: ActionKey; frequency: number }>): StrategyAction[] {
  const clean = items.map((item) => ({ ...item, frequency: Math.round(clamp(item.frequency, 0, 100)), ev: null }));
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

export function modeledStrategy(hand: string, query: StrategyQuery): StrategyAction[] {
  const openP = percentile(hand, "open");
  const callP = percentile(hand, "call");
  const aggressiveP = percentile(hand, "aggressive");
  const jamCallP = percentile(hand, "jam-call");
  const late = villainLateness(query.villain);
  const { scenario, hero, stack } = query;

  if (scenario === "rfi" && hero !== "SB") {
    const target = rfiTarget(hero, stack);
    const play = frequencyAt(target, openP, 1.35);
    let jam = 0;
    if (stack <= 25 && play > 0) {
      const h = handFeatures(hand);
      const premiumTrap = openP < 4;
      const naturalJam = h.pair || h.wheelAce || (h.ace && h.low >= 9) || h.broadway;
      const naturalShare = stack <= 10 ? 78 : stack <= 15 ? 42 : stack <= 20 ? 12 : 4;
      const marginalShare = stack <= 10 ? 30 : stack <= 15 ? 12 : stack <= 20 ? 4 : 1;
      const share = premiumTrap && stack <= 15 ? 8 : naturalJam ? naturalShare : marginalShare;
      jam = Math.round(play * share / 100);
    }
    return exact([
      { action: "fold", frequency: 100 - play },
      { action: "raise", frequency: play - jam },
      ...(stack <= 25 ? [{ action: "jam" as ActionKey, frequency: jam }] : []),
    ]);
  }

  if (scenario === "rfi" || scenario === "bvb") {
    const target = rfiTarget("SB", stack);
    const play = frequencyAt(target, openP, 1.8);
    const raiseTarget = stack <= 15 ? 43 : stack <= 30 ? 39 : 36;
    const raiseSignal = frequencyAt(raiseTarget, aggressiveP, 1.7);
    let jam = 0;
    if (stack <= 15) {
      const jamTarget = stack <= 10 ? 19 : 12;
      const jamSignal = frequencyAt(jamTarget, jamCallP, 1.4);
      jam = Math.min(play, Math.round(jamSignal * (jamCallP < 3 ? .15 : 1)));
    }
    const raise = Math.min(play - jam, Math.round(raiseSignal * (stack <= 15 ? .45 : 1)));
    return exact([
      { action: "fold", frequency: 100 - play },
      { action: "limp", frequency: play - raise - jam },
      { action: "raise", frequency: raise },
      ...(stack <= 15 ? [{ action: "jam" as ActionKey, frequency: jam }] : []),
    ]);
  }

  if (scenario === "bb-defense" || (scenario === "vs-open" && hero === "BB")) {
    const totalTarget = 45 + late * 25 + (stack <= 20 ? 3 : stack >= 60 ? -2 : 0);
    const aggressiveTarget = 5.5 + late * 5.5 + (stack <= 20 ? 2 : 0);
    const callSignal = frequencyAt(totalTarget, callP, 2.1);
    const aggressive = frequencyAt(aggressiveTarget, aggressiveP, 1.25);
    const total = Math.max(callSignal, aggressive);
    const aggressiveAction: ActionKey = stack <= 12 ? "jam" : "threebet";
    return exact([
      { action: "fold", frequency: 100 - total },
      { action: "call", frequency: Math.max(0, total - aggressive) },
      { action: aggressiveAction, frequency: aggressive },
    ]);
  }

  if (scenario === "vs-open") {
    const totalTarget = 9 + late * 15 + (hero === "BTN" ? 3 : hero === "CO" ? 1.5 : 0) - (hero === "SB" ? 1 : 0) + (stack <= 20 ? -1 : 0);
    const aggressiveTarget = 4 + late * 5 + (stack <= 20 ? 2 : 0);
    const callSignal = frequencyAt(totalTarget, callP, 1.5);
    const aggressive = frequencyAt(aggressiveTarget, aggressiveP, 1.15);
    const total = Math.max(callSignal, aggressive);
    const aggressiveAction: ActionKey = stack <= 12 ? "jam" : "threebet";
    return exact([
      { action: "fold", frequency: 100 - total },
      { action: "call", frequency: Math.max(0, total - aggressive) },
      { action: aggressiveAction, frequency: aggressive },
    ]);
  }

  if (scenario === "vs-3bet") {
    const opened = rfiTarget(hero, stack);
    const heroHasPosition = query.villain === "SB" || query.villain === "BB";
    const totalTarget = opened * (heroHasPosition ? .54 : .44) + (stack >= 40 ? 1.5 : 0);
    const aggressiveTarget = Math.min(totalTarget, 3.4 + opened * .12 + (stack <= 25 ? 2.2 : 0));
    const callSignal = frequencyAt(totalTarget, callP, 1.35);
    const aggressive = frequencyAt(aggressiveTarget, aggressiveP, 1.05);
    const total = Math.max(callSignal, aggressive);
    const aggressiveAction: ActionKey = stack <= 30 ? "jam" : "fourbet";
    return exact([
      { action: "fold", frequency: 100 - total },
      { action: "call", frequency: Math.max(0, total - aggressive) },
      { action: aggressiveAction, frequency: aggressive },
    ]);
  }

  if (scenario === "squeeze") {
    const openerLate = villainLateness(query.villain);
    const callerLate = villainLateness(query.caller);
    const callTarget = hero === "BB" ? 18 + openerLate * 13 + callerLate * 4 : 7 + openerLate * 7;
    const aggressiveTarget = 4.5 + openerLate * 4.5 + (stack <= 25 ? 2 : 0);
    const callSignal = frequencyAt(callTarget, callP, 1.45);
    const aggressive = frequencyAt(aggressiveTarget, aggressiveP, 1.05);
    const total = Math.max(callSignal, aggressive);
    const aggressiveAction: ActionKey = stack <= 25 ? "jam" : "threebet";
    return exact([
      { action: "fold", frequency: 100 - total },
      { action: "call", frequency: Math.max(0, total - aggressive) },
      { action: aggressiveAction, frequency: aggressive },
    ]);
  }

  if (scenario === "vs-jam") {
    const stackPenalty = stack <= 10 ? 0 : stack <= 15 ? 2 : stack <= 20 ? 4 : 6;
    const callTarget = 8 + late * 10 - stackPenalty;
    const call = frequencyAt(callTarget, jamCallP, 1.05);
    return exact([
      { action: "fold", frequency: 100 - call },
      { action: "call", frequency: call },
    ]);
  }

  return [{ action: "fold", frequency: 100, ev: null }];
}

export const MODELED_INTERNALS = {
  handScore,
  percentile,
  frequencyAt,
};
