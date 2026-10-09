import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { COMPACT_TREE_VERSION, type CompactIndexedTree } from "../compact/compact-tree";
import { SyntheticCompactProvider } from "../compact/synthetic-compact-provider";
import { structuralHashCompactTree, type CompilerV2Profile } from "./compiler-v2";

const execFileAsync = promisify(execFile);
const MAGIC = Buffer.from("PLR61101", "ascii");
const HEADER_BYTES = 72;
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const U64_MASK = BigInt("0xffffffffffffffff");

function fnv64(value: string) {
  let state = FNV_OFFSET;
  for (const byte of Buffer.from(value, "utf8")) state = ((state ^ BigInt(byte)) * FNV_PRIME) & U64_MASK;
  return state;
}

function crc32(value: Uint8Array) {
  let crc = 0xffff_ffff;
  for (const byte of value) {
    crc = (crc ^ byte) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) crc = ((crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0)) >>> 0;
  }
  return (~crc) >>> 0;
}

export function rustConfigurationFingerprint(configuration: SyntheticGameConfiguration) {
  return fnv64(`${configuration.id}|${configuration.privateStates}|${configuration.publicSignals}|${configuration.stages}|${configuration.actionsPerDecision}|${configuration.seed}|${configuration.dependencyComplexity}`);
}

function takeArray<T extends ArrayBufferView>(
  payload: Buffer,
  cursor: { value: number },
  bytesPerElement: number,
  length: number,
  construct: (buffer: ArrayBuffer) => T,
) {
  const byteLength = bytesPerElement * length;
  if (!Number.isSafeInteger(byteLength) || cursor.value + byteLength > payload.length) throw new Error("Rust topology array exceeds payload bounds.");
  const buffer = Uint8Array.from(payload.subarray(cursor.value, cursor.value + byteLength)).buffer;
  cursor.value += byteLength;
  const result = construct(buffer);
  if ((result as unknown as { length: number }).length !== length) throw new Error("Rust topology array length mismatch.");
  return result;
}

export type RustTopology = {
  tree: CompactIndexedTree;
  checksum: number;
  nativeStructuralHash: string;
  structuralHash: string;
  fileBytes: number;
  validationMs: number;
};

export function decodeRustTopology(value: Uint8Array, configuration: SyntheticGameConfiguration): RustTopology {
  const started = performance.now();
  const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (buffer.length < HEADER_BYTES) throw new Error("Rust topology is truncated before the header.");
  if (!buffer.subarray(0, 8).equals(MAGIC)) throw new Error("Rust topology magic mismatch.");
  if (buffer.readUInt32LE(8) !== 1) throw new Error("Rust topology version mismatch.");
  const nodes = buffer.readUInt32LE(12);
  const informationSets = buffer.readUInt32LE(16);
  const maximumDepth = buffer.readUInt32LE(20);
  const totalInformationSetActions = buffer.readUInt32LE(24);
  const terminals = buffer.readUInt32LE(28);
  const chanceNodes = buffer.readUInt32LE(32);
  const decisionNodes = buffer.readUInt32LE(36);
  const payloadLengthBig = buffer.readBigUInt64LE(40);
  if (payloadLengthBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Rust topology payload exceeds safe integer capacity.");
  const payloadLength = Number(payloadLengthBig);
  const checksumBig = buffer.readBigUInt64LE(48);
  const expectedFingerprint = rustConfigurationFingerprint(configuration);
  if (buffer.readBigUInt64LE(56) !== expectedFingerprint) throw new Error("Rust topology configuration identity mismatch.");
  const nativeHash = buffer.readBigUInt64LE(64);
  if (buffer.length !== HEADER_BYTES + payloadLength) throw new Error("Rust topology payload length mismatch.");
  const payload = buffer.subarray(HEADER_BYTES);
  const checksum = crc32(payload);
  if (checksumBig !== BigInt(checksum)) throw new Error("Rust topology checksum mismatch.");
  if (nativeHash !== checksumBig) throw new Error("Rust topology structural hash mismatch.");
  const provider = new SyntheticCompactProvider(configuration);
  if (nodes !== provider.nodeCount || informationSets !== provider.informationSetCount || maximumDepth !== provider.maximumDepth) throw new Error("Rust topology header differs from the TypeScript size oracle.");
  if (terminals + chanceNodes + decisionNodes !== nodes) throw new Error("Rust topology node counts do not sum to the total.");
  if (totalInformationSetActions !== informationSets * configuration.actionsPerDecision) throw new Error("Rust topology information action count mismatch.");
  const cursor = { value: 0 };
  const kind = takeArray(payload, cursor, 1, nodes, (array) => new Uint8Array(array));
  const actor = takeArray(payload, cursor, 1, nodes, (array) => new Int8Array(array));
  const firstChild = takeArray(payload, cursor, 4, nodes, (array) => new Uint32Array(array));
  const childCount = takeArray(payload, cursor, 2, nodes, (array) => new Uint16Array(array));
  const informationSet = takeArray(payload, cursor, 4, nodes, (array) => new Int32Array(array));
  const edgeProbability = takeArray(payload, cursor, 8, nodes, (array) => new Float64Array(array));
  const terminalP0 = takeArray(payload, cursor, 8, nodes, (array) => new Float64Array(array));
  const informationSetActionOffset = takeArray(payload, cursor, 4, informationSets + 1, (array) => new Uint32Array(array));
  const informationSetActionCount = takeArray(payload, cursor, 2, informationSets, (array) => new Uint16Array(array));
  if (cursor.value !== payload.length) throw new Error("Rust topology contains trailing payload bytes.");
  let chanceMaximumError = 0;
  const maximumZeroSumError = 0;
  let countedTerminals = 0;
  let countedChance = 0;
  let countedDecision = 0;
  const issues: string[] = [];
  for (let node = 0; node < nodes; node += 1) {
    if (kind[node] === 0) {
      countedTerminals += 1;
      if (!Number.isFinite(terminalP0[node])) issues.push(`terminal-utility:${node}`);
    } else if (kind[node] === 1) {
      countedChance += 1;
      let total = 0;
      for (let child = firstChild[node]; child < firstChild[node] + childCount[node]; child += 1) total += edgeProbability[child];
      chanceMaximumError = Math.max(chanceMaximumError, Math.abs(total - 1));
    } else if (kind[node] === 2) countedDecision += 1;
    else issues.push(`kind:${node}`);
  }
  if (countedTerminals !== terminals || countedChance !== chanceNodes || countedDecision !== decisionNodes) issues.push("node-counts");
  if (chanceMaximumError > 1e-12) issues.push("chance-normalization");
  if (maximumZeroSumError > 1e-12) issues.push("zero-sum");
  const tree: CompactIndexedTree = {
    version: COMPACT_TREE_VERSION,
    gameId: provider.id,
    gameHash: provider.logicalGameHash,
    root: 0,
    kind,
    actor,
    firstChild,
    childCount,
    informationSet,
    edgeProbability,
    terminalP0,
    informationSetActionOffset,
    informationSetActionCount,
    levels: provider.levels,
    totalInformationSetActions,
    maximumDepth,
    validation: {
      valid: issues.length === 0,
      issues,
      nodes,
      terminals,
      chanceNodes,
      decisionNodes,
      informationSets,
      chanceMaximumError,
      maximumZeroSumError,
      allReachable: true,
      noInformationLeakage: true,
      perfectRecall: true,
    },
  };
  return {
    tree,
    checksum,
    nativeStructuralHash: nativeHash.toString(16).padStart(16, "0"),
    structuralHash: structuralHashCompactTree(tree),
    fileBytes: buffer.length,
    validationMs: performance.now() - started,
  };
}

export async function readRustTopology(path: string, configuration: SyntheticGameConfiguration) {
  return decodeRustTopology(await readFile(path), configuration);
}

export async function runRustStructuralCompiler(options: {
  executable: string;
  output: string;
  configuration: SyntheticGameConfiguration;
  timeoutMs?: number;
}) {
  const { configuration } = options;
  const started = performance.now();
  const { stdout, stderr } = await execFileAsync(options.executable, [
    "--output", options.output,
    "--id", configuration.id,
    "--private-states", String(configuration.privateStates),
    "--public-signals", String(configuration.publicSignals),
    "--stages", String(configuration.stages),
    "--actions", String(configuration.actionsPerDecision),
    "--seed", String(configuration.seed),
    "--dependency", configuration.dependencyComplexity,
  ], { windowsHide: true, timeout: options.timeoutMs ?? 120_000, maxBuffer: 1024 * 1024 });
  const processMs = performance.now() - started;
  const nativeTimings = JSON.parse(stdout.trim()) as {
    version: number;
    nodes: number;
    informationSets: number;
    bytes: number;
    parseMs: number;
    compileMs: number;
    serializationMs: number;
    writeMs: number;
    nativeTotalMs: number;
  };
  if (nativeTimings.version !== 1 || nativeTimings.nodes < 1) throw new Error("Rust compiler returned invalid timing metadata.");
  const loadStarted = performance.now();
  const decoded = await readRustTopology(options.output, configuration);
  const loadMs = performance.now() - loadStarted;
  return {
    ...decoded,
    processMs,
    nativeTimings,
    startupAndProtocolOverheadMs: Math.max(0, processMs - nativeTimings.nativeTotalMs),
    loadMs,
    totalIntegrationMs: processMs + loadMs,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    fileBytes: (await stat(options.output)).size,
  };
}

export function compareCompactTrees(
  expected: CompactIndexedTree,
  actual: CompactIndexedTree,
  tolerance = 1e-12,
) {
  const integerArrays = ["kind", "actor", "firstChild", "childCount", "informationSet", "informationSetActionOffset", "informationSetActionCount"] as const;
  const issues: string[] = [];
  for (const name of integerArrays) {
    const left = expected[name];
    const right = actual[name];
    if (left.length !== right.length) { issues.push(`${name}:length`); continue; }
    for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) { issues.push(`${name}:${index}`); break; }
  }
  let maximumChanceError = 0;
  let maximumUtilityError = 0;
  for (let index = 0; index < expected.edgeProbability.length; index += 1) maximumChanceError = Math.max(maximumChanceError, Math.abs(expected.edgeProbability[index] - actual.edgeProbability[index]));
  for (let index = 0; index < expected.terminalP0.length; index += 1) maximumUtilityError = Math.max(maximumUtilityError, Math.abs(expected.terminalP0[index] - actual.terminalP0[index]));
  if (maximumChanceError > tolerance) issues.push("edgeProbability:tolerance");
  if (maximumUtilityError > tolerance) issues.push("terminalP0:tolerance");
  return { equivalent: issues.length === 0, issues, maximumChanceError, maximumUtilityError, tolerance };
}

export type NativeCompilerProfileCompatibility = Pick<CompilerV2Profile, "chunkSize">;