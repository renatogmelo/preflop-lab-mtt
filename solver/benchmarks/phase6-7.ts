import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase67Research } from "../research/comparison/experiment-runner";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "solver/artifacts/phase6-7-unified-research-v0.7.0.json");
const artifact = runPhase67Research();
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ target, gates: artifact.gates, games: artifact.games.map((game) => ({ id: game.game.id, exploitability: game.unified.final.exploitability, nashConv: game.unified.final.nashConv })) }, null, 2));
