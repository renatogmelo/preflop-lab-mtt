export class DeterministicRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  next() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }

  integer(maxExclusive: number) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error("Random bound must be a positive integer.");
    return Math.floor(this.next() * maxExclusive);
  }

  snapshot() {
    return this.state;
  }

  restore(state: number) {
    this.state = state >>> 0;
  }
}
