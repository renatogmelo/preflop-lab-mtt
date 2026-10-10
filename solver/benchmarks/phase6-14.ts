import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase614Research } from "../research/convergence/phase6-14-runner";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "solver/artifacts/phase6-14-convergence-v0.14.0.json");
const artifact = await runPhase614Research();
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ target, experiments: artifact.scheduler, gates: artifact.gates, independent: artifact.independentCrossChecks, resource: artifact.resourceMeasurements, artifactHash: artifact.artifactHash }, null, 2));
