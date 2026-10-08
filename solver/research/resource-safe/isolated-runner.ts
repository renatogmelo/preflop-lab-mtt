import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { hashValue } from "../../core/stable";
import { SyntheticCompactProvider } from "../compact/synthetic-compact-provider";
import type { IsolatedExperimentRequest, IsolatedExperimentResult, StageMetric, TerminationReason } from "./types";

const execFileAsync = promisify(execFile);
const protocolPrefix = "PHASE610:";

type OsMemorySample = { rss: number; peakRss: number };

async function sampleWindowsMemory(pid: number): Promise<OsMemorySample | null> {
  const powerShell = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  try {
    const command = `$p=Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Write($p.WorkingSet64.ToString() + ',' + $p.PeakWorkingSet64.ToString())`;
    const { stdout } = await execFileAsync(powerShell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      timeout: 2_000,
    });
    const [rss, peakRss] = stdout.trim().split(",").map(Number);
    return Number.isFinite(rss) && Number.isFinite(peakRss) ? { rss, peakRss } : null;
  } catch {
    return null;
  }
}

async function sampleLinuxMemory(pid: number): Promise<OsMemorySample | null> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] ?? 0) * 1024;
    const peakRss = Number(status.match(/^VmHWM:\s+(\d+)\s+kB$/m)?.[1] ?? 0) * 1024;
    return rss > 0 ? { rss, peakRss: Math.max(rss, peakRss) } : null;
  } catch {
    return null;
  }
}

async function sampleOsMemory(pid: number) {
  if (platform() === "win32") return sampleWindowsMemory(pid);
  if (platform() === "linux") return sampleLinuxMemory(pid);
  return null;
}

export async function runIsolatedExperiment(request: IsolatedExperimentRequest): Promise<IsolatedExperimentResult> {
  const childEntry = fileURLToPath(new URL("./experiment-child.ts", import.meta.url));
  const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64url");
  const maximumOldSpaceMiB = Math.max(64, Math.floor(request.limits.maximumRssBytes / 1024 / 1024 * 0.7));
  const configurationHash = hashValue(request.configuration ?? { kind: request.kind, fixtureAllocationBytes: request.fixtureAllocationBytes });
  const gameHash = request.configuration ? new SyntheticCompactProvider(request.configuration).logicalGameHash : null;
  const startTimestamp = new Date().toISOString();
  const started = performance.now();
  const child = spawn(process.execPath, [
    `--max-old-space-size=${maximumOldSpaceMiB}`,
    "--expose-gc",
    "--import",
    "tsx",
    childEntry,
    encoded,
  ], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  const stages: StageMetric[] = [];
  let result: Record<string, unknown> | null = null;
  let error: string | null = null;
  let lastContact = performance.now();
  let peakRssObserved = 0;
  let peakChildSelfReported = 0;
  let osSamples = 0;
  let watchdogTriggered = false;
  let forcedReason: TerminationReason | null = null;
  let stdoutBuffer = "";
  let stderr = "";
  let sampling = false;

  const terminate = (reason: TerminationReason) => {
    if (forcedReason) return;
    forcedReason = reason;
    watchdogTriggered = reason === "timeout" || reason === "memory-limit" || reason === "unresponsive";
    child.kill("SIGKILL");
  };

  const acceptMessage = (message: unknown) => {
    lastContact = performance.now();
    if (!message || typeof message !== "object" || !("type" in message)) return;
    const typed = message as { type: string; metric?: StageMetric; result?: Record<string, unknown>; error?: string; memory?: { rss?: number } };
    if (typed.type === "stage" && typed.metric) {
      stages.push(typed.metric);
      const rss = typed.metric.memory?.rss ?? 0;
      const peak = typed.metric.memory?.peakRssSelfReported ?? 0;
      peakChildSelfReported = Math.max(peakChildSelfReported, rss, peak);
    } else if (typed.type === "heartbeat") {
      peakChildSelfReported = Math.max(peakChildSelfReported, typed.memory?.rss ?? 0);
    } else if (typed.type === "result") {
      result = typed.result ?? null;
    } else if (typed.type === "error") {
      error = typed.error ?? "Unknown isolated child error.";
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith(protocolPrefix)) continue;
      try { acceptMessage(JSON.parse(line.slice(protocolPrefix.length))); } catch { error = "Invalid child protocol message."; }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

  const watchdog = setInterval(async () => {
    const now = performance.now();
    if (now - started > request.limits.maximumRuntimeMs) {
      terminate("timeout");
      return;
    }
    if (now - lastContact > request.limits.maximumIdleMs) {
      terminate("unresponsive");
      return;
    }
    if (!sampling && child.pid) {
      sampling = true;
      try {
        const sample = await sampleOsMemory(child.pid);
        if (sample) {
          osSamples += 1;
          peakRssObserved = Math.max(peakRssObserved, sample.rss, sample.peakRss);
          if (sample.rss > request.limits.maximumRssBytes) terminate("memory-limit");
        }
      } finally {
        sampling = false;
      }
    }
  }, Math.max(50, request.limits.sampleIntervalMs));

  const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", (spawnError) => {
      error = spawnError.message;
      resolve({ code: null, signal: null });
    });
  });
  clearInterval(watchdog);
  if (stdoutBuffer.startsWith(protocolPrefix)) {
    try { acceptMessage(JSON.parse(stdoutBuffer.slice(protocolPrefix.length))); } catch { /* ignore partial final line */ }
  }
  if (!error && stderr.trim()) error = stderr.trim();
  const terminationReason: TerminationReason = forcedReason
    ?? (closed.code === 0 && result ? "completed" : closed.code === 73 ? "child-crash" : error?.includes("STRUCTURAL_LIMIT:") ? "structural-limit" : error ? "fatal-error" : "child-crash");
  const peak = osSamples > 0 ? peakRssObserved : peakChildSelfReported;
  const finalResult = result as Record<string, unknown> | null;
  return {
    experimentId: request.experimentId,
    pid: child.pid ?? null,
    kind: request.kind,
    tier: request.tier,
    configurationHash,
    gameHash,
    startTimestamp,
    endTimestamp: new Date().toISOString(),
    runtimeMs: performance.now() - started,
    exitCode: closed.code,
    signal: closed.signal,
    terminationReason,
    watchdogTriggered,
    peakRssObservedBytes: peak > 0 ? peak : null,
    peakRssMeasurement: osSamples > 0 ? "os-sampled" : peakChildSelfReported > 0 ? "child-self-reported" : "unavailable",
    peakChildSelfReportedRssBytes: peakChildSelfReported,
    stages,
    result: finalResult,
    error,
    limits: request.limits,
    semanticResultHash: typeof finalResult?.semanticResultHash === "string" ? finalResult.semanticResultHash : null,
  };
}
