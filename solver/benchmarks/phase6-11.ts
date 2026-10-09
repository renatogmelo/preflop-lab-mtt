import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase611Research } from "../research/fast-compiler/phase6-11-runner";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const previousPath = resolve(root, "solver/artifacts/phase6-10-resource-safe-v0.10.0.json");
const target = resolve(root, "solver/artifacts/phase6-11-fast-compiler-v0.11.0.json");
const previous = JSON.parse(await readFile(previousPath, "utf8")) as Record<string, unknown>;
const artifact = await runPhase611Research(previous);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ target, verdict: artifact.verdict, gates: artifact.gates, runCount: artifact.runCount, completedRuns: artifact.completedRuns, totalRuntimeMs: artifact.totalRuntimeMs }, null, 2));