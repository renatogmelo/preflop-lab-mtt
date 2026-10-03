import { combosCollide, enumerateHoleCombos, type HoleCombo, type SolverCard } from "./cards";

export type WeightedCombo = {
  combo: HoleCombo;
  weight: number;
};

export class WeightedRange {
  private readonly weights = new Map<string, WeightedCombo>();

  constructor(entries: WeightedCombo[] = []) {
    entries.forEach(({ combo, weight }) => this.set(combo, weight));
  }

  static uniform(combos = enumerateHoleCombos()) {
    return new WeightedRange(combos.map((combo) => ({ combo, weight: 1 })));
  }

  set(combo: HoleCombo, weight: number) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("Range weights must be finite values from 0 to 1.");
    this.weights.set(combo.id, { combo, weight });
    return this;
  }

  get(combo: HoleCombo) {
    return this.weights.get(combo.id)?.weight ?? 0;
  }

  entries() {
    return [...this.weights.values()];
  }

  conditionedOnBlockedCards(blocked: SolverCard[]) {
    const blockedIds = new Set(blocked.map((card) => card.id));
    return new WeightedRange(this.entries().filter(({ combo }) => (
      !blockedIds.has(combo.first.id) && !blockedIds.has(combo.second.id)
    )));
  }

  compatibleWith(combo: HoleCombo) {
    return new WeightedRange(this.entries().filter((entry) => !combosCollide(entry.combo, combo)));
  }

  normalizedProbabilities() {
    const entries = this.entries().filter((entry) => entry.weight > 0);
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return [];
    return entries.map((entry) => ({ combo: entry.combo, probability: entry.weight / total }));
  }

  aggregateByCanonical() {
    const aggregate = new Map<string, { weighted: number; combos: number }>();
    this.entries().forEach(({ combo, weight }) => {
      const current = aggregate.get(combo.canonical) ?? { weighted: 0, combos: 0 };
      current.weighted += weight;
      current.combos += 1;
      aggregate.set(combo.canonical, current);
    });
    return Object.fromEntries([...aggregate].map(([hand, value]) => [hand, value.weighted / value.combos]));
  }
}

export function assertNoCollision(combos: HoleCombo[]) {
  const cards = combos.flatMap((combo) => [combo.first.id, combo.second.id]);
  if (cards.length !== new Set(cards).size) throw new Error("Card collision detected.");
}
