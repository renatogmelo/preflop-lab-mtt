import { join } from "node:path";
import type { CompactCfrSolver } from "../compact/compact-cfr";
import { recoverLatestCheckpoint, type FaultInjector } from "./durable-checkpoint";
import { ReliabilityError } from "./errors";
import { moveRunState, persistRunManifest, readRunManifest } from "./manifest";
import { recoverStaleWriterLease } from "./stale-lock";

export async function recoverRunSafely(
  runDirectory: string,
  solver: CompactCfrSolver,
  options: { inject?: FaultInjector } = {},
) {
  const manifestPath = join(runDirectory, "manifest.json");
  const staleLock = await recoverStaleWriterLease(manifestPath);
  let manifest = await readRunManifest(manifestPath);
  if (manifest.status === "RUNNING" || manifest.status === "CHECKPOINTING") {
    manifest = moveRunState(manifest, "INTERRUPTED", "recovery-detected-interruption");
  }
  if (manifest.status === "INTERRUPTED") manifest = moveRunState(manifest, "RECOVERABLE", "checkpoint-candidates-discoverable");
  if (manifest.status === "RECOVERABLE") manifest = moveRunState(manifest, "RESUMING", "checkpoint-restore-started");
  if (manifest.status !== "RESUMING") {
    throw new ReliabilityError("RECOVERY_FAILED", "Run state is not eligible for recovery.", { runId: manifest.runId, status: manifest.status });
  }
  await persistRunManifest(manifestPath, manifest);
  const recovery = await recoverLatestCheckpoint(runDirectory, solver, options);
  manifest = moveRunState(recovery.manifest, "RUNNING", "checkpoint-restored");
  await persistRunManifest(manifestPath, manifest);
  return { ...recovery, manifest, staleLock };
}
