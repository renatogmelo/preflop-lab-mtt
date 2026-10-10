import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AlgorithmName } from "../../core/types";
import type { CheckpointFaultPoint } from "./durable-checkpoint";

const prefix = "PHASE615:";

export async function runFaultChildV2(input: {
  runDirectory: string;
  algorithm: AlgorithmName;
  checkpointIteration: number;
  faultPoint: CheckpointFaultPoint | "external-kill" | "watchdog-timeout";
  watchdogMs?: number;
}) {
  const entry = fileURLToPath(new URL("./fault-child-v2.ts", import.meta.url));
  const payload = Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
  const child = spawn(process.execPath, ["--import", "tsx", entry, payload], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  let stdout = "";
  let stderr = "";
  let externallyTerminated = false;
  let watchdogTriggered = false;
  let killed = false;
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    if (!killed && input.faultPoint === "external-kill" && stdout.includes('"type":"ready"')) {
      killed = true;
      externallyTerminated = true;
      child.kill("SIGKILL");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const watchdog = setTimeout(() => {
    watchdogTriggered = true;
    killed = true;
    child.kill("SIGKILL");
  }, input.watchdogMs ?? (input.faultPoint === "watchdog-timeout" ? 150 : 3_000));
  const closed = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(watchdog));
  const messages = stdout.split(/\r?\n/).filter((line) => line.startsWith(prefix)).map((line) => JSON.parse(line.slice(prefix.length)) as Record<string, unknown>);
  return { faultPoint: input.faultPoint, pid: child.pid ?? null, ...closed, externallyTerminated, watchdogTriggered, messages, stderr };
}
