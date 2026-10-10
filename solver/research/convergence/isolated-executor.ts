import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  ConvergenceExperimentConfiguration,
  ConvergenceExperimentResult,
} from "./types";

const prefix = "PHASE614:";

export async function runIsolatedConvergenceExperiment(
  configuration: ConvergenceExperimentConfiguration,
  signal: AbortSignal,
): Promise<ConvergenceExperimentResult> {
  const childEntry = fileURLToPath(
    new URL("./experiment-child.ts", import.meta.url),
  );
  const payload = Buffer.from(JSON.stringify(configuration), "utf8").toString(
    "base64url",
  );
  const maximumOldSpaceMiB = Math.max(
    64,
    Math.floor(
      (configuration.resourceBudget.maximumRssBytes / 1024 / 1024) * 0.7,
    ),
  );
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${maximumOldSpaceMiB}`,
      "--import",
      "tsx",
      childEntry,
      payload,
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    },
  );
  let stdout = "";
  let stderr = "";
  let forced: "timeout" | "cancelled" | null = null;
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const timeout = setTimeout(() => {
    forced = "timeout";
    child.kill("SIGKILL");
  }, configuration.resourceBudget.maximumRuntimeMs + 2_000);
  const abort = () => {
    forced = "cancelled";
    child.kill("SIGKILL");
  };
  signal.addEventListener("abort", abort, { once: true });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  });
  const messages = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map(
      (line) =>
        JSON.parse(line.slice(prefix.length)) as {
          type: string;
          result?: ConvergenceExperimentResult;
          error?: string;
        },
    );
  const final = messages.at(-1);
  if (final?.type === "result" && final.result) return final.result;
  if (forced === "cancelled")
    throw new Error(
      `Experiment ${configuration.experimentId} cancelled by scheduler.`,
    );
  if (forced === "timeout")
    throw new Error(
      `Experiment ${configuration.experimentId} exceeded isolated watchdog.`,
    );
  throw new Error(
    final?.error ??
      stderr.trim() ??
      `Experiment child exited with code ${exitCode}.`,
  );
}
