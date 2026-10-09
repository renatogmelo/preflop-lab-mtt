import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { hashValue, stableStringify } from "../../core/stable";
import { COMPACT_TREE_VERSION, type CompactIndexedTree } from "../compact/compact-tree";
import { structuralHashCompactTree } from "../fast-compiler/compiler-v2";
import {
  deserializeStructuralCache,
  type StructuralCacheIdentity,
  validateCompactTreeInvariants,
} from "../fast-compiler/structural-cache-v1";

export const STRUCTURAL_CACHE_V2_VERSION = "structural-cache-v2.0.0";
const MAGIC_V2 = Buffer.from("PLSCV002", "ascii");
const MAGIC_V1 = Buffer.from("PLSCV001", "ascii");
const FORMAT_VERSION = 2;
// Fixed prefix: format metadata (24 bytes) + the complete SHA-256 digest
// (32 bytes), avoiding a weakened truncated integrity check.
const PREFIX_BYTES = 56;
const MAX_HEADER_BYTES = 16 * 1024 * 1024;

type NumericArray = Uint8Array | Int8Array | Uint16Array | Uint32Array | Int32Array | Float64Array;
type ArrayName = "kind" | "actor" | "firstChild" | "childCount" | "informationSet" | "edgeProbability" | "terminalP0" | "informationSetActionOffset" | "informationSetActionCount";
type ArrayDescriptor = { name: ArrayName; type: string; offset: number; byteLength: number; length: number; alignment: number };

const arrayNames: readonly ArrayName[] = [
  "kind", "actor", "firstChild", "childCount", "informationSet", "edgeProbability", "terminalP0",
  "informationSetActionOffset", "informationSetActionCount",
];

export type StructuralCacheIdentityV2 = {
  cacheVersion: typeof STRUCTURAL_CACHE_V2_VERSION;
  treeVersion: typeof COMPACT_TREE_VERSION;
  gameId: string;
  gameHash: string;
  compilerVersion: string;
  configurationHash: string;
  actionOrdering: string;
  utilityModel: string;
};

export type CacheTrustClass = "freshly-generated" | "persisted-local" | "imported";
export type CacheLoadMode = "safe-copy" | "shared-view";

export type CacheValidationPolicy = {
  header: true;
  integrity: true;
  structural: true;
  semanticProviderVerification: boolean;
};

export type CopyAccounting = {
  fileReadBytes: number;
  inputBufferAllocationBytes: number;
  explicitPayloadBytesCopied: number;
  backingArrayAllocations: number;
  typedArrayViewsCreated: number;
  retainedInputBytes: number;
  invisibleRuntimeCopies: null;
};

export type StructuralCacheHeaderV2 = {
  schemaVersion: 2;
  endianness: "little";
  createdAt: string;
  identity: StructuralCacheIdentityV2;
  identityHash: string;
  structuralHash: string;
  root: number;
  nodeCount: number;
  informationSetCount: number;
  maximumDepth: number;
  totalInformationSetActions: number;
  levels: CompactIndexedTree["levels"];
  validation: CompactIndexedTree["validation"];
  arrays: ArrayDescriptor[];
  payloadBytes: number;
};

function align(value: number, alignment: number) { return Math.ceil(value / alignment) * alignment; }
function sha256(value: Uint8Array) { return createHash("sha256").update(value).digest(); }
function sha256Streaming(value: Uint8Array, chunkBytes = 1024 * 1024) {
  const hash = createHash("sha256");
  for (let offset = 0; offset < value.byteLength; offset += chunkBytes) hash.update(value.subarray(offset, Math.min(value.byteLength, offset + chunkBytes)));
  return hash.digest();
}
function typeName(value: NumericArray) { return value.constructor.name; }
function bytes(value: ArrayBufferView) { return Buffer.from(value.buffer, value.byteOffset, value.byteLength); }

function constructorFor(type: string) {
  const constructors = { Uint8Array, Int8Array, Uint16Array, Uint32Array, Int32Array, Float64Array } as const;
  const Type = constructors[type as keyof typeof constructors];
  if (!Type) throw new Error(`Unsupported Structural Cache V2 array type ${type}.`);
  return Type;
}

export function createStructuralCacheIdentityV2(input: Omit<StructuralCacheIdentityV2, "cacheVersion" | "treeVersion">): StructuralCacheIdentityV2 {
  return { cacheVersion: STRUCTURAL_CACHE_V2_VERSION, treeVersion: COMPACT_TREE_VERSION, ...input };
}

export function cacheValidationPolicy(trust: CacheTrustClass): CacheValidationPolicy {
  return { header: true, integrity: true, structural: true, semanticProviderVerification: trust === "imported" };
}

export function serializeStructuralCacheV2(tree: CompactIndexedTree, identity: StructuralCacheIdentityV2) {
  if (tree.gameId !== identity.gameId || tree.gameHash !== identity.gameHash) throw new Error("Cannot cache a topology under a different semantic identity.");
  const invariantIssues = validateCompactTreeInvariants(tree);
  if (invariantIssues.length) throw new Error(`Refusing invalid Structural Cache V2 topology: ${invariantIssues.join(", ")}`);
  const arrays = arrayNames.map((name) => [name, tree[name] as NumericArray] as const);
  let payloadLength = 0;
  const descriptors = arrays.map(([name, value]) => {
    const alignment = value.BYTES_PER_ELEMENT;
    payloadLength = align(payloadLength, alignment);
    const descriptor: ArrayDescriptor = { name, type: typeName(value), offset: payloadLength, byteLength: value.byteLength, length: value.length, alignment };
    payloadLength += value.byteLength;
    return descriptor;
  });
  payloadLength = align(payloadLength, 8);
  const payload = Buffer.alloc(payloadLength);
  let explicitPayloadBytesCopied = 0;
  arrays.forEach(([, value], index) => {
    const source = bytes(value);
    source.copy(payload, descriptors[index].offset);
    explicitPayloadBytesCopied += source.length;
  });
  const header: StructuralCacheHeaderV2 = {
    schemaVersion: 2,
    endianness: "little",
    createdAt: new Date().toISOString(),
    identity,
    identityHash: hashValue(identity),
    structuralHash: structuralHashCompactTree(tree),
    root: tree.root,
    nodeCount: tree.kind.length,
    informationSetCount: tree.informationSetActionCount.length,
    maximumDepth: tree.maximumDepth,
    totalInformationSetActions: tree.totalInformationSetActions,
    levels: tree.levels,
    validation: tree.validation,
    arrays: descriptors,
    payloadBytes: payload.length,
  };
  const headerBytes = Buffer.from(stableStringify(header), "utf8");
  if (headerBytes.length > MAX_HEADER_BYTES) throw new Error("Structural Cache V2 header is too large.");
  const payloadOffset = align(PREFIX_BYTES + headerBytes.length, 8);
  const prefixAndHeader = Buffer.alloc(payloadOffset);
  MAGIC_V2.copy(prefixAndHeader, 0);
  prefixAndHeader.writeUInt32LE(FORMAT_VERSION, 8);
  prefixAndHeader.writeUInt32LE(headerBytes.length, 12);
  prefixAndHeader.writeUInt32LE(payloadOffset, 16);
  prefixAndHeader.writeUInt32LE(payload.length, 20);
  const payloadChecksum = sha256(payload);
  payloadChecksum.copy(prefixAndHeader, 24);
  headerBytes.copy(prefixAndHeader, PREFIX_BYTES);
  return {
    buffer: Buffer.concat([prefixAndHeader, payload]),
    header,
    checksum: payloadChecksum.toString("hex"),
    copyAccounting: { explicitPayloadBytesCopied, serializationBufferBytes: prefixAndHeader.length + payload.length },
  };
}

function constructArray(
  descriptor: ArrayDescriptor,
  payload: Buffer,
  mode: CacheLoadMode,
  accounting: CopyAccounting,
): NumericArray {
  const Type = constructorFor(descriptor.type);
  if (descriptor.alignment !== Type.BYTES_PER_ELEMENT || descriptor.offset % descriptor.alignment !== 0 || descriptor.byteLength !== descriptor.length * descriptor.alignment) throw new Error(`Structural Cache V2 array ${descriptor.name} has invalid alignment metadata.`);
  if (descriptor.offset < 0 || descriptor.byteLength < 0 || descriptor.offset + descriptor.byteLength > payload.length) throw new Error(`Structural Cache V2 array ${descriptor.name} is out of bounds.`);
  const absolute = payload.byteOffset + descriptor.offset;
  if (absolute % descriptor.alignment !== 0) throw new Error(`Structural Cache V2 array ${descriptor.name} is not aligned in the backing store.`);
  accounting.typedArrayViewsCreated += 1;
  if (mode === "shared-view") return new Type(payload.buffer as ArrayBuffer, absolute, descriptor.length) as NumericArray;
  const result = new Type(descriptor.length) as NumericArray;
  new Uint8Array(result.buffer, result.byteOffset, result.byteLength).set(payload.subarray(descriptor.offset, descriptor.offset + descriptor.byteLength));
  accounting.explicitPayloadBytesCopied += descriptor.byteLength;
  accounting.backingArrayAllocations += 1;
  return result;
}

export class SharedTopologyLease {
  private active = true;
  constructor(readonly tree: CompactIndexedTree, private backing: Buffer, private readonly payloadOffset: number, readonly checksum: string) {}
  assertUnmodified() {
    if (!this.active) throw new Error("Structural cache shared-view lease was released.");
    const actual = sha256(this.backing.subarray(this.payloadOffset)).toString("hex");
    if (actual !== this.checksum) throw new Error("Structural cache shared-view topology was mutated after validation.");
    return true;
  }
  release() { this.active = false; this.backing = Buffer.alloc(0); }
  get isActive() { return this.active; }
}

export function deserializeStructuralCacheV2(
  value: Uint8Array,
  expectedIdentity: StructuralCacheIdentityV2,
  options: {
    mode?: CacheLoadMode;
    trust?: CacheTrustClass;
    expectedV1Identity?: StructuralCacheIdentity;
    semanticVerifier?: (tree: CompactIndexedTree) => void;
    fileReadBytes?: number;
    integrityMode?: "whole-buffer" | "streaming";
  } = {},
) {
  const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(MAGIC_V1)) {
    if (!options.expectedV1Identity) throw new Error("Structural Cache V1 compatibility requires its explicit identity.");
    const started = performance.now();
    const legacy = deserializeStructuralCache(buffer, options.expectedV1Identity);
    return {
      format: "v1-compatibility" as const,
      tree: legacy.tree,
      header: legacy.header,
      checksum: legacy.checksum,
      lease: null,
      policy: cacheValidationPolicy(options.trust ?? "persisted-local"),
      timings: { totalMs: performance.now() - started, headerMs: null, integrityMs: null, viewCreationMs: null, structuralValidationMs: null, structuralHashMs: null, semanticVerificationMs: null },
      copyAccounting: {
        fileReadBytes: options.fileReadBytes ?? buffer.length,
        inputBufferAllocationBytes: buffer.length,
        explicitPayloadBytesCopied: legacy.header.payloadBytes,
        backingArrayAllocations: arrayNames.length,
        typedArrayViewsCreated: 0,
        retainedInputBytes: 0,
        invisibleRuntimeCopies: null,
      } satisfies CopyAccounting,
    };
  }
  const totalStarted = performance.now();
  const headerStarted = performance.now();
  if (buffer.length < PREFIX_BYTES || !buffer.subarray(0, 8).equals(MAGIC_V2)) throw new Error("Structural Cache V2 magic or length mismatch.");
  if (buffer.readUInt32LE(8) !== FORMAT_VERSION) throw new Error("Structural Cache V2 version mismatch.");
  const headerLength = buffer.readUInt32LE(12);
  const payloadOffset = buffer.readUInt32LE(16);
  const payloadLength = buffer.readUInt32LE(20);
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES || payloadOffset !== align(PREFIX_BYTES + headerLength, 8) || payloadOffset + payloadLength !== buffer.length) throw new Error("Structural Cache V2 length metadata mismatch.");
  const header = JSON.parse(buffer.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength).toString("utf8")) as StructuralCacheHeaderV2;
  if (header.schemaVersion !== 2 || header.endianness !== "little" || header.payloadBytes !== payloadLength) throw new Error("Structural Cache V2 schema metadata mismatch.");
  if (header.identityHash !== hashValue(header.identity) || stableStringify(header.identity) !== stableStringify(expectedIdentity)) throw new Error("Structural Cache V2 identity mismatch.");
  const headerMs = performance.now() - headerStarted;
  const payload = buffer.subarray(payloadOffset);
  const integrityStarted = performance.now();
  const checksumDigest = options.integrityMode === "streaming" ? sha256Streaming(payload) : sha256(payload);
  const checksum = checksumDigest.toString("hex");
  if (!checksumDigest.equals(buffer.subarray(24, PREFIX_BYTES))) throw new Error("Structural Cache V2 payload checksum mismatch.");
  const integrityMs = performance.now() - integrityStarted;
  const accounting: CopyAccounting = {
    fileReadBytes: options.fileReadBytes ?? buffer.length,
    inputBufferAllocationBytes: buffer.length,
    explicitPayloadBytesCopied: 0,
    backingArrayAllocations: 0,
    typedArrayViewsCreated: 0,
    retainedInputBytes: options.mode === "shared-view" ? buffer.length : 0,
    invisibleRuntimeCopies: null,
  };
  const viewStarted = performance.now();
  const arrays = new Map<ArrayName, NumericArray>();
  const seen = new Set<string>();
  for (const descriptor of header.arrays) {
    if (!arrayNames.includes(descriptor.name) || seen.has(descriptor.name)) throw new Error("Structural Cache V2 array manifest is invalid.");
    seen.add(descriptor.name);
    arrays.set(descriptor.name, constructArray(descriptor, payload, options.mode ?? "safe-copy", accounting));
  }
  if (seen.size !== arrayNames.length) throw new Error("Structural Cache V2 is missing arrays.");
  const get = <T extends NumericArray>(name: ArrayName) => arrays.get(name) as T;
  const tree: CompactIndexedTree = Object.freeze({
    version: COMPACT_TREE_VERSION,
    gameId: header.identity.gameId,
    gameHash: header.identity.gameHash,
    root: header.root,
    kind: get<Uint8Array>("kind"), actor: get<Int8Array>("actor"), firstChild: get<Uint32Array>("firstChild"),
    childCount: get<Uint16Array>("childCount"), informationSet: get<Int32Array>("informationSet"),
    edgeProbability: get<Float64Array>("edgeProbability"), terminalP0: get<Float64Array>("terminalP0"),
    informationSetActionOffset: get<Uint32Array>("informationSetActionOffset"), informationSetActionCount: get<Uint16Array>("informationSetActionCount"),
    levels: header.levels, totalInformationSetActions: header.totalInformationSetActions, maximumDepth: header.maximumDepth, validation: header.validation,
  });
  const viewCreationMs = performance.now() - viewStarted;
  if (tree.kind.length !== header.nodeCount || tree.informationSetActionCount.length !== header.informationSetCount) throw new Error("Structural Cache V2 declared counts mismatch.");
  const structuralStarted = performance.now();
  const issues = validateCompactTreeInvariants(tree);
  if (issues.length) throw new Error(`Structural Cache V2 invariant validation failed: ${issues.join(", ")}`);
  const structuralValidationMs = performance.now() - structuralStarted;
  const hashStarted = performance.now();
  if (structuralHashCompactTree(tree) !== header.structuralHash) throw new Error("Structural Cache V2 structural hash mismatch.");
  const structuralHashMs = performance.now() - hashStarted;
  const policy = cacheValidationPolicy(options.trust ?? "persisted-local");
  const semanticStarted = performance.now();
  if (policy.semanticProviderVerification) {
    if (!options.semanticVerifier) throw new Error("Imported Structural Cache V2 requires semantic provider verification.");
    options.semanticVerifier(tree);
  }
  const semanticVerificationMs = performance.now() - semanticStarted;
  const lease = (options.mode ?? "safe-copy") === "shared-view" ? new SharedTopologyLease(tree, buffer, payloadOffset, checksum) : null;
  return {
    format: "v2" as const,
    tree,
    header,
    checksum,
    lease,
    policy,
    timings: { totalMs: performance.now() - totalStarted, headerMs, integrityMs, viewCreationMs, structuralValidationMs, structuralHashMs, semanticVerificationMs },
    copyAccounting: accounting,
  };
}

export async function loadStructuralCacheV2(path: string, identity: StructuralCacheIdentityV2, options: Parameters<typeof deserializeStructuralCacheV2>[2] = {}) {
  const started = performance.now();
  const file = await readFile(path);
  const readMs = performance.now() - started;
  const loaded = deserializeStructuralCacheV2(file, identity, { ...options, fileReadBytes: file.length });
  return { ...loaded, timings: { ...loaded.timings, readMs, startupMs: performance.now() - started } };
}
