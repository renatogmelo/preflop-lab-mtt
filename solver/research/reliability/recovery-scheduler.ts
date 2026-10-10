import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ReliabilityError } from "./errors";
import { acquireWriterLease, readRunManifest, type DurableRunManifest } from "./manifest";

export const RECOVERABLE_RUN_STATES = new Set(["RUNNING", "CHECKPOINTING", "INTERRUPTED", "RECOVERABLE", "RESUMING"]);

export type DiscoveredRun = {
  directory: string;
  manifest: DurableRunManifest;
  eligible: boolean;
  reason: string;
};

export async function discoverRuns(root: string): Promise<{ runs: DiscoveredRun[]; invalid: Array<{ directory: string; error: string }> }> {
  const entries = await readdir(root, { withFileTypes: true });
  const runs: DiscoveredRun[] = [];
  const invalid: Array<{ directory: string; error: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    try {
      const manifest = await readRunManifest(join(directory, "manifest.json"));
      const eligible = RECOVERABLE_RUN_STATES.has(manifest.status) && manifest.recoveryAttempts.length < 3;
      runs.push({ directory, manifest, eligible, reason: eligible ? "recoverable-state" : manifest.recoveryAttempts.length >= 3 ? "retry-limit" : "terminal-state" });
    } catch (error) {
      invalid.push({ directory, error: error instanceof Error ? error.message : String(error) });
    }
  }
  runs.sort((left, right) => left.manifest.runId.localeCompare(right.manifest.runId));
  return { runs, invalid };
}

export class RecoveryScheduler {
  constructor(readonly retryLimit = 3) {
    if (!Number.isInteger(retryLimit) || retryLimit < 1) throw new Error("Retry limit must be a positive integer.");
  }

  async resume(root: string, executor: (run: DiscoveredRun) => Promise<{ status: "completed" | "resumed"; details: string }>) {
    const discovered = await discoverRuns(root);
    const results: Array<{ runId: string; status: string; details: string }> = [];
    for (const run of discovered.runs) {
      if (!RECOVERABLE_RUN_STATES.has(run.manifest.status)) {
        results.push({ runId: run.manifest.runId, status: "skipped", details: "terminal-state" });
        continue;
      }
      if (run.manifest.recoveryAttempts.length >= this.retryLimit) {
        results.push({ runId: run.manifest.runId, status: "failed", details: "retry-limit" });
        continue;
      }
      let lease;
      try {
        lease = await acquireWriterLease(join(run.directory, "scheduler"), `scheduler:${process.pid}`);
      } catch (error) {
        if (error instanceof ReliabilityError && error.code === "CONCURRENT_WRITER") {
          results.push({ runId: run.manifest.runId, status: "duplicate-prevented", details: error.code });
          continue;
        }
        throw error;
      }
      try {
        const result = await executor(run);
        results.push({ runId: run.manifest.runId, status: result.status, details: result.details });
      } catch (error) {
        results.push({ runId: run.manifest.runId, status: "failed", details: error instanceof Error ? error.message : String(error) });
      } finally {
        await lease.release();
      }
    }
    return { discovered: discovered.runs.length, invalid: discovered.invalid, results };
  }
}
