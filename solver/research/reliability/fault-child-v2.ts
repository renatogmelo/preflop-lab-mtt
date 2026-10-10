import type { AlgorithmName } from "../../core/types";
import { commitCheckpointGeneration, type CheckpointFaultPoint } from "./durable-checkpoint";
import { recoverRunSafely } from "./recovery-safe";
import { createReliabilitySolver } from "./runtime";

type Payload = {
  runDirectory: string;
  algorithm: AlgorithmName;
  checkpointIteration: number;
  faultPoint: CheckpointFaultPoint | "external-kill" | "watchdog-timeout";
};

const prefix = "PHASE615:";
const encoded = process.argv[2];
if (!encoded) throw new Error("Missing Phase 6.15 fault payload.");
const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Payload;
const { solver } = createReliabilitySolver(payload.algorithm);
await recoverRunSafely(payload.runDirectory, solver);
while (solver.iteration < payload.checkpointIteration) solver.iterate();

if (payload.faultPoint === "external-kill" || payload.faultPoint === "watchdog-timeout") {
  process.stdout.write(`${prefix}${JSON.stringify({ type: "ready", pid: process.pid, iteration: solver.iteration })}\n`);
  setInterval(() => process.stdout.write(`${prefix}${JSON.stringify({ type: "heartbeat", pid: process.pid })}\n`), 25);
  await new Promise(() => undefined);
} else {
  await commitCheckpointGeneration(payload.runDirectory, solver, {
    inject: async (point) => {
      if (point !== payload.faultPoint) return;
      process.stdout.write(`${prefix}${JSON.stringify({ type: "injected", pid: process.pid, point, iteration: solver.iteration })}\n`);
      process.kill(process.pid, "SIGKILL");
      await new Promise(() => undefined);
    },
  });
}
