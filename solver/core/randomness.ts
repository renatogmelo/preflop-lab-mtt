import { DeterministicRandom } from "./random";
import { hashValue } from "./stable";

export type RandomnessLedgerEntry = {
  subsystem: string;
  seed: number;
  streamId: string;
  sampleCount: number;
  purpose: string;
};

function seedFromHash(value: string) {
  const parsed = Number.parseInt(hashValue(value).slice(0, 8), 16) >>> 0;
  return parsed || 0x6d2b79f5;
}

export function deriveSubsystemSeed(masterSeed: number, subsystemId: string) {
  if (!Number.isInteger(masterSeed)) throw new Error("Master seed must be an integer.");
  if (!subsystemId.trim()) throw new Error("Subsystem id is required.");
  return seedFromHash(`${masterSeed >>> 0}:${subsystemId}`);
}

export class LedgerRandomStream {
  private readonly random: DeterministicRandom;
  private samples = 0;

  constructor(
    readonly masterSeed: number,
    readonly subsystem: string,
    readonly purpose: string,
  ) {
    this.random = new DeterministicRandom(deriveSubsystemSeed(masterSeed, subsystem));
  }

  next() {
    this.samples += 1;
    return this.random.next();
  }

  integer(maxExclusive: number) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error("Random bound must be a positive integer.");
    return Math.floor(this.next() * maxExclusive);
  }

  entry(): RandomnessLedgerEntry {
    const seed = deriveSubsystemSeed(this.masterSeed, this.subsystem);
    return {
      subsystem: this.subsystem,
      seed,
      streamId: hashValue({ masterSeed: this.masterSeed >>> 0, subsystem: this.subsystem, seed }),
      sampleCount: this.samples,
      purpose: this.purpose,
    };
  }

  checkpoint() {
    return { state: this.random.snapshot(), sampleCount: this.samples };
  }

  restore(checkpoint: { state: number; sampleCount: number }) {
    if (!Number.isInteger(checkpoint.sampleCount) || checkpoint.sampleCount < 0) throw new Error("Invalid RNG sample count.");
    this.random.restore(checkpoint.state);
    this.samples = checkpoint.sampleCount;
  }
}

export class RandomnessLedger {
  private readonly streams = new Map<string, LedgerRandomStream>();

  constructor(readonly masterSeed: number) {
    if (!Number.isInteger(masterSeed)) throw new Error("Master seed must be an integer.");
  }

  stream(subsystem: string, purpose: string) {
    const existing = this.streams.get(subsystem);
    if (existing) {
      if (existing.purpose !== purpose) throw new Error(`RNG subsystem ${subsystem} changed purpose.`);
      return existing;
    }
    const stream = new LedgerRandomStream(this.masterSeed, subsystem, purpose);
    this.streams.set(subsystem, stream);
    return stream;
  }

  entries() {
    return [...this.streams.values()].map((stream) => stream.entry()).sort((left, right) => left.subsystem.localeCompare(right.subsystem));
  }

  totalSamples() {
    return this.entries().reduce((sum, entry) => sum + entry.sampleCount, 0);
  }
}