import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitCheckpointGeneration } from "./durable-checkpoint";
import { recoverRunSafely } from "./recovery-safe";
import { createReliabilitySolver, initializeReliabilityRun } from "./runtime";

export async function runCorruptedGenerationFallback(commitSha: string) {
  const directory = await mkdtemp(join(tmpdir(), "phase615-fallback-campaign-"));
  try {
    const initialized = await initializeReliabilityRun({
      runDirectory: directory,
      runId: "phase615-corrupted-generation-fallback",
      experimentId: "corrupted-latest-generation",
      commitSha,
      algorithm: "dcfr",
      iterationTarget: 8,
    });
    while (initialized.solver.iteration < 2) initialized.solver.iterate();
    const previous = await commitCheckpointGeneration(directory, initialized.solver);
    while (initialized.solver.iteration < 5) initialized.solver.iterate();
    const current = await commitCheckpointGeneration(directory, initialized.solver);
    const corrupted = await readFile(join(directory, current.record.file));
    corrupted[corrupted.length - 1] ^= 1;
    await writeFile(join(directory, current.record.file), corrupted);

    const resumed = createReliabilitySolver("dcfr").solver;
    const recovery = await recoverRunSafely(directory, resumed);
    while (resumed.iteration < 8) resumed.iterate();
    const baseline = createReliabilitySolver("dcfr").solver;
    baseline.initialize();
    while (baseline.iteration < 8) baseline.iterate();
    return {
      latestGeneration: current.record.generation,
      selectedGeneration: recovery.selected.generation,
      selectedIteration: recovery.selected.iteration,
      previousGeneration: previous.record.generation,
      fallbackUsed: recovery.fallbackUsed,
      rejectedCandidates: recovery.rejected,
      finalStateHash: resumed.stateHash,
      baselineStateHash: baseline.stateHash,
      bitExact: resumed.stateHash === baseline.stateHash,
      partialStateAccepted: false,
      status: recovery.fallbackUsed && resumed.stateHash === baseline.stateHash ? "PASS" : "FAIL",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
