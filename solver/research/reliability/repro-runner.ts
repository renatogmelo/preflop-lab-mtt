import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AlgorithmName } from "../../core/types";

const prefix = "PHASE615REPRO:";

async function one(algorithm: AlgorithmName, iterations: number) {
  const entry = fileURLToPath(new URL("./repro-child.ts", import.meta.url));
  const payload = Buffer.from(JSON.stringify({ algorithm, iterations }), "utf8").toString("base64url");
  const child = spawn(process.execPath, ["--import", "tsx", entry, payload], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const line = stdout.split(/\r?\n/).find((entryLine) => entryLine.startsWith(prefix));
  if (!line) throw new Error(stderr || `Reproducibility child exited ${exitCode}.`);
  return JSON.parse(line.slice(prefix.length)) as Record<string, unknown>;
}

export async function runCrossProcessReproducibility(algorithm: AlgorithmName, iterations: number) {
  const [left, right] = await Promise.all([one(algorithm, iterations), one(algorithm, iterations)]);
  return { left, right, bitExact: JSON.stringify(left) === JSON.stringify(right) };
}
