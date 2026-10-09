export type DynamicGrowthPolicy = "geometric" | "chunked" | "segmented";

type NumericTypedArray = Uint8Array | Int8Array | Uint16Array | Uint32Array | Int32Array | Float64Array;
type NumericTypedArrayConstructor<T extends NumericTypedArray> = {
  readonly BYTES_PER_ELEMENT: number;
  new(length: number): T;
};

export type DynamicBufferMetrics = {
  policy: DynamicGrowthPolicy;
  length: number;
  capacity: number;
  allocations: number;
  reallocations: number;
  bytesCopied: number;
  finalizationBytesCopied: number;
  logicalFragmentationBytes: number;
};

export class DynamicTypedBuffer<T extends NumericTypedArray> {
  private contiguous: T | null = null;
  private readonly segments: T[] = [];
  private used = 0;
  private allocationCount = 0;
  private reallocationCount = 0;
  private copied = 0;
  private finalizedCopied = 0;

  constructor(
    private readonly Type: NumericTypedArrayConstructor<T>,
    readonly policy: DynamicGrowthPolicy,
    readonly initialCapacity = 64,
    readonly chunkSize = 4_096,
  ) {
    if (!Number.isInteger(initialCapacity) || initialCapacity < 1) throw new Error("Initial capacity must be positive.");
    if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("Chunk size must be positive.");
    if (policy === "segmented") this.allocateSegment();
    else {
      this.contiguous = new Type(initialCapacity);
      this.allocationCount = 1;
    }
  }

  get length() { return this.used; }
  get capacity() {
    return this.policy === "segmented"
      ? this.segments.length * this.chunkSize
      : this.contiguous?.length ?? 0;
  }

  private allocateSegment() {
    this.segments.push(new this.Type(this.chunkSize));
    this.allocationCount += 1;
    if (this.segments.length > 1) this.reallocationCount += 1;
  }

  private ensure(required: number) {
    if (required <= this.capacity) return;
    if (this.policy === "segmented") {
      while (required > this.capacity) this.allocateSegment();
      return;
    }
    const previous = this.contiguous!;
    const capacity = this.policy === "geometric"
      ? Math.max(required, previous.length * 2)
      : Math.ceil(required / this.chunkSize) * this.chunkSize;
    const next = new this.Type(capacity);
    next.set(previous);
    this.copied += previous.byteLength;
    this.contiguous = next;
    this.allocationCount += 1;
    this.reallocationCount += 1;
  }

  push(value: number) {
    this.ensure(this.used + 1);
    this.set(this.used, value);
    this.used += 1;
    return this.used - 1;
  }

  set(index: number, value: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.capacity) throw new Error(`Dynamic buffer index ${index} is out of capacity.`);
    if (this.policy === "segmented") {
      const segment = Math.floor(index / this.chunkSize);
      this.segments[segment][index % this.chunkSize] = value;
    } else this.contiguous![index] = value;
  }

  get(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.used) throw new Error(`Dynamic buffer index ${index} is out of range.`);
    return this.policy === "segmented"
      ? this.segments[Math.floor(index / this.chunkSize)][index % this.chunkSize]
      : this.contiguous![index];
  }

  finalize(): T {
    if (this.policy !== "segmented" && this.contiguous!.length === this.used) return this.contiguous!;
    const result = new this.Type(this.used);
    if (this.policy === "segmented") {
      let offset = 0;
      for (const segment of this.segments) {
        const count = Math.min(segment.length, this.used - offset);
        if (count <= 0) break;
        result.set(segment.subarray(0, count) as T, offset);
        offset += count;
      }
    } else result.set(this.contiguous!.subarray(0, this.used) as T);
    this.finalizedCopied += result.byteLength;
    return result;
  }

  metrics(): DynamicBufferMetrics {
    return {
      policy: this.policy,
      length: this.used,
      capacity: this.capacity,
      allocations: this.allocationCount,
      reallocations: this.reallocationCount,
      bytesCopied: this.copied + this.finalizedCopied,
      finalizationBytesCopied: this.finalizedCopied,
      logicalFragmentationBytes: (this.capacity - this.used) * this.Type.BYTES_PER_ELEMENT,
    };
  }
}
