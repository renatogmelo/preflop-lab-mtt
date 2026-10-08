import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase68Research } from "../research/scalability/experiment-runner";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "solver/artifacts/phase6-8-unified-scalability-v0.8.0.json");
const artifact = runPhase68Research();
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ target, gates: artifact.gates, largestCompletedLevel: artifact.largestCompletedLevel, scales: artifact.scales.map((scale) => ({ level: scale.level, status: scale.status, nodes: scale.estimate.nodes })) }, null, 2));
