import type { SolverCard } from "../cards/cards";
import { WeightedRange } from "../cards/range";
import { hashValue } from "../core/stable";
import { SOLVER_VERSION } from "../core/version";
import { rangeHash } from "./engine";

export type ContinuationArtifactIdentity = {
  board: SolverCard[];
  pot: number;
  stacks: [number, number];
  actingPlayer: 0 | 1;
  position: string;
  actionHistory: string[];
  ranges: [WeightedRange, WeightedRange];
  bettingAbstraction: unknown;
  algorithmConfiguration: unknown;
  solverVersion?: string;
};

export function continuationArtifactKey(identity: ContinuationArtifactIdentity) {
  return hashValue({
    board: identity.board.map((card) => card.id),
    pot: identity.pot,
    stacks: identity.stacks,
    actingPlayer: identity.actingPlayer,
    position: identity.position,
    actionHistory: identity.actionHistory,
    ranges: identity.ranges.map(rangeHash),
    bettingAbstraction: identity.bettingAbstraction,
    algorithmConfiguration: identity.algorithmConfiguration,
    solverVersion: identity.solverVersion ?? SOLVER_VERSION,
  });
}

export class ContinuationArtifactCache<T> {
  private readonly artifacts = new Map<string, T>();
  private hits = 0;
  private misses = 0;

  getOrCreate(identity: ContinuationArtifactIdentity, create: () => T) {
    const key = continuationArtifactKey(identity);
    const existing = this.artifacts.get(key);
    if (existing !== undefined) {
      this.hits += 1;
      return { key, value: existing, cacheHit: true };
    }
    this.misses += 1;
    const value = create();
    this.artifacts.set(key, value);
    return { key, value, cacheHit: false };
  }

  get size() {
    return this.artifacts.size;
  }

  metrics() {
    const requests = this.hits + this.misses;
    return {
      entries: this.artifacts.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: requests ? this.hits / requests : 0,
      rangeWeightQuantization: 1e-9,
    };
  }
}