import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase612Research } from "../research/generic/phase6-12-runner";
import type { ResourceCalibration } from "../research/resource-safe/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const previous = JSON.parse(await readFile(resolve(root, "solver/artifacts/phase6-11-fast-compiler-v0.11.0.json"), "utf8")) as Record<string, unknown>;
const phase610 = JSON.parse(await readFile(resolve(root, "solver/artifacts/phase6-10-resource-safe-v0.10.0.json"), "utf8")) as { policy: { calibration: ResourceCalibration } };
const target = resolve(root, "solver/artifacts/phase6-12-generic-compiler-v0.12.0.json");
const artifact = await runPhase612Research(previous, phase610.policy.calibration);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ target, verdict: artifact.verdict, gates: artifact.gates, runCount: artifact.runCount, completedRuns: artifact.completedRuns, totalRuntimeMs: artifact.totalRuntimeMs, artifactHash: artifact.artifactHash }, null, 2));
