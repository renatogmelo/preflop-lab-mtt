import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const prefix = "PHASE615LOCK:";

function spawnLockChild(target: string, owner: string, holdMs: number) {
  const entry = fileURLToPath(new URL("./lock-child.ts", import.meta.url));
  const payload = Buffer.from(JSON.stringify({ target, owner, holdMs }), "utf8").toString("base64url");
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
  const completion = new Promise<{ exitCode: number | null; messages: Array<Record<string, unknown>>; stderr: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({
      exitCode,
      messages: stdout.split(/\r?\n/).filter((line) => line.startsWith(prefix)).map((line) => JSON.parse(line.slice(prefix.length)) as Record<string, unknown>),
      stderr,
    }));
  });
  return { child, completion, hasAcquired: () => stdout.includes('"status":"acquired"') };
}

export async function runConcurrentWriterProbe(target: string) {
  const first = spawnLockChild(target, "writer-a", 350);
  const started = Date.now();
  while (!first.hasAcquired()) {
    if (Date.now() - started > 2_000) throw new Error("First writer did not acquire lock in time.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const second = spawnLockChild(target, "writer-b", 0);
  const [left, right] = await Promise.all([first.completion, second.completion]);
  return { first: left, second: right, conflictDetected: right.messages.some((message) => message.status === "rejected" && message.code === "CONCURRENT_WRITER") };
}
