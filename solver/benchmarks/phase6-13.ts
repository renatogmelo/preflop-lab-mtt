import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase613Research } from "../research/mathematical/phase6-13-runner";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "solver/artifacts/phase6-13-mathematical-verification-v0.13.0.json");
const artifact = await runPhase613Research();
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ target, gates: artifact.gates, maximumDeltas: artifact.maximumDeltas, artifactHash: artifact.artifactHash }, null, 2));
