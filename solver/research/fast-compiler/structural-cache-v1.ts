import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { hashValue, stableStringify } from "../../core/stable";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { COMPACT_TREE_VERSION, type CompactIndexedTree } from "../compact/compact-tree";
import { COMPACT_SYNTHETIC_PROVIDER_VERSION, SyntheticCompactProvider } from "../compact/synthetic-compact-provider";
import { structuralHashCompactTree } from "./compiler-v2";

export const STRUCTURAL_CACHE_VERSION = "structural-cache-v1";
const MAGIC = Buffer.from("PLSCV001", "ascii");
const FORMAT_VERSION = 1;
const PREFIX_BYTES = 56;
const MAX_HEADER_BYTES = 16 * 1024 * 1024;

type NumericArray = Uint8Array | Int8Array | Uint16Array | Uint32Array | Int32Array | Float64Array;
type ArrayName =
  | "kind"
  | "actor"
  | "firstChild"
  | "childCount"
  | "informationSet"
  | "edgeProbability"
  | "terminalP0"
  | "informationSetActionOffset"
  | "informationSetActionCount";

type ArrayDescriptor = { name: ArrayName; type: string; offset: number; byteLength: number; length: number };

export type StructuralCacheIdentity = {
  cacheVersion: typeof STRUCTURAL_CACHE_VERSION;
  treeVersion: typeof COMPACT_TREE_VERSION;
  providerVersion: typeof COMPACT_SYNTHETIC_PROVIDER_VERSION;
  gameConfiguration: SyntheticGameConfiguration;
  gameHash: string;
  actionOrdering: "stable-contiguous-numeric-v1";
  utilityModel: "synthetic-zero-sum-terminal-p0-v0.9.0";
};

export type StructuralCacheHeader = {
  schemaVersion: 1;
  endianness: "little";
  createdAt: string;
  source: "typescript-v2" | "rust-v1" | "test";
  identity: StructuralCacheIdentity;
  identityHash: string;
  configurationHash: string;
  structuralHash: string;
  gameId: string;
  nodeCount: number;
  informationSetCount: number;
  root: number;
  maximumDepth: number;
  totalInformationSetActions: number;
  validation: CompactIndexedTree["validation"];
  levels: CompactIndexedTree["levels"];
  arrays: ArrayDescriptor[];
  payloadBytes: number;
};

export type StructuralCacheLoad = {
  hit: boolean;
  reason: "hit" | "not-found" | "identity-mismatch" | "invalid-cache";
  tree?: CompactIndexedTree;
  header?: StructuralCacheHeader;
  checksum?: string;
  fileBytes?: number;
  error?: string;
};

const arrayNames: readonly ArrayName[] = [
  "kind",
  "actor",
  "firstChild",
  "childCount",
  "informationSet",
  "edgeProbability",
  "terminalP0",
  "informationSetActionOffset",
  "informationSetActionCount",
];

function typeName(value: NumericArray) {
  return value.constructor.name;
}

function copyBytes(value: ArrayBufferView) {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest();
}

function constructArray(type: string, bytes: Uint8Array, expectedLength: number): NumericArray {
  const copied = Uint8Array.from(bytes).buffer;
  const result: NumericArray = type === "Uint8Array" ? new Uint8Array(copied)
    : type === "Int8Array" ? new Int8Array(copied)
      : type === "Uint16Array" ? new Uint16Array(copied)
        : type === "Uint32Array" ? new Uint32Array(copied)
          : type === "Int32Array" ? new Int32Array(copied)
            : type === "Float64Array" ? new Float64Array(copied)
              : (() => { throw new Error(`Unsupported cache array type ${type}.`); })();
  if (result.length !== expectedLength) throw new Error(`Array ${type} length mismatch.`);
  return result;
}

export function createStructuralCacheIdentity(configuration: SyntheticGameConfiguration): StructuralCacheIdentity {
  const provider = new SyntheticCompactProvider(configuration);
  return {
    cacheVersion: STRUCTURAL_CACHE_VERSION,
    treeVersion: COMPACT_TREE_VERSION,
    providerVersion: COMPACT_SYNTHETIC_PROVIDER_VERSION,
    gameConfiguration: configuration,
    gameHash: provider.logicalGameHash,
    actionOrdering: "stable-contiguous-numeric-v1",
    utilityModel: "synthetic-zero-sum-terminal-p0-v0.9.0",
  };
}

export function structuralCacheKey(identity: StructuralCacheIdentity) {
  return hashValue(identity);
}

export function validateCompactTreeInvariants(tree: CompactIndexedTree) {
  const issues: string[] = [];
  const add = (issue: string) => { if (issues.length < 64) issues.push(issue); };
  const nodes = tree.kind.length;
  const nodeArrays: Array<[string, { length: number }]> = [
    ["actor", tree.actor], ["firstChild", tree.firstChild], ["childCount", tree.childCount],
    ["informationSet", tree.informationSet], ["edgeProbability", tree.edgeProbability], ["terminalP0", tree.terminalP0],
  ];
  for (const [name, value] of nodeArrays) if (value.length !== nodes) add(`length:${name}`);
  if (tree.root !== 0 || nodes < 1) add("root");
  if (tree.informationSetActionOffset.length !== tree.informationSetActionCount.length + 1) add("information-set-registry-length");
  if (tree.informationSetActionOffset.at(-1) !== tree.totalInformationSetActions) add("information-set-action-total");
  for (let info = 0; info < tree.informationSetActionCount.length; info += 1) {
    if (tree.informationSetActionCount[info] < 1
      || tree.informationSetActionOffset[info + 1] !== tree.informationSetActionOffset[info] + tree.informationSetActionCount[info]) add(`information-set-offset:${info}`);
  }
  const parentSeen = new Uint8Array(nodes);
  if (nodes) parentSeen[tree.root] = 1;
  let terminalCount = 0;
  let chanceCount = 0;
  let decisionCount = 0;
  for (let node = 0; node < nodes; node += 1) {
    const kind = tree.kind[node];
    if (kind === 0) {
      terminalCount += 1;
      if (tree.actor[node] !== -1 || !Number.isFinite(tree.terminalP0[node])) add(`terminal:${node}`);
      continue;
    }
    const count = tree.childCount[node];
    const first = tree.firstChild[node];
    const validChildren = count >= 1 && first > node && first + count <= nodes;
    if (!validChildren) add(`children:${node}`);
    if (validChildren) {
      for (let child = first; child < first + count; child += 1) {
        if (parentSeen[child]) add(`multiple-parent:${child}`);
        parentSeen[child] = 1;
      }
    }
    if (kind === 1) {
      chanceCount += 1;
      if (tree.actor[node] !== -1) add(`chance-actor:${node}`);
      let total = 0;
      if (validChildren) for (let child = first; child < first + count; child += 1) {
        const probability = tree.edgeProbability[child];
        if (!Number.isFinite(probability) || probability < 0) add(`chance-probability:${child}`);
        total += probability;
      }
      if (Math.abs(total - 1) > 1e-12) add(`chance:${node}`);
    } else if (kind === 2) {
      decisionCount += 1;
      if (tree.actor[node] !== 0 && tree.actor[node] !== 1) add(`decision-actor:${node}`);
      const info = tree.informationSet[node];
      if (info < 0 || info >= tree.informationSetActionCount.length || tree.informationSetActionCount[info] !== count) add(`information-set:${node}`);
    } else add(`kind:${node}`);
  }
  for (let node = 0; node < nodes; node += 1) if (!parentSeen[node]) add(`unreachable:${node}`);
  if (terminalCount !== tree.validation.terminals) add("terminal-count");
  if (chanceCount !== tree.validation.chanceNodes) add("chance-count");
  if (decisionCount !== tree.validation.decisionNodes) add("decision-count");
  return issues;
}
export function serializeStructuralCache(
  tree: CompactIndexedTree,
  identity: StructuralCacheIdentity,
  source: StructuralCacheHeader["source"] = "typescript-v2",
) {
  if (tree.gameHash !== identity.gameHash) throw new Error("Cannot cache a tree under a different game identity.");
  const invariantIssues = validateCompactTreeInvariants(tree);
  if (invariantIssues.length) throw new Error(`Refusing invalid structural cache: ${invariantIssues.join(", ")}`);
  const arrays: Array<[ArrayName, NumericArray]> = arrayNames.map((name) => [name, tree[name] as NumericArray]);
  let offset = 0;
  const descriptors = arrays.map(([name, value]) => {
    const descriptor = { name, type: typeName(value), offset, byteLength: value.byteLength, length: value.length };
    offset += value.byteLength;
    return descriptor;
  });
  const payload = Buffer.allocUnsafe(offset);
  for (const [index, [, value]] of arrays.entries()) copyBytes(value).copy(payload, descriptors[index].offset);
  const checksum = sha256(payload);
  const header: StructuralCacheHeader = {
    schemaVersion: 1,
    endianness: "little",
    createdAt: new Date().toISOString(),
    source,
    identity,
    identityHash: structuralCacheKey(identity),
    configurationHash: hashValue(identity.gameConfiguration),
    structuralHash: structuralHashCompactTree(tree),
    gameId: tree.gameId,
    nodeCount: tree.kind.length,
    informationSetCount: tree.informationSetActionCount.length,
    root: tree.root,
    maximumDepth: tree.maximumDepth,
    totalInformationSetActions: tree.totalInformationSetActions,
    validation: tree.validation,
    levels: tree.levels,
    arrays: descriptors,
    payloadBytes: payload.length,
  };
  const headerBytes = Buffer.from(stableStringify(header), "utf8");
  if (headerBytes.length > MAX_HEADER_BYTES) throw new Error("Structural cache header is too large.");
  const prefix = Buffer.alloc(PREFIX_BYTES);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32LE(FORMAT_VERSION, 8);
  prefix.writeUInt32LE(headerBytes.length, 12);
  prefix.writeBigUInt64LE(BigInt(payload.length), 16);
  checksum.copy(prefix, 24);
  return { buffer: Buffer.concat([prefix, headerBytes, payload]), header, checksum: checksum.toString("hex") };
}

export function deserializeStructuralCache(
  value: Uint8Array,
  expectedIdentity?: StructuralCacheIdentity,
) {
  const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (buffer.length < PREFIX_BYTES) throw new Error("Structural cache is truncated before its header.");
  if (!buffer.subarray(0, 8).equals(MAGIC)) throw new Error("Structural cache magic mismatch.");
  if (buffer.readUInt32LE(8) !== FORMAT_VERSION) throw new Error("Structural cache version mismatch.");
  const headerLength = buffer.readUInt32LE(12);
  const payloadLengthBig = buffer.readBigUInt64LE(16);
  if (payloadLengthBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Structural cache payload exceeds safe integer capacity.");
  const payloadLength = Number(payloadLengthBig);
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) throw new Error("Structural cache header length is invalid.");
  if (PREFIX_BYTES + headerLength + payloadLength !== buffer.length) throw new Error("Structural cache length mismatch.");
  const checksum = buffer.subarray(24, 56);
  const header = JSON.parse(buffer.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength).toString("utf8")) as StructuralCacheHeader;
  if (header.schemaVersion !== 1 || header.endianness !== "little" || header.payloadBytes !== payloadLength) throw new Error("Structural cache schema metadata mismatch.");
  if (header.identity.cacheVersion !== STRUCTURAL_CACHE_VERSION || header.identity.treeVersion !== COMPACT_TREE_VERSION
    || header.identity.providerVersion !== COMPACT_SYNTHETIC_PROVIDER_VERSION) throw new Error("Structural cache identity version mismatch.");
  const identityProvider = new SyntheticCompactProvider(header.identity.gameConfiguration);
  if (identityProvider.logicalGameHash !== header.identity.gameHash || identityProvider.id !== header.gameId
    || identityProvider.nodeCount !== header.nodeCount || identityProvider.informationSetCount !== header.informationSetCount
    || identityProvider.maximumDepth !== header.maximumDepth || stableStringify(identityProvider.levels) !== stableStringify(header.levels)) {
    throw new Error("Structural cache provider layout identity mismatch.");
  }
  if (header.identityHash !== structuralCacheKey(header.identity) || header.configurationHash !== hashValue(header.identity.gameConfiguration)) throw new Error("Structural cache identity checksum mismatch.");
  if (expectedIdentity && stableStringify(header.identity) !== stableStringify(expectedIdentity)) throw new Error("Structural cache identity mismatch.");
  const payload = buffer.subarray(PREFIX_BYTES + headerLength);
  if (!sha256(payload).equals(checksum)) throw new Error("Structural cache payload checksum mismatch.");
  const seen = new Set<string>();
  const arrays = new Map<ArrayName, NumericArray>();
  for (const descriptor of header.arrays) {
    if (!arrayNames.includes(descriptor.name) || seen.has(descriptor.name)) throw new Error("Structural cache array manifest is invalid.");
    if (!Number.isSafeInteger(descriptor.offset) || !Number.isSafeInteger(descriptor.byteLength) || descriptor.offset < 0 || descriptor.byteLength < 0 || descriptor.offset + descriptor.byteLength > payload.length) throw new Error(`Structural cache array ${descriptor.name} is out of bounds.`);
    seen.add(descriptor.name);
    arrays.set(descriptor.name, constructArray(descriptor.type, payload.subarray(descriptor.offset, descriptor.offset + descriptor.byteLength), descriptor.length));
  }
  if (seen.size !== arrayNames.length) throw new Error("Structural cache is missing required arrays.");
  const get = <T extends NumericArray>(name: ArrayName) => arrays.get(name) as T;
  const tree: CompactIndexedTree = {
    version: COMPACT_TREE_VERSION,
    gameId: header.gameId,
    gameHash: header.identity.gameHash,
    root: header.root,
    kind: get<Uint8Array>("kind"),
    actor: get<Int8Array>("actor"),
    firstChild: get<Uint32Array>("firstChild"),
    childCount: get<Uint16Array>("childCount"),
    informationSet: get<Int32Array>("informationSet"),
    edgeProbability: get<Float64Array>("edgeProbability"),
    terminalP0: get<Float64Array>("terminalP0"),
    informationSetActionOffset: get<Uint32Array>("informationSetActionOffset"),
    informationSetActionCount: get<Uint16Array>("informationSetActionCount"),
    levels: header.levels,
    totalInformationSetActions: header.totalInformationSetActions,
    maximumDepth: header.maximumDepth,
    validation: header.validation,
  };
  if (header.nodeCount !== tree.kind.length || header.informationSetCount !== tree.informationSetActionCount.length) throw new Error("Structural cache declared counts mismatch.");
  const issues = validateCompactTreeInvariants(tree);
  if (issues.length) throw new Error(`Structural cache invariant validation failed: ${issues.join(", ")}`);
  if (structuralHashCompactTree(tree) !== header.structuralHash) throw new Error("Structural cache structural hash mismatch.");
  return { tree, header, checksum: checksum.toString("hex") };
}

export type StructuralCacheWriteOptions = { simulateFailureAfterSync?: boolean };

export async function writeStructuralCacheAtomic(
  path: string,
  tree: CompactIndexedTree,
  identity: StructuralCacheIdentity,
  source: StructuralCacheHeader["source"] = "typescript-v2",
  options: StructuralCacheWriteOptions = {},
) {
  const serialized = serializeStructuralCache(tree, identity, source);
  await mkdir(dirname(path), { recursive: true });
  try {
    const existing = await readFile(path);
    const loaded = deserializeStructuralCache(existing, identity);
    if (loaded.header.structuralHash === serialized.header.structuralHash) return { ...serialized, written: false, fileBytes: existing.length };
    throw new Error("Refusing to overwrite a valid structural cache with different topology; use a content-addressed key.");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
      throw new Error(`Existing structural cache is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(serialized.buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    deserializeStructuralCache(await readFile(temporary), identity);
    if (options.simulateFailureAfterSync) throw new Error("Simulated structural cache interruption after sync.");
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  const metadata = await stat(path);
  return { ...serialized, written: true, fileBytes: metadata.size };
}

export async function recoverStructuralCache(path: string, identity: StructuralCacheIdentity) {
  await mkdir(dirname(path), { recursive: true });
  const prefix = `.${basename(path)}.`;
  const entries = await readdir(dirname(path));
  const temporary = entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith(".tmp"));
  await Promise.all(temporary.map((entry) => unlink(join(dirname(path), entry))));
  const loaded = await loadStructuralCache(path, identity);
  return { recovered: loaded.hit, removedTemporaryFiles: temporary.length, load: loaded };
}
export async function loadStructuralCache(path: string, expectedIdentity: StructuralCacheIdentity): Promise<StructuralCacheLoad> {
  try {
    const file = await readFile(path);
    try {
      const loaded = deserializeStructuralCache(file, expectedIdentity);
      return { hit: true, reason: "hit", ...loaded, fileBytes: file.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { hit: false, reason: message.includes("identity mismatch") ? "identity-mismatch" : "invalid-cache", error: message };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { hit: false, reason: "not-found" };
    return { hit: false, reason: "invalid-cache", error: error instanceof Error ? error.message : String(error) };
  }
}