import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase69Research } from "../research/compact/experiment-runner";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "solver/artifacts/phase6-9-compact-tree-v0.9.0.json");
const artifact = runPhase69Research();
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  target,
  gates: artifact.gates,
  scales: artifact.scales.map((entry) => ({ level: entry.level, status: entry.status })),
  s4Iterations: artifact.s4Convergence.executed ? artifact.s4Convergence.completedIterations : 0,
  s5: artifact.s5Experiment.status,
  runtimeMs: artifact.totalRuntimeMs,
}, null, 2));
