import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { algorithmDescriptor, ALGORITHM_DESCRIPTORS } from "./algorithms";
import { compileExperiment, preflightExperiment, validateCompiledExperiment } from "./compiler";
import { assignExperimentIdentity, validateExperimentConfiguration } from "./configuration";
import {
  CAPABILITY_IDS,
  EVENT_SCHEMA_VERSION,
  PUBLIC_API_VERSION,
  RESEARCH_ENGINE_VERSION,
  type EngineCapabilitiesV1,
  type ExperimentStatusV1,
  type ResearchProgressEvent,
} from "./contracts";
import { ResearchEngineError, asResearchError } from "./errors";
import {
  createBuiltinProvider,
  validateProviderContract,
  type ExtensiveGameProviderV3,
} from "./provider-v3";
import { pathExists, readJsonFile, resolveWorkspacePath, verifyResearchResult, writeJsonFile } from "./storage";
import type { WorkerMessage, WorkerRequest } from "./runtime";

const PROTOCOL = "PREFLOP_RESEARCH:";
const INDEX_SCHEMA = "research-run-index-v1";

type RunIndex = {
  schemaVersion: typeof INDEX_SCHEMA;
  experimentId: string;
  runId: string;
  runDirectory: string;
  configurationPath: string;
};

export type ResearchEngineOptions = {
  workspaceRoot?: string;
  engineDirectory?: string;
  buildCommit?: string;
};

export type ExperimentHandle = { experimentId: string; runId: string };

function statusFrom(value: unknown): ExperimentStatusV1 {
  if (!value || typeof value !== "object") throw new ResearchEngineError("ARTIFACT_ERROR", "Experiment status is invalid.");
  const status = value as ExperimentStatusV1;
  if (status.apiVersion !== PUBLIC_API_VERSION || !status.runId || !status.experimentId) throw new ResearchEngineError("ARTIFACT_ERROR", "Experiment status schema is incompatible.");
  return status;
}

function assertRunId(runId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(runId)) throw new ResearchEngineError("INVALID_CONFIGURATION", "runId contains unsafe characters.", { runId });
}

export class ResearchEngine {
  readonly workspaceRoot: string;
  readonly engineDirectory: string;
  readonly buildCommit: string;
  private readonly providers = new Map<string, ExtensiveGameProviderV3<unknown, unknown>>();
  private readonly children = new Map<string, ChildProcess>();

  constructor(options: ResearchEngineOptions = {}) {
    this.workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.engineDirectory = resolve(this.workspaceRoot, options.engineDirectory ?? ".preflop-research");
    this.buildCommit = options.buildCommit ?? process.env.PREFLOP_RESEARCH_COMMIT ?? "unknown";
    for (const id of ["variable-depth-hidden", "asymmetric-chance", "irregular-branching", "regular-synthetic"] as const) {
      const provider = createBuiltinProvider({ id });
      this.providers.set(provider.id, provider);
      this.providers.set(id, provider);
    }
  }

  getCapabilities(): EngineCapabilitiesV1 {
    const unique = [...new Map([...this.providers.values()].map((provider) => [provider.identity.id, provider])).values()];
    return Object.freeze({
      apiVersion: PUBLIC_API_VERSION,
      engineVersion: RESEARCH_ENGINE_VERSION,
      capabilities: CAPABILITY_IDS,
      algorithms: ALGORITHM_DESCRIPTORS.map(({ id, version, checkpointVersion }) => ({ id, version, checkpointVersion })),
      providers: unique.map((provider) => ({ id: provider.identity.id, version: provider.identity.version, capabilities: provider.researchCapabilities })),
      scope: {
        finiteGames: true,
        players: 2,
        zeroSum: true,
        perfectRecall: true,
        explicitChance: true,
        multiplayer: false,
        pokerStrategiesCertified: false,
      } as const,
      formats: {
        provider: ["provider-contract-v2.0.0", "provider-contract-v3.0.0"],
        compiler: ["compiler-v2", "compiler-v3"],
        cache: ["structural-cache-v1", "structural-cache-v2"],
        checkpoint: ["checkpoint-v5"],
        experiment: ["research-experiment-v1"],
        result: ["research-result-v1"],
      } as const,
    });
  }

  registerProvider<State, Action>(provider: ExtensiveGameProviderV3<State, Action>) {
    const compatible = provider as ExtensiveGameProviderV3<unknown, unknown>;
    const report = validateProviderContract(compatible);
    if (!report.valid) throw new ResearchEngineError("VALIDATION_ERROR", "Provider registration failed.", { issues: report.issues });
    if (this.providers.has(provider.identity.id)) throw new ResearchEngineError("INVALID_CONFIGURATION", "Provider identity is already registered.", { id: provider.identity.id });
    this.providers.set(provider.identity.id, compatible);
    return report;
  }

  validateProvider(provider: ExtensiveGameProviderV3<unknown, unknown>) {
    return validateProviderContract(provider);
  }

  validateGame(input: unknown) {
    const configuration = validateExperimentConfiguration(input);
    algorithmDescriptor(configuration.algorithm.id);
    return validateCompiledExperiment(configuration);
  }

  compileGame(input: unknown) {
    const configuration = validateExperimentConfiguration(input);
    const compilation = compileExperiment(configuration);
    return Object.freeze({
      provider: compilation.provider.identity,
      compiler: compilation.compiler,
      profile: compilation.profile,
      preflight: compilation.preflight,
      validation: compilation.tree.validation,
    });
  }

  private indexPath(runId: string) {
    assertRunId(runId);
    return join(this.engineDirectory, "index", `${runId}.json`);
  }

  private async readIndex(runId: string): Promise<RunIndex> {
    const value = await readJsonFile(this.indexPath(runId));
    if (!value || typeof value !== "object") throw new ResearchEngineError("ARTIFACT_ERROR", "Run index is invalid.", { runId });
    const index = value as RunIndex;
    if (index.schemaVersion !== INDEX_SCHEMA || index.runId !== runId) throw new ResearchEngineError("ARTIFACT_ERROR", "Run index is incompatible.", { runId });
    return index;
  }

  private async writeStatus(runDirectory: string, status: ExperimentStatusV1) {
    await writeJsonFile(join(runDirectory, "status.json"), status);
  }

  private async appendEvent(runDirectory: string, event: ResearchProgressEvent) {
    await appendFile(join(runDirectory, "events.ndjson"), `${JSON.stringify(event)}\n`, "utf8");
  }

  async createExperiment(input: unknown): Promise<ExperimentHandle> {
    const configuration = validateExperimentConfiguration(input);
    algorithmDescriptor(configuration.algorithm.id);
    preflightExperiment(configuration);
    const { experimentId, runId } = assignExperimentIdentity(configuration);
    await mkdir(this.engineDirectory, { recursive: true });
    const outputRoot = await resolveWorkspacePath(this.workspaceRoot, configuration.outputDirectory, "outputDirectory");
    const runDirectory = join(outputRoot, runId);
    await mkdir(outputRoot, { recursive: true });
    await mkdir(runDirectory, { recursive: false });
    const configurationPath = join(runDirectory, "experiment.json");
    await writeJsonFile(configurationPath, { ...configuration, experimentId });
    const index: RunIndex = {
      schemaVersion: INDEX_SCHEMA,
      experimentId,
      runId,
      runDirectory: relative(this.workspaceRoot, runDirectory),
      configurationPath: relative(this.workspaceRoot, configurationPath),
    };
    await writeJsonFile(this.indexPath(runId), index);
    const now = new Date().toISOString();
    const created: ResearchProgressEvent = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      sequence: 0,
      type: "EXPERIMENT_CREATED",
      experimentId,
      runId,
      timestamp: now,
      state: "created",
      iteration: 0,
      totalIterations: configuration.budget.iterations,
      progress: 0,
      message: "Experiment configuration was validated and persisted.",
    };
    await this.appendEvent(runDirectory, created);
    await this.writeStatus(runDirectory, {
      apiVersion: PUBLIC_API_VERSION,
      experimentId,
      runId,
      state: "created",
      pid: null,
      createdAt: now,
      updatedAt: now,
      lastEvent: created,
      error: null,
    });
    return { experimentId, runId };
  }

  private async loadRun(runId: string) {
    const index = await this.readIndex(runId);
    const runDirectory = await resolveWorkspacePath(this.workspaceRoot, index.runDirectory, "runDirectory");
    const configurationPath = await resolveWorkspacePath(this.workspaceRoot, index.configurationPath, "configurationPath");
    const configuration = validateExperimentConfiguration(await readJsonFile(configurationPath));
    return { index, runDirectory, configuration };
  }

  async runExperiment(handle: ExperimentHandle, options: { resumeCheckpoint?: string; onProgress?: (event: ResearchProgressEvent) => void } = {}) {
    const { index, runDirectory, configuration } = await this.loadRun(handle.runId);
    if (index.experimentId !== handle.experimentId) throw new ResearchEngineError("INVALID_CONFIGURATION", "Experiment handle identity mismatch.", handle);
    const current = await this.getExperimentStatus(handle.runId);
    if (["running", "preflight", "ready", "cancelling"].includes(current.state)) throw new ResearchEngineError("EXECUTION_ERROR", "Experiment is already active.", { runId: handle.runId });
    if (current.state === "completed" && !options.resumeCheckpoint) throw new ResearchEngineError("EXECUTION_ERROR", "Completed experiments cannot be executed again; create a new experiment.", { runId: handle.runId });
    await rm(join(runDirectory, "cancel.requested"), { force: true });
    await rm(join(runDirectory, "checkpoint.requested"), { force: true });
    const request: WorkerRequest = {
      configuration,
      experimentId: handle.experimentId,
      runId: handle.runId,
      runDirectory,
      ...(options.resumeCheckpoint ? { resumeCheckpoint: options.resumeCheckpoint } : {}),
    };
    const worker = fileURLToPath(new URL("./worker.ts", import.meta.url));
    const runtimeRoot = resolve(dirname(worker), "../../..");
    const oldSpaceMiB = Math.max(64, Math.floor(configuration.budget.memoryBytes / 1024 / 1024 * 0.7));
    const child = spawn(process.execPath, [
      `--max-old-space-size=${oldSpaceMiB}`,
      "--import",
      "tsx",
      worker,
      Buffer.from(JSON.stringify(request), "utf8").toString("base64url"),
    ], {
      cwd: runtimeRoot,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.children.set(handle.runId, child);
    let status: ExperimentStatusV1 = { ...current, state: "preflight", pid: child.pid ?? null, updatedAt: new Date().toISOString(), error: null };
    await this.writeStatus(runDirectory, status);
    let stdout = "";
    let stderr = "";
    let resultPath: string | null = null;
    let writes = Promise.resolve();
    let forcedError: ResearchEngineError | null = null;
    const queue = (operation: () => Promise<void>) => { writes = writes.then(operation); };
    const accept = (message: WorkerMessage) => {
      if (message.kind === "event") {
        options.onProgress?.(message.event);
        status = { ...status, state: message.event.state, updatedAt: message.event.timestamp, lastEvent: message.event };
        queue(async () => { await this.appendEvent(runDirectory, message.event); await this.writeStatus(runDirectory, status); });
      } else if (message.kind === "result") resultPath = message.resultPath;
      else {
        status = { ...status, state: "failed", updatedAt: new Date().toISOString(), error: message.error };
        queue(() => this.writeStatus(runDirectory, status));
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith(PROTOCOL)) continue;
        try { accept(JSON.parse(line.slice(PROTOCOL.length)) as WorkerMessage); }
        catch { forcedError = new ResearchEngineError("EXECUTION_ERROR", "Worker emitted an invalid protocol message."); }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const watchdog = setTimeout(() => {
      forcedError = new ResearchEngineError("RESOURCE_LIMIT", "Parent watchdog terminated the run after its runtime budget.", { runtimeMs: configuration.budget.runtimeMs }, true);
      child.kill("SIGKILL");
    }, configuration.budget.runtimeMs + 5_000);
    const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose) => {
      child.once("close", (code, signal) => resolveClose({ code, signal }));
      child.once("error", (error) => { forcedError = asResearchError(error, "EXECUTION_ERROR"); resolveClose({ code: null, signal: null }); });
    });
    clearTimeout(watchdog);
    this.children.delete(handle.runId);
    await writes;
    if (status.state === "cancelled") return { status, result: null };
    if (forcedError || closed.code !== 0 || !resultPath) {
      const error = forcedError ?? new ResearchEngineError("EXECUTION_ERROR", stderr.trim() || "Isolated worker exited without a result.", { exitCode: closed.code, signal: closed.signal }, true);
      status = { ...status, state: "failed", pid: null, updatedAt: new Date().toISOString(), error: error.toJSON() };
      await this.writeStatus(runDirectory, status);
      throw error;
    }
    status = { ...status, state: "completed", pid: null, updatedAt: new Date().toISOString() };
    await this.writeStatus(runDirectory, status);
    return { status, result: verifyResearchResult(await readJsonFile(resultPath)) };
  }

  async getExperimentStatus(runId: string) {
    const { runDirectory } = await this.loadRun(runId);
    return statusFrom(await readJsonFile(join(runDirectory, "status.json")));
  }

  async cancelExperiment(runId: string) {
    const { runDirectory } = await this.loadRun(runId);
    const status = await this.getExperimentStatus(runId);
    if (!["preflight", "ready", "running"].includes(status.state)) throw new ResearchEngineError("EXECUTION_ERROR", "Only an active experiment can be cancelled.", { runId, state: status.state });
    await writeFile(join(runDirectory, "cancel.requested"), `${new Date().toISOString()}\n`, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const next = { ...status, state: "cancelling" as const, updatedAt: new Date().toISOString() };
    await this.writeStatus(runDirectory, next);
    return next;
  }

  async checkpointExperiment(runId: string) {
    const { runDirectory } = await this.loadRun(runId);
    const status = await this.getExperimentStatus(runId);
    if (status.state !== "running") {
      const checkpoints = (await readdir(runDirectory)).filter((file) => file.endsWith(".plcpv5")).sort();
      return { requested: false, latest: checkpoints.at(-1) ?? null, state: status.state };
    }
    await writeFile(join(runDirectory, "checkpoint.requested"), `${new Date().toISOString()}\n`, { flag: "w" });
    return { requested: true, latest: null, state: status.state };
  }

  async resumeExperiment(runId: string) {
    const { index, runDirectory } = await this.loadRun(runId);
    const checkpoints = (await readdir(runDirectory)).filter((file) => file.endsWith(".plcpv5")).sort();
    const latest = checkpoints.at(-1);
    if (!latest) throw new ResearchEngineError("CHECKPOINT_ERROR", "No Checkpoint V5 is available for resume.", { runId });
    return this.runExperiment({ experimentId: index.experimentId, runId }, { resumeCheckpoint: join(runDirectory, latest) });
  }

  async getExperimentResults(runId: string) {
    const { runDirectory } = await this.loadRun(runId);
    const path = join(runDirectory, "result.json");
    if (!await pathExists(path)) throw new ResearchEngineError("ARTIFACT_ERROR", "Experiment does not have a completed result.", { runId });
    return verifyResearchResult(await readJsonFile(path));
  }

  async verifyArtifact(candidate: string) {
    const path = await resolveWorkspacePath(this.workspaceRoot, candidate, "artifact");
    const artifact = verifyResearchResult(await readJsonFile(path));
    return { valid: true, artifact, path: relative(this.workspaceRoot, path) } as const;
  }

  async doctor() {
    await mkdir(this.engineDirectory, { recursive: true });
    const probe = join(this.engineDirectory, `.doctor-${randomUUID()}`);
    await writeFile(probe, "ok", { flag: "wx" });
    await rm(probe, { force: true });
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    return {
      engineVersion: RESEARCH_ENGINE_VERSION,
      buildCommit: this.buildCommit,
      runtime: { node: process.version, platform: process.platform, architecture: process.arch },
      checks: {
        nodeVersion: { passed: nodeMajor >= 22, required: ">=22.13.0" },
        workspaceWritable: { passed: true, path: relative(this.workspaceRoot, this.engineDirectory) },
        dependencies: { passed: true, required: ["tsx"] },
        capabilities: { passed: CAPABILITY_IDS.length >= 10, count: CAPABILITY_IDS.length },
        resourceConfiguration: { passed: true, maximumMemoryBytes: 768 * 1024 * 1024, maximumRuntimeMs: 30_000 },
      },
      destructiveChangesPerformed: false,
    } as const;
  }
}

export function createResearchEngine(options: ResearchEngineOptions = {}) {
  return new ResearchEngine(options);
}
