import { randomUUID } from "node:crypto";
import { open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CompactCfrSolver } from "../compact/compact-cfr";
import {
  deserializeBinaryCheckpointV5,
  restoreBinaryCheckpointV5,
  serializeBinaryCheckpointV5,
  type DecodedBinaryCheckpointV5,
} from "../resource-safe/binary-checkpoint-v5";
import { ReliabilityError, asReliabilityError } from "./errors";
import {
  acquireWriterLease,
  moveRunState,
  persistRunManifest,
  readRunManifest,
  updateRunManifest,
  type CheckpointGenerationRecord,
  type DurableRunManifest,
} from "./manifest";

export const CHECKPOINT_GENERATION_POLICY = {
  version: "checkpoint-generations-v1",
  retainValidGenerations: 2,
  filePattern: /^checkpoint\.g(\d{8})\.plcpv5$/,
} as const;

export type CheckpointFaultPoint =
  | "before-serialization"
  | "during-serialization"
  | "after-temp-write"
  | "before-rename"
  | "after-rename"
  | "before-manifest-update"
  | "after-manifest-update"
  | "during-restore";

export type FaultInjector = (point: CheckpointFaultPoint, context: Readonly<Record<string, unknown>>) => void | Promise<void>;

function generationName(generation: number) {
  return `checkpoint.g${String(generation).padStart(8, "0")}.plcpv5`;
}

async function syncWrite(path: string, bytes: Buffer) {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function compatibleWithManifest(checkpoint: DecodedBinaryCheckpointV5, manifest: DurableRunManifest) {
  if (checkpoint.metadata.algorithm !== manifest.algorithm) return "algorithm";
  if (checkpoint.metadata.algorithmVersion !== manifest.algorithmVersion) return "algorithm-version";
  if (checkpoint.metadata.gameHash !== manifest.providerIdentity) return "provider-identity";
  return null;
}

export async function commitCheckpointGeneration(
  runDirectory: string,
  solver: CompactCfrSolver,
  options: { inject?: FaultInjector; retain?: number } = {},
) {
  const manifestPath = join(runDirectory, "manifest.json");
  const lease = await acquireWriterLease(manifestPath);
  let temporary: string | null = null;
  try {
    let manifest = await readRunManifest(manifestPath);
    if (manifest.status !== "RUNNING") {
      throw new ReliabilityError("INVALID_TRANSITION", "Checkpoint commit requires a RUNNING manifest.", {
        runId: manifest.runId,
        status: manifest.status,
      });
    }
    manifest = moveRunState(manifest, "CHECKPOINTING", "checkpoint-started");
    await persistRunManifest(manifestPath, manifest);
    await options.inject?.("before-serialization", { runId: manifest.runId, iteration: solver.iteration });
    const serialized = serializeBinaryCheckpointV5(solver);
    await options.inject?.("during-serialization", { runId: manifest.runId, bytes: serialized.bytes });
    const generation = Math.max(0, ...manifest.checkpointGenerations.map((entry) => entry.generation)) + 1;
    const file = generationName(generation);
    const target = join(runDirectory, file);
    temporary = join(runDirectory, `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    await syncWrite(temporary, serialized.buffer);
    const validated = deserializeBinaryCheckpointV5(await readFile(temporary));
    if (validated.semanticStateHash !== serialized.semanticStateHash || validated.iteration !== solver.iteration) {
      throw new ReliabilityError("CHECKPOINT_CORRUPTED", "Temporary checkpoint failed post-write validation.", {
        runId: manifest.runId,
        generation,
      });
    }
    await options.inject?.("after-temp-write", { runId: manifest.runId, temporary, generation });
    await options.inject?.("before-rename", { runId: manifest.runId, target, generation });
    await rename(temporary, target);
    temporary = null;
    await options.inject?.("after-rename", { runId: manifest.runId, target, generation });
    const record: CheckpointGenerationRecord = {
      generation,
      file,
      iteration: validated.iteration,
      bytes: serialized.bytes,
      payloadChecksum: validated.payloadChecksum,
      semanticStateHash: validated.semanticStateHash,
      committedAt: new Date().toISOString(),
    };
    await options.inject?.("before-manifest-update", { runId: manifest.runId, generation });
    manifest = updateRunManifest(manifest, (draft) => {
      draft.checkpointGenerations.push(record);
      draft.checkpointGenerations.sort((left, right) => left.generation - right.generation);
      draft.lastKnownValidCheckpoint = record;
      draft.lastCommittedIteration = record.iteration;
    });
    manifest = moveRunState(manifest, "RUNNING", "checkpoint-committed");
    await persistRunManifest(manifestPath, manifest);
    await options.inject?.("after-manifest-update", { runId: manifest.runId, generation });

    const retain = Math.max(2, options.retain ?? CHECKPOINT_GENERATION_POLICY.retainValidGenerations);
    const obsolete = manifest.checkpointGenerations.slice(0, -retain);
    for (const entry of obsolete) await rm(join(runDirectory, entry.file), { force: true });
    if (obsolete.length) {
      manifest = updateRunManifest(manifest, (draft) => {
        const removed = new Set(obsolete.map((entry) => entry.generation));
        draft.checkpointGenerations = draft.checkpointGenerations.filter((entry) => !removed.has(entry.generation));
      });
      await persistRunManifest(manifestPath, manifest);
    }
    return { record, manifest, atomicRenameUsed: true, fileSyncUsed: true, directorySyncGuaranteed: false };
  } catch (error) {
    throw asReliabilityError(error, "RECOVERY_FAILED", { runDirectory });
  } finally {
    if (temporary) await rm(temporary, { force: true });
    await lease.release();
  }
}

export type RecoveryCandidateFailure = {
  file: string;
  code: "CHECKPOINT_CORRUPTED" | "CHECKPOINT_INCOMPATIBLE";
  reason: string;
};

export async function discoverCheckpointCandidates(runDirectory: string, manifest: DurableRunManifest) {
  const entries = await readdir(runDirectory);
  const valid: Array<{ generation: number; file: string; checkpoint: DecodedBinaryCheckpointV5; bytes: number }> = [];
  const failures: RecoveryCandidateFailure[] = [];
  for (const file of entries) {
    const match = CHECKPOINT_GENERATION_POLICY.filePattern.exec(file);
    if (!match) continue;
    try {
      const bytes = await readFile(join(runDirectory, file));
      const checkpoint = deserializeBinaryCheckpointV5(bytes);
      const incompatibility = compatibleWithManifest(checkpoint, manifest);
      if (incompatibility) {
        failures.push({ file, code: "CHECKPOINT_INCOMPATIBLE", reason: incompatibility });
        continue;
      }
      valid.push({ generation: Number(match[1]), file, checkpoint, bytes: bytes.length });
    } catch (error) {
      failures.push({
        file,
        code: "CHECKPOINT_CORRUPTED",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  valid.sort((left, right) => right.checkpoint.iteration - left.checkpoint.iteration || right.generation - left.generation);
  return { valid, failures };
}

export async function recoverLatestCheckpoint(
  runDirectory: string,
  solver: CompactCfrSolver,
  options: { inject?: FaultInjector } = {},
) {
  const manifestPath = join(runDirectory, "manifest.json");
  const lease = await acquireWriterLease(manifestPath);
  try {
    let manifest = await readRunManifest(manifestPath);
    const discovered = await discoverCheckpointCandidates(runDirectory, manifest);
    const selected = discovered.valid[0];
    if (!selected) {
      throw new ReliabilityError("CHECKPOINT_NOT_FOUND", "No valid compatible checkpoint generation was found.", {
        runId: manifest.runId,
        failures: discovered.failures,
      });
    }
    await options.inject?.("during-restore", { runId: manifest.runId, generation: selected.generation });
    try {
      restoreBinaryCheckpointV5(solver, selected.checkpoint);
    } catch (error) {
      throw new ReliabilityError("CHECKPOINT_INCOMPATIBLE", "Selected checkpoint could not be restored.", {
        runId: manifest.runId,
        generation: selected.generation,
      }, { cause: error });
    }
    const newestGeneration = Math.max(0, ...discovered.valid.map((candidate) => candidate.generation), ...discovered.failures.map((failure) => Number(CHECKPOINT_GENERATION_POLICY.filePattern.exec(failure.file)?.[1] ?? 0)));
    const fallbackUsed = selected.generation < newestGeneration;
    const record: CheckpointGenerationRecord = {
      generation: selected.generation,
      file: selected.file,
      iteration: selected.checkpoint.iteration,
      bytes: selected.bytes,
      payloadChecksum: selected.checkpoint.payloadChecksum,
      semanticStateHash: selected.checkpoint.semanticStateHash,
      committedAt: manifest.checkpointGenerations.find((entry) => entry.generation === selected.generation)?.committedAt ?? new Date().toISOString(),
    };
    manifest = updateRunManifest(manifest, (draft) => {
      draft.lastKnownValidCheckpoint = record;
      draft.lastCommittedIteration = record.iteration;
      draft.recoveryAttempts.push({
        at: new Date().toISOString(),
        selectedGeneration: selected.generation,
        fallbackUsed,
        result: "recovered",
        details: discovered.failures.length ? `${discovered.failures.length} candidate(s) rejected.` : "latest generation valid",
      });
    });
    await persistRunManifest(manifestPath, manifest);
    return { selected: record, fallbackUsed, rejected: discovered.failures, manifest, stateHash: solver.stateHash };
  } finally {
    await lease.release();
  }
}

export async function checkpointFilesystemState(runDirectory: string) {
  const entries = await readdir(runDirectory);
  const files = await Promise.all(entries.map(async (file) => ({ file, bytes: (await stat(join(runDirectory, file))).size })));
  return files.sort((left, right) => left.file.localeCompare(right.file));
}
