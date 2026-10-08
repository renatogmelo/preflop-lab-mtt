import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase610Research } from "../research/resource-safe/phase6-10-runner";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const previousPath = resolve(root, "solver/artifacts/phase6-9-compact-tree-v0.9.0.json");
const target = resolve(root, "solver/artifacts/phase6-10-resource-safe-v0.10.0.json");
const previous = JSON.parse(await readFile(previousPath, "utf8")) as Record<string, unknown>;
const artifact = await runPhase610Research(previous);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  target,
  verdict: artifact.verdict,
  gates: artifact.gates,
  calibration: artifact.policy.calibration,
  s5: {
    decision: artifact.s5Experiment.decision,
    runs: artifact.s5Experiment.runs.map((run) => ({
      pid: run.pid,
      reason: run.terminationReason,
      runtimeMs: run.runtimeMs,
      peakRssObservedBytes: run.peakRssObservedBytes,
      semanticResultHash: run.semanticResultHash,
    })),
  },
}, null, 2));
