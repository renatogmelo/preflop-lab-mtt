import { createHoldemDeck, type HoleCombo, type SolverCard } from "./cards";
import { WeightedRange } from "./range";
import { DeterministicRandom } from "../core/random";
import { compareHoldemHands } from "./hand-evaluator";

export type EquityOptions = {
  exactThreshold?: number;
  samples?: number;
  seed?: number;
};

export type EquityResult = {
  equity: number;
  wins: number;
  ties: number;
  losses: number;
  trials: number;
  method: "exact-enumeration" | "deterministic-sampling";
  seed: number | null;
  standardError: number;
};

function assertUnique(cards: SolverCard[]) {
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error("Duplicate card in equity state.");
}

function chooseCount(total: number, choose: number) {
  let result = 1;
  for (let index = 1; index <= choose; index += 1) result = result * (total - choose + index) / index;
  return Math.round(result);
}

export function enumerateRunouts(deck: SolverCard[], count: number): SolverCard[][] {
  const result: SolverCard[][] = [];
  const visit = (start: number, selected: SolverCard[]) => {
    if (selected.length === count) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= deck.length - (count - selected.length); index += 1) {
      selected.push(deck[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

function sampledRunouts(deck: SolverCard[], count: number, samples: number, seed: number) {
  const random = new DeterministicRandom(seed);
  const result: SolverCard[][] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const available = [...deck];
    const selected: SolverCard[] = [];
    for (let index = 0; index < count; index += 1) {
      selected.push(available.splice(random.integer(available.length), 1)[0]);
    }
    result.push(selected);
  }
  return result;
}

function finalize(scores: number[], method: EquityResult["method"], seed: number | null): EquityResult {
  const wins = scores.filter((score) => score === 1).length;
  const ties = scores.filter((score) => score === 0.5).length;
  const losses = scores.length - wins - ties;
  const equity = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance = scores.length > 1
    ? scores.reduce((sum, score) => sum + (score - equity) ** 2, 0) / (scores.length - 1)
    : 0;
  return { equity, wins, ties, losses, trials: scores.length, method, seed, standardError: Math.sqrt(variance / scores.length) };
}

export class EquityEngine {
  private readonly comboCache = new Map<string, EquityResult>();
  private cacheHits = 0;
  private cacheMisses = 0;

  comboEquity(hero: HoleCombo, villain: HoleCombo, board: SolverCard[] = [], options: EquityOptions = {}): EquityResult {
    if (board.length > 5) throw new Error("A Hold'em board cannot contain more than five cards.");
    const dead = [hero.first, hero.second, villain.first, villain.second, ...board];
    assertUnique(dead);
    const effectiveOptions = {
      exactThreshold: options.exactThreshold ?? 250_000,
      samples: options.samples ?? 100_000,
      seed: options.seed ?? 20261003,
    };
    const cacheKey = [
      hero.id,
      villain.id,
      [...board].map((card) => card.id).sort((left, right) => left - right).join("-"),
      effectiveOptions.exactThreshold,
      effectiveOptions.samples,
      effectiveOptions.seed,
    ].join("|");
    const cached = this.comboCache.get(cacheKey);
    if (cached) {
      this.cacheHits += 1;
      return cached;
    }
    this.cacheMisses += 1;
    const deadIds = new Set(dead.map((card) => card.id));
    const deck = createHoldemDeck().filter((card) => !deadIds.has(card.id));
    const missing = 5 - board.length;
    const possible = chooseCount(deck.length, missing);
    const exactThreshold = effectiveOptions.exactThreshold;
    const seed = effectiveOptions.seed;
    const runouts = possible <= exactThreshold
      ? enumerateRunouts(deck, missing)
      : sampledRunouts(deck, missing, Math.min(effectiveOptions.samples, possible), seed);
    const scores = runouts.map((runout) => {
      const completeBoard = [...board, ...runout];
      const comparison = compareHoldemHands(
        [hero.first, hero.second, ...completeBoard],
        [villain.first, villain.second, ...completeBoard],
      );
      return comparison > 0 ? 1 : comparison < 0 ? 0 : 0.5;
    });
    const result = finalize(scores, possible <= exactThreshold ? "exact-enumeration" : "deterministic-sampling", possible <= exactThreshold ? null : seed);
    this.comboCache.set(cacheKey, result);
    return result;
  }

  cacheMetrics() {
    const requests = this.cacheHits + this.cacheMisses;
    return {
      entries: this.comboCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: requests ? this.cacheHits / requests : 0,
    };
  }

  clearCache() {
    this.comboCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  rangeEquity(heroRange: WeightedRange, villainRange: WeightedRange, board: SolverCard[] = [], options: EquityOptions = {}) {
    const blocked = new Set(board.map((card) => card.id));
    const hero = heroRange.normalizedProbabilities().filter(({ combo }) => !blocked.has(combo.first.id) && !blocked.has(combo.second.id));
    const villain = villainRange.normalizedProbabilities().filter(({ combo }) => !blocked.has(combo.first.id) && !blocked.has(combo.second.id));
    let weightedEquity = 0;
    let totalWeight = 0;
    let trials = 0;
    hero.forEach((left) => villain.forEach((right) => {
      const ids = [left.combo.first.id, left.combo.second.id, right.combo.first.id, right.combo.second.id];
      if (new Set(ids).size !== 4) return;
      const weight = left.probability * right.probability;
      const result = this.comboEquity(left.combo, right.combo, board, options);
      weightedEquity += weight * result.equity;
      totalWeight += weight;
      trials += result.trials;
    }));
    if (totalWeight <= 0) throw new Error("Conditioned ranges contain no compatible combo pairs.");
    return { equity: weightedEquity / totalWeight, compatiblePairWeight: totalWeight, trials };
  }
}
