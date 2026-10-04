import { combosCollide, type HoleCombo, type SolverCard } from "./cards";
import { WeightedRange } from "./range";

export type PrivateDealOutcome = {
  playerZero: HoleCombo;
  playerOne: HoleCombo;
  rawWeight: number;
  probability: number;
};

export function privateDealDistribution(
  playerZero: WeightedRange,
  playerOne: WeightedRange,
  board: SolverCard[] = [],
): PrivateDealOutcome[] {
  const blocked = new Set(board.map((card) => card.id));
  if (blocked.size !== board.length) throw new Error("Board contains duplicate cards.");
  const outcomes: Omit<PrivateDealOutcome, "probability">[] = [];
  for (const left of playerZero.entries()) {
    if (left.weight <= 0 || blocked.has(left.combo.first.id) || blocked.has(left.combo.second.id)) continue;
    for (const right of playerOne.entries()) {
      if (right.weight <= 0 || blocked.has(right.combo.first.id) || blocked.has(right.combo.second.id)) continue;
      if (combosCollide(left.combo, right.combo)) continue;
      outcomes.push({ playerZero: left.combo, playerOne: right.combo, rawWeight: left.weight * right.weight });
    }
  }
  const total = outcomes.reduce((sum, outcome) => sum + outcome.rawWeight, 0);
  if (!(total > 0) || !Number.isFinite(total)) throw new Error("Ranges contain no compatible private-card deals.");
  const normalized = outcomes.map((outcome) => ({ ...outcome, probability: outcome.rawWeight / total }));
  const probability = normalized.reduce((sum, outcome) => sum + outcome.probability, 0);
  if (Math.abs(probability - 1) > 1e-12) throw new Error("Private-card chance distribution failed normalization.");
  return normalized;
}

export function samplePrivateDeal(distribution: PrivateDealOutcome[], unitRandom: number): [HoleCombo, HoleCombo] {
  if (!(unitRandom >= 0 && unitRandom < 1)) throw new Error("Private deal sampling requires a random value in [0, 1).");
  let cumulative = 0;
  for (const outcome of distribution) {
    cumulative += outcome.probability;
    if (unitRandom < cumulative) return [outcome.playerZero, outcome.playerOne];
  }
  const last = distribution.at(-1);
  if (!last) throw new Error("Cannot sample an empty private-card distribution.");
  return [last.playerZero, last.playerOne];
}