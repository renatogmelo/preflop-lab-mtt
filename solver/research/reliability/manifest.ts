import { randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { hashValue, stableStringify } from "../../core/stable";
import type { RunState, RunTransition } from "./state-machine";
import { initialTransition, transitionRun } from "./state-machine";
import { ReliabilityError, asReliabilityError } from "./errors";

export const RUN_MANIFEST_SCHEMA = "phase6.15-run-manifest-v1";

export type CheckpointGenerationRecord = {
  generation: number;
  file: string;
  iteration: number;
  bytes: number;
  payloadChecksum: string;
  semanticStateHash: string;
  committedAt: string;
};

export type FailureRecord = {
  code: string;
  at: string;
  message: string;
  recoverable: boolean;
  context: Readonly<Record<string, unknown>>;
};

export type RecoveryAttempt = {
  at: string;
  selectedGeneration: number | null;
  fallbackUsed: boolean;
  result: "recovered" | "failed";
  details: string;
};

export type DurableRunManifest = {
  schemaVersion: typeof RUN_MANIFEST_SCHEMA;
  revision: number;
  runId: string;
  experimentId: string;
  commitSha: string;
  algorithm: string;
  algorithmVersion: string;
  algorithmParameters: unknown;
  providerIdentity: string;
  structuralHash: string;
  cacheVersion: string;
  checkpointVersion: 5;
  iterationTarget: number;
  lastCommittedIteration: number;
  status: RunState;
  resourceBudgets: Readonly<Record<string, number>>;
  environment: Readonly<Record<string, string | number | boolean | null>>;
  lastKnownValidCheckpoint: CheckpointGenerationRecord | null;
  checkpointGenerations: CheckpointGenerationRecord[];
  failureHistory: FailureRecord[];
  recoveryAttempts: RecoveryAttempt[];
  transitions: RunTransition[];
  createdAt: string;
  updatedAt: string;
  contentChecksum: string;
};

export type CreateRunManifestInput = Omit<
  DurableRunManifest,
  | "schemaVersion"
  | "revision"
  | "lastCommittedIteration"
  | "status"
  | "lastKnownValidCheckpoint"
  | "checkpointGenerations"
  | "failureHistory"
  | "recoveryAttempts"
  | "transitions"
  | "createdAt"
  | "updatedAt"
  | "contentChecksum"
>;

function checksumManifest(manifest: Omit<DurableRunManifest, "contentChecksum">) {
  return hashValue(manifest);
}

function sealManifest(manifest: Omit<DurableRunManifest, "contentChecksum">): DurableRunManifest {
  return { ...manifest, contentChecksum: checksumManifest(manifest) };
}

export function createRunManifest(input: CreateRunManifestInput, at = new Date().toISOString()) {
  const transition = initialTransition(input.runId, at);
  return sealManifest({
    schemaVersion: RUN_MANIFEST_SCHEMA,
    revision: 0,
    ...input,
    lastCommittedIteration: 0,
    status: "CREATED",
    lastKnownValidCheckpoint: null,
    checkpointGenerations: [],
    failureHistory: [],
    recoveryAttempts: [],
    transitions: [transition],
    createdAt: at,
    updatedAt: at,
  });
}

export function validateRunManifest(value: unknown): DurableRunManifest {
  if (!value || typeof value !== "object") throw new ReliabilityError("MANIFEST_INVALID", "Run manifest is not an object.");
  const manifest = value as DurableRunManifest;
  if (manifest.schemaVersion !== RUN_MANIFEST_SCHEMA || !manifest.runId || !Array.isArray(manifest.transitions)) {
    throw new ReliabilityError("MANIFEST_INVALID", "Run manifest schema or required fields are invalid.", { runId: manifest.runId });
  }
  const { contentChecksum, ...unsigned } = manifest;
  if (checksumManifest(unsigned) !== contentChecksum) {
    throw new ReliabilityError("MANIFEST_INVALID", "Run manifest checksum mismatch.", { runId: manifest.runId });
  }
  if (manifest.transitions.at(-1)?.to !== manifest.status) {
    throw new ReliabilityError("MANIFEST_INVALID", "Run manifest status does not match its transition log.", { runId: manifest.runId });
  }
  return manifest;
}

export function updateRunManifest(
  manifest: DurableRunManifest,
  updater: (draft: DurableRunManifest) => void,
  at = new Date().toISOString(),
) {
  validateRunManifest(manifest);
  const draft = structuredClone(manifest);
  updater(draft);
  draft.revision += 1;
  draft.updatedAt = at;
  const unsigned = structuredClone(draft);
  delete (unsigned as Partial<DurableRunManifest>).contentChecksum;
  return sealManifest(unsigned);
}

export function moveRunState(manifest: DurableRunManifest, to: RunState, reason: string, at = new Date().toISOString()) {
  return updateRunManifest(manifest, (draft) => {
    const transition = transitionRun(draft.runId, draft.status, to, draft.transitions, reason, at);
    draft.status = to;
    draft.transitions.push(transition);
  }, at);
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeJsonAtomic(target: string, value: unknown) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const bytes = Buffer.from(`${stableStringify(value)}\n`, "utf8");
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { target, bytes: bytes.length, atomicRenameUsed: true, directorySyncGuaranteed: false };
}

export async function readRunManifest(path: string) {
  try {
    return validateRunManifest(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    throw asReliabilityError(error, "MANIFEST_INVALID", { path });
  }
}

export async function persistRunManifest(path: string, manifest: DurableRunManifest) {
  validateRunManifest(manifest);
  return writeJsonAtomic(path, manifest);
}

export type WriterLease = { lockPath: string; owner: string; release: () => Promise<void> };

export async function acquireWriterLease(target: string, owner = `${process.pid}:${randomUUID()}`): Promise<WriterLease> {
  const lockPath = `${target}.writer-lock`;
  try {
    await mkdir(lockPath);
    await writeJsonAtomic(join(lockPath, "owner.json"), { owner, pid: process.pid, createdAt: new Date().toISOString() });
  } catch (error) {
    throw new ReliabilityError("CONCURRENT_WRITER", `Another writer owns ${target}.`, { target, lockPath, owner }, { cause: error });
  }
  let released = false;
  return {
    lockPath,
    owner,
    release: async () => {
      if (released) return;
      released = true;
      if (await pathExists(lockPath)) await rm(lockPath, { recursive: true, force: true });
    },
  };
}
