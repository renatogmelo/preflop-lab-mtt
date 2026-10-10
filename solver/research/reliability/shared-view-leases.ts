import { randomUUID } from "node:crypto";
import type { SharedTopologyLease } from "../generic/structural-cache-v2";
import { ReliabilityError } from "./errors";

export type ManagedSharedViewLease = {
  leaseId: string;
  owner: string;
  generation: number;
  cacheIdentity: string;
  createdAt: string;
  active: boolean;
};

export class SharedViewLeaseRegistry {
  private readonly leases = new Map<string, { metadata: ManagedSharedViewLease; lease: SharedTopologyLease }>();

  register(lease: SharedTopologyLease, input: { owner: string; generation: number; cacheIdentity: string }) {
    if (!lease.isActive) throw new ReliabilityError("CACHE_INCOMPATIBLE", "Cannot register an inactive shared-view lease.", input);
    const metadata: ManagedSharedViewLease = {
      leaseId: randomUUID(),
      owner: input.owner,
      generation: input.generation,
      cacheIdentity: input.cacheIdentity,
      createdAt: new Date().toISOString(),
      active: true,
    };
    this.leases.set(metadata.leaseId, { metadata, lease });
    return metadata;
  }

  assertUsable(leaseId: string, expected: { owner: string; generation: number; cacheIdentity: string }) {
    const entry = this.leases.get(leaseId);
    if (!entry || !entry.metadata.active) throw new ReliabilityError("CACHE_INCOMPATIBLE", "Shared-view lease is inactive or unknown.", { leaseId });
    if (entry.metadata.owner !== expected.owner || entry.metadata.generation !== expected.generation || entry.metadata.cacheIdentity !== expected.cacheIdentity) {
      throw new ReliabilityError("CACHE_INCOMPATIBLE", "Shared-view lease ownership or generation mismatch.", { leaseId, expected, actual: entry.metadata });
    }
    try {
      entry.lease.assertUnmodified();
    } catch (error) {
      throw new ReliabilityError("CACHE_CORRUPTED", "Shared-view backing buffer changed after validation.", { leaseId }, { cause: error });
    }
    return true;
  }

  invalidateOlder(cacheIdentity: string, generation: number) {
    let invalidated = 0;
    for (const entry of this.leases.values()) {
      if (entry.metadata.cacheIdentity === cacheIdentity && entry.metadata.generation < generation && entry.metadata.active) {
        entry.lease.release();
        entry.metadata.active = false;
        invalidated += 1;
      }
    }
    return invalidated;
  }

  release(leaseId: string) {
    const entry = this.leases.get(leaseId);
    if (!entry || !entry.metadata.active) return false;
    entry.lease.release();
    entry.metadata.active = false;
    return true;
  }

  snapshot() {
    return [...this.leases.values()].map((entry) => ({ ...entry.metadata }));
  }
}
