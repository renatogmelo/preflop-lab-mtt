import { Worker } from "node:worker_threads";
import type { IsolatedExperimentRequest } from "./types";

const prefix = "PHASE610:";
const send = (value: unknown) => process.stdout.write(`${prefix}${JSON.stringify(value)}\n`);
const encoded = process.argv.at(-1);
if (!encoded) throw new Error("Missing isolated experiment request.");
const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as IsolatedExperimentRequest;

send({ type: "ready", pid: process.pid, timestamp: new Date().toISOString() });

if (request.kind === "crash-fixture") process.exit(73);
if (request.kind === "hang-fixture") {
  while (true) Math.sqrt(144);
}

const heartbeat = setInterval(() => send({ type: "heartbeat", timestamp: new Date().toISOString(), memory: process.memoryUsage() }), 100);
const worker = new Worker(new URL("./experiment-worker.ts", import.meta.url), { workerData: request });
let finishing = false;
worker.on("message", (message: unknown) => {
  send(message);
  if (message && typeof message === "object" && "type" in message) {
    const type = (message as { type: string }).type;
    if (type === "result") {
      finishing = true;
      clearInterval(heartbeat);
      worker.terminate().finally(() => process.exit(0));
    } else if (type === "error") {
      finishing = true;
      clearInterval(heartbeat);
      worker.terminate().finally(() => process.exit(70));
    }
  }
});
worker.on("error", (error) => {
  send({ type: "error", error: error.stack ?? error.message });
  clearInterval(heartbeat);
  process.exit(71);
});
worker.on("exit", (code) => {
  if (!finishing && code !== 0) {
    send({ type: "error", error: `Experiment worker exited with code ${code}.` });
    clearInterval(heartbeat);
    process.exit(72);
  }
});
