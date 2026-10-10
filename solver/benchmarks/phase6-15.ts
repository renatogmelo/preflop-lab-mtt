import { resolve } from "node:path";
import { runPhase615 } from "../research/reliability/phase6-15-runner";

const target = resolve("solver/artifacts/phase6-15-reliability-v0.15.0.json");
const artifact = await runPhase615(target);
process.stdout.write(`${JSON.stringify({ target, contentChecksum: artifact.contentChecksum, gates: artifact.gateMatrix, recoveryResults: artifact.recoveryResults }, null, 2)}\n`);
