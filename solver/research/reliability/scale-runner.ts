import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const prefix = "PHASE615SCALE:";

export type IrregularScaleConfiguration = {
  label: string;
  id: string;
  seed: number;
  maximumDepth: number;
  maximumBranching: number;
  maximumNodes: number;
  expectedApproximateNodes: number;
  preflight: "ALLOW" | "DENY";
  preflightReason: string;
};

export const IRREGULAR_SCALE_MATRIX: readonly IrregularScaleConfiguration[] = [
  { label: "~40k", id: "phase615-irregular-40k", seed: 61508, maximumDepth: 10, maximumBranching: 5, maximumNodes: 60_000, expectedApproximateNodes: 39_317, preflight: "ALLOW", preflightReason: "below-250k-tier0-node-budget" },
  { label: "~100k", id: "phase615-irregular-100k", seed: 61508, maximumDepth: 11, maximumBranching: 5, maximumNodes: 140_000, expectedApproximateNodes: 104_681, preflight: "ALLOW", preflightReason: "below-250k-tier0-node-budget" },
  { label: "~250k", id: "phase615-irregular-250k", seed: 61504, maximumDepth: 11, maximumBranching: 6, maximumNodes: 260_000, expectedApproximateNodes: 232_333, preflight: "ALLOW", preflightReason: "below-250k-tier0-node-budget" },
  { label: "~500k", id: "phase615-irregular-500k", seed: 61506, maximumDepth: 11, maximumBranching: 6, maximumNodes: 550_000, expectedApproximateNodes: 515_520, preflight: "ALLOW", preflightReason: "explicit-tier1-controlled-single-compile" },
  { label: "~1m", id: "phase615-irregular-1m", seed: 61503, maximumDepth: 12, maximumBranching: 6, maximumNodes: 1_100_000, expectedApproximateNodes: 1_070_770, preflight: "DENY", preflightReason: "projected-memory-too-close-to-768MiB-policy-cap" },
];

export async function runIrregularScale(configuration: IrregularScaleConfiguration, timeoutMs = 30_000) {
  if (configuration.preflight === "DENY") return { label: configuration.label, status: "preflight-denied" as const, reason: configuration.preflightReason, expectedApproximateNodes: configuration.expectedApproximateNodes };
  const entry = fileURLToPath(new URL("./scale-child.ts", import.meta.url));
  const payload = Buffer.from(JSON.stringify(configuration), "utf8").toString("base64url");
  const child = spawn(process.execPath, ["--max-old-space-size=704", "--import", "tsx", entry, payload], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const watchdog = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
  const closed = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(watchdog));
  const message = stdout.split(/\r?\n/).find((line) => line.startsWith(prefix));
  return {
    label: configuration.label,
    status: timedOut ? "timeout" as const : message ? "completed" as const : "process-failed" as const,
    ...closed,
    result: message ? JSON.parse(message.slice(prefix.length)) as Record<string, unknown> : null,
    stderr,
  };
}
