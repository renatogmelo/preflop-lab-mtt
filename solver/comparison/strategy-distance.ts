import type { BehavioralStrategy } from "../core/types";

export type StrategyShift = {
  informationSet: string;
  action: string;
  left: number;
  right: number;
  absoluteDelta: number;
};

export type StrategyDistance = {
  l1: number;
  l2: number;
  maxAbsoluteDelta: number;
  meanAbsoluteDelta: number;
  weightedMeanAbsoluteDelta: number;
  jensenShannonDivergence: number;
  comparedProbabilities: number;
  largestShifts: StrategyShift[];
};

function normalized(actions: Record<string, number> | undefined, universe: string[]) {
  if (!actions) return universe.map(() => 0);
  const values = universe.map((action) => actions[action] ?? 0);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Strategy distance received an invalid probability.");
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 1e-15) return universe.map(() => 0);
  return values.map((value) => value / total);
}

function kl(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => value <= 0 ? sum : sum + value * Math.log2(value / right[index]), 0);
}

export function strategyDistance(
  left: BehavioralStrategy,
  right: BehavioralStrategy,
  informationSetWeights: Record<string, number> = {},
  largestCount = 20,
): StrategyDistance {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const shifts: StrategyShift[] = [];
  let squared = 0;
  let weighted = 0;
  let weightTotal = 0;
  let jsWeighted = 0;
  for (const key of keys) {
    const actions = [...new Set([...Object.keys(left[key] ?? {}), ...Object.keys(right[key] ?? {})])].sort();
    const l = normalized(left[key], actions);
    const r = normalized(right[key], actions);
    const midpoint = l.map((value, index) => (value + r[index]) / 2);
    const weight = informationSetWeights[key] ?? 1;
    jsWeighted += weight * (kl(l, midpoint) + kl(r, midpoint)) / 2;
    weightTotal += weight;
    actions.forEach((action, index) => {
      const delta = Math.abs(l[index] - r[index]);
      squared += delta * delta;
      weighted += weight * delta;
      shifts.push({ informationSet: key, action, left: l[index], right: r[index], absoluteDelta: delta });
    });
  }
  const l1 = shifts.reduce((sum, shift) => sum + shift.absoluteDelta, 0);
  return {
    l1,
    l2: Math.sqrt(squared),
    maxAbsoluteDelta: shifts.reduce((maximum, shift) => Math.max(maximum, shift.absoluteDelta), 0),
    meanAbsoluteDelta: shifts.length ? l1 / shifts.length : 0,
    weightedMeanAbsoluteDelta: weightTotal > 0 ? weighted / weightTotal : 0,
    jensenShannonDivergence: weightTotal > 0 ? jsWeighted / weightTotal : 0,
    comparedProbabilities: shifts.length,
    largestShifts: shifts.sort((a, b) => b.absoluteDelta - a.absoluteDelta || a.informationSet.localeCompare(b.informationSet)).slice(0, largestCount),
  };
}

export function aggregateComboActionFrequencies(
  strategy: BehavioralStrategy,
  comboCanonical: Record<string, string>,
) {
  const aggregate = new Map<string, { count: number; actions: Record<string, number> }>();
  Object.entries(strategy).forEach(([informationSet, actions]) => {
    const parts = informationSet.split("|");
    const comboId = parts[1];
    const canonical = comboCanonical[comboId];
    if (!canonical) return;
    const current = aggregate.get(canonical) ?? { count: 0, actions: {} };
    current.count += 1;
    Object.entries(actions).forEach(([action, probability]) => {
      current.actions[action] = (current.actions[action] ?? 0) + probability;
    });
    aggregate.set(canonical, current);
  });
  return Object.fromEntries([...aggregate].map(([canonical, value]) => [
    canonical,
    Object.fromEntries(Object.entries(value.actions).map(([action, total]) => [action, total / value.count])),
  ]));
}