import { createHash, randomUUID } from "node:crypto";
import { access, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { stableStringify } from "../../core/stable";
import { SOLVER_VERSION } from "../../core/version";
import { COMPACT_CFR_VERSION, type CompactCfrSolver } from "../compact/compact-cfr";
import { COMPACT_TREE_VERSION } from "../compact/compact-tree";

export const BINARY_CHECKPOINT_VERSION = 5;
export const BINARY_CHECKPOINT_MAGIC = "PLCPV5\0\0";
export const BINARY_CHECKPOINT_ENDIANNESS = "little";
const FIXED_HEADER_BYTES = 116;

export type BinaryCheckpointMetadataV5 = {
  gameId: string;
  gameHash: string;
  configurationHash: string;
  solveId: string;
  solverVersion: string;
  algorithmVersion: string;
  structuralVersion: string;
  algorithm: string;
  configuration: unknown;
};

export type DecodedBinaryCheckpointV5 = {
  version: 5;
  endianness: "little";
  iteration: number;
  nodesVisited: number;
  regrets: Float64Array;
  strategySums: Float64Array;
  metadata: BinaryCheckpointMetadataV5;
  payloadChecksum: string;
  semanticStateHash: string;
  bytes: number;
  deserializationMs: number;
  checksumValidationMs: number;
};

export type SerializedBinaryCheckpointV5 = {
  buffer: Buffer;
  bytes: number;
  serializationMs: number;
  temporaryBytes: number;
  payloadChecksum: string;
  semanticStateHash: string;
  metadata: BinaryCheckpointMetadataV5;
};

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest();
}

function safeIntegerFromBigInt(value: bigint, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} exceeds safe integer capacity.`);
  return number;
}

function writeFloat64Payload(target: Buffer, offset: number, values: Float64Array) {
  for (let index = 0; index < values.length; index += 1) target.writeDoubleLE(values[index], offset + index * 8);
}

function readFloat64Payload(source: Buffer, offset: number, count: number, label: string) {
  const result = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const value = source.readDoubleLE(offset + index * 8);
    if (!Number.isFinite(value)) throw new Error(`${label} contains NaN or Infinity at ${index}.`);
    result[index] = value;
  }
  return result;
}

function semanticHash(
  metadata: Pick<BinaryCheckpointMetadataV5, "gameHash" | "configurationHash" | "algorithmVersion" | "structuralVersion">,
  iteration: number,
  nodesVisited: number,
  payloadChecksum: Buffer,
) {
  return sha256(`${metadata.gameHash}|${metadata.configurationHash}|${metadata.algorithmVersion}|${metadata.structuralVersion}|${iteration}|${nodesVisited}|${payloadChecksum.toString("hex")}`);
}

export function serializeBinaryCheckpointV5(solver: CompactCfrSolver): SerializedBinaryCheckpointV5 {
  const started = performance.now();
  const metadata: BinaryCheckpointMetadataV5 = {
    gameId: solver.tree.gameId,
    gameHash: solver.tree.gameHash,
    configurationHash: solver.configurationHash,
    solveId: solver.solveId,
    solverVersion: SOLVER_VERSION,
    algorithmVersion: COMPACT_CFR_VERSION,
    structuralVersion: solver.tree.version,
    algorithm: solver.configuration.algorithm,
    configuration: solver.configuration,
  };
  const metadataBytes = Buffer.from(stableStringify(metadata), "utf8");
  const payloadBytes = (solver.regrets.length + solver.strategySums.length) * 8;
  const headerBytes = FIXED_HEADER_BYTES + metadataBytes.length;
  const buffer = Buffer.allocUnsafe(headerBytes + payloadBytes);
  buffer.fill(0, 0, FIXED_HEADER_BYTES);
  buffer.write(BINARY_CHECKPOINT_MAGIC, 0, 8, "latin1");
  buffer.writeUInt16LE(BINARY_CHECKPOINT_VERSION, 8);
  buffer.writeUInt8(1, 10);
  buffer.writeUInt8(0, 11);
  buffer.writeUInt32LE(headerBytes, 12);
  buffer.writeBigUInt64LE(BigInt(solver.iteration), 16);
  buffer.writeBigUInt64LE(BigInt(solver.visitedNodes), 24);
  buffer.writeUInt32LE(solver.regrets.length, 32);
  buffer.writeUInt32LE(solver.strategySums.length, 36);
  buffer.writeUInt32LE(metadataBytes.length, 40);
  buffer.writeBigUInt64LE(BigInt(payloadBytes), 44);
  metadataBytes.copy(buffer, FIXED_HEADER_BYTES);
  writeFloat64Payload(buffer, headerBytes, solver.regrets);
  writeFloat64Payload(buffer, headerBytes + solver.regrets.byteLength, solver.strategySums);
  const payload = buffer.subarray(headerBytes);
  const checksum = sha256(payload);
  checksum.copy(buffer, 52);
  const semantic = semanticHash(metadata, solver.iteration, solver.visitedNodes, checksum);
  semantic.copy(buffer, 84);
  return {
    buffer,
    bytes: buffer.byteLength,
    serializationMs: performance.now() - started,
    temporaryBytes: buffer.byteLength,
    payloadChecksum: checksum.toString("hex"),
    semanticStateHash: semantic.toString("hex"),
    metadata,
  };
}

export function deserializeBinaryCheckpointV5(buffer: Buffer): DecodedBinaryCheckpointV5 {
  const started = performance.now();
  if (buffer.length < FIXED_HEADER_BYTES) throw new Error("Binary checkpoint is truncated before the fixed header.");
  if (buffer.toString("latin1", 0, 8) !== BINARY_CHECKPOINT_MAGIC) throw new Error("Binary checkpoint magic header mismatch.");
  const version = buffer.readUInt16LE(8);
  if (version !== BINARY_CHECKPOINT_VERSION) throw new Error(`Unsupported binary checkpoint version ${version}.`);
  if (buffer.readUInt8(10) !== 1) throw new Error("Unsupported binary checkpoint endianness.");
  const headerBytes = buffer.readUInt32LE(12);
  const iteration = safeIntegerFromBigInt(buffer.readBigUInt64LE(16), "Checkpoint iteration");
  const nodesVisited = safeIntegerFromBigInt(buffer.readBigUInt64LE(24), "Checkpoint node count");
  const regretCount = buffer.readUInt32LE(32);
  const strategyCount = buffer.readUInt32LE(36);
  const metadataLength = buffer.readUInt32LE(40);
  const payloadBytes = safeIntegerFromBigInt(buffer.readBigUInt64LE(44), "Checkpoint payload length");
  if (headerBytes !== FIXED_HEADER_BYTES + metadataLength) throw new Error("Binary checkpoint header length mismatch.");
  const expectedPayloadBytes = (regretCount + strategyCount) * 8;
  if (payloadBytes !== expectedPayloadBytes) throw new Error("Binary checkpoint array lengths do not match the payload length.");
  if (buffer.length !== headerBytes + payloadBytes) throw new Error("Binary checkpoint is truncated or contains trailing bytes.");
  let metadata: BinaryCheckpointMetadataV5;
  try {
    metadata = JSON.parse(buffer.toString("utf8", FIXED_HEADER_BYTES, headerBytes)) as BinaryCheckpointMetadataV5;
  } catch {
    throw new Error("Binary checkpoint metadata is invalid JSON.");
  }
  if (!metadata.gameHash || !metadata.configurationHash || !metadata.algorithmVersion || !metadata.structuralVersion) {
    throw new Error("Binary checkpoint metadata is incomplete.");
  }
  if (metadata.algorithmVersion !== COMPACT_CFR_VERSION) throw new Error("Binary checkpoint algorithm version mismatch.");
  if (metadata.structuralVersion !== COMPACT_TREE_VERSION) throw new Error("Binary checkpoint structural representation mismatch.");
  const checksumStarted = performance.now();
  const expectedChecksum = buffer.subarray(52, 84);
  const actualChecksum = sha256(buffer.subarray(headerBytes));
  if (!actualChecksum.equals(expectedChecksum)) throw new Error("Binary checkpoint payload checksum mismatch.");
  const expectedSemantic = buffer.subarray(84, 116);
  const actualSemantic = semanticHash(metadata, iteration, nodesVisited, actualChecksum);
  if (!actualSemantic.equals(expectedSemantic)) throw new Error("Binary checkpoint semantic state hash mismatch.");
  const checksumValidationMs = performance.now() - checksumStarted;
  const regrets = readFloat64Payload(buffer, headerBytes, regretCount, "Checkpoint regrets");
  const strategySums = readFloat64Payload(buffer, headerBytes + regretCount * 8, strategyCount, "Checkpoint strategy sums");
  return {
    version: 5,
    endianness: BINARY_CHECKPOINT_ENDIANNESS,
    iteration,
    nodesVisited,
    regrets,
    strategySums,
    metadata,
    payloadChecksum: actualChecksum.toString("hex"),
    semanticStateHash: actualSemantic.toString("hex"),
    bytes: buffer.byteLength,
    deserializationMs: performance.now() - started,
    checksumValidationMs,
  };
}

export function restoreBinaryCheckpointV5(solver: CompactCfrSolver, checkpoint: DecodedBinaryCheckpointV5) {
  if (checkpoint.metadata.gameId !== solver.tree.gameId || checkpoint.metadata.gameHash !== solver.tree.gameHash) {
    throw new Error("Binary checkpoint belongs to another game.");
  }
  if (checkpoint.metadata.configurationHash !== solver.configurationHash) throw new Error("Binary checkpoint configuration mismatch.");
  if (checkpoint.metadata.algorithm !== solver.configuration.algorithm) throw new Error("Binary checkpoint algorithm mismatch.");
  solver.restoreNumericState({
    iteration: checkpoint.iteration,
    nodesVisited: checkpoint.nodesVisited,
    regrets: checkpoint.regrets,
    strategySums: checkpoint.strategySums,
  });
}

async function exists(path: string) {
  try { await access(path); return true; } catch { return false; }
}

export type AtomicCheckpointWriteOptions = {
  simulateFailureAt?: "after-temp-validation" | "after-backup";
};

export async function writeBinaryCheckpointAtomic(
  target: string,
  serialized: SerializedBinaryCheckpointV5,
  options: AtomicCheckpointWriteOptions = {},
) {
  const directory = dirname(target);
  const temporary = join(directory, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const backup = `${target}.bak`;
  let movedExisting = false;
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(serialized.buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    deserializeBinaryCheckpointV5(await readFile(temporary));
    if (options.simulateFailureAt === "after-temp-validation") throw new Error("Simulated checkpoint interruption after temporary validation.");
    if (await exists(target)) {
      if (await exists(backup)) await unlink(backup);
      await rename(target, backup);
      movedExisting = true;
    }
    if (options.simulateFailureAt === "after-backup") throw new Error("Simulated checkpoint interruption after backup.");
    await rename(temporary, target);
    if (movedExisting && await exists(backup)) await unlink(backup);
    return { target, bytes: serialized.bytes, atomicRenameUsed: true, replacementWasRecoverable: movedExisting };
  } catch (error) {
    if (movedExisting && !await exists(target) && await exists(backup)) await rename(backup, target);
    if (await exists(temporary)) await unlink(temporary);
    throw error;
  }
}

export async function recoverAtomicCheckpoint(target: string) {
  const backup = `${target}.bak`;
  const directory = dirname(target);
  const prefix = `.${basename(target)}.`;
  if (!await exists(target) && await exists(backup)) await rename(backup, target);
  let valid = false;
  if (await exists(target)) {
    deserializeBinaryCheckpointV5(await readFile(target));
    valid = true;
  }
  const entries = await readdir(directory);
  await Promise.all(entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith(".tmp"))
    .map((entry) => unlink(join(directory, entry))));
  if (valid && await exists(backup)) await unlink(backup);
  return { recovered: valid, target };
}
