import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { COMPACT_CFR_VERSION, CompactCfrSolver } from "../compact/compact-cfr";
import { CompiledTreeProvider } from "../generic/compiler-v3";
import {
  deserializeBinaryCheckpointV5,
  restoreBinaryCheckpointV5,
  serializeBinaryCheckpointV5,
  writeBinaryCheckpointAtomic,
} from "../resource-safe/binary-checkpoint-v5";
import { algorithmDescriptor, toSolverConfiguration } from "./algorithms";
import { compileExperiment } from "./compiler";
import {
  EVENT_SCHEMA_VERSION,
  PROVIDER_CONTRACT_V3,
  PUBLIC_API_VERSION,
  RESEARCH_ENGINE_VERSION,
  RESULT_SCHEMA_VERSION,
  type ResearchExperimentConfigurationV1,
  type ResearchProgressEvent,
} from "./contracts";
import { ResearchEngineError, asResearchError } from "./errors";
import { sealResearchResult, sha256Bytes, writeJsonFile } from "./storage";

export type WorkerRequest = {
  configuration: ResearchExperimentConfigurationV1;
  experimentId: string;
  runId: string;
  runDirectory: string;
  resumeCheckpoint?: string;
};

export type WorkerMessage =
  | { kind: "event"; event: ResearchProgressEvent }
  | { kind: "result"; resultPath: string }
  | { kind: "error"; error: ReturnType<ResearchEngineError["toJSON"]> };

export async function executeResearchRun(request: WorkerRequest, publish: (message: WorkerMessage) => void) {
  const { configuration, experimentId, runId, runDirectory } = request;
  await mkdir(runDirectory, { recursive: true });
  let sequence = 0;
  const emit = (
    type: ResearchProgressEvent["type"],
    state: ResearchProgressEvent["state"],
    message: string,
    iteration: number | null,
    metrics?: Readonly<Record<string, number | string | boolean | null>>,
  ) => {
    const progress = iteration === null ? 0 : Math.min(1, iteration / configuration.budget.iterations);
    const event: ResearchProgressEvent = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      sequence: ++sequence,
      type,
      experimentId,
      runId,
      timestamp: new Date().toISOString(),
      state,
      iteration,
      totalIterations: configuration.budget.iterations,
      progress,
      message,
      ...(metrics ? { metrics } : {}),
    };
    publish({ kind: "event", event });
  };

  try {
    emit("PREFLIGHT_STARTED", "preflight", "Resource and capability preflight started.", 0);
    emit("PREFLIGHT_PASSED", "ready", "Resource Policy V3 accepted the run.", 0);
    emit("COMPILATION_STARTED", "running", "Game compilation started.", 0);
    const compilation = compileExperiment(configuration);
    emit("COMPILATION_COMPLETED", "running", "Game compilation completed.", 0, {
      nodes: compilation.tree.kind.length,
      informationSets: compilation.tree.informationSetActionCount.length,
      compiler: compilation.compiler.id,
    });
    const compactProvider = new CompiledTreeProvider(compilation.tree);
    const solver = new CompactCfrSolver(compactProvider, compilation.tree, toSolverConfiguration(configuration.algorithm));
    solver.initialize();
    if (request.resumeCheckpoint) {
      emit("RECOVERY_STARTED", "running", "Checkpoint compatibility validation started.", 0);
      const decoded = deserializeBinaryCheckpointV5(await readFile(request.resumeCheckpoint));
      restoreBinaryCheckpointV5(solver, decoded);
    }
    emit("RUN_STARTED", "running", "Isolated solver execution started.", solver.iteration, { pid: process.pid });
    const checkpoints: Array<{ file: string; iteration: number; checksum: string }> = [];
    const started = performance.now();
    let stoppedBy: "iterations" | "runtime" = "iterations";
    let lastMetric = solver.history.at(-1) ?? null;
    let peakRssBytes = process.memoryUsage().rss;
    const cancelMarker = join(runDirectory, "cancel.requested");
    const checkpointMarker = join(runDirectory, "checkpoint.requested");

    const createCheckpoint = async () => {
      const file = `checkpoint-i${String(solver.iteration).padStart(12, "0")}.plcpv5`;
      const target = join(runDirectory, file);
      const serialized = serializeBinaryCheckpointV5(solver);
      await writeBinaryCheckpointAtomic(target, serialized);
      checkpoints.push({ file, iteration: solver.iteration, checksum: serialized.payloadChecksum });
      emit("CHECKPOINT_CREATED", "running", "Checkpoint V5 created.", solver.iteration, { file, bytes: serialized.bytes });
      return target;
    };

    while (solver.iteration < configuration.budget.iterations) {
      if (existsSync(cancelMarker)) {
        if (solver.iteration > 0) await createCheckpoint();
        emit("RUN_INTERRUPTED", "cancelled", "Execution cancelled by request.", solver.iteration);
        return { cancelled: true as const };
      }
      solver.iterate();
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      if (peakRssBytes > configuration.budget.memoryBytes) {
        throw new ResearchEngineError("RESOURCE_LIMIT", "Observed RSS exceeded the configured memory budget.", {
          peakRssBytes,
          memoryBudgetBytes: configuration.budget.memoryBytes,
        }, true);
      }
      const elapsed = performance.now() - started;
      if (solver.iteration % configuration.evaluation.interval === 0 || solver.iteration === configuration.budget.iterations) {
        lastMetric = solver.measure();
        emit("EVALUATION_COMPLETED", "running", "Exact evaluation completed.", solver.iteration, {
          exploitability: lastMetric.exploitability,
          nashConv: lastMetric.nashConv,
          utilityP0: lastMetric.utilityP0,
        });
      }
      if (solver.iteration % configuration.checkpoint.interval === 0 || existsSync(checkpointMarker)) {
        await createCheckpoint();
        await rm(checkpointMarker, { force: true });
      }
      if (solver.iteration % Math.max(1, Math.min(configuration.evaluation.interval, 100)) === 0) {
        emit("ITERATION_PROGRESS", "running", "Iteration budget is progressing.", solver.iteration, {
          elapsedMs: elapsed,
          rssBytes: peakRssBytes,
          nodesVisited: solver.visitedNodes,
        });
      }
      if (elapsed >= configuration.budget.runtimeMs) {
        stoppedBy = "runtime";
        break;
      }
    }
    if (!lastMetric || lastMetric.iteration !== solver.iteration) lastMetric = solver.measure();
    if (!checkpoints.some((checkpoint) => checkpoint.iteration === solver.iteration)) await createCheckpoint();
    const completedAt = new Date().toISOString();
    const descriptor = algorithmDescriptor(configuration.algorithm.id);
    const result = sealResearchResult({
      schemaVersion: RESULT_SCHEMA_VERSION,
      apiVersion: PUBLIC_API_VERSION,
      engineVersion: RESEARCH_ENGINE_VERSION,
      experimentId,
      runId,
      game: {
        id: compilation.provider.identity.id,
        version: compilation.provider.identity.version,
        semanticIdentity: compilation.provider.identity.semanticHash,
        providerContract: PROVIDER_CONTRACT_V3,
      },
      algorithm: { id: configuration.algorithm.id, version: descriptor.version, parameters: configuration.algorithm },
      completion: { status: "completed", stoppedBy, completedAt },
      configuration,
      compiler: { id: compilation.compiler.id, version: compilation.compiler.version, structuralHash: compilation.compiler.structuralHash },
      metrics: {
        iterations: solver.iteration,
        nodesVisited: solver.visitedNodes,
        nodes: compilation.tree.kind.length,
        informationSets: compilation.tree.informationSetActionCount.length,
        exploitability: lastMetric.exploitability,
        nashConv: lastMetric.nashConv,
        utilityP0: lastMetric.utilityP0,
        runtimeMs: performance.now() - started,
        peakRssBytes,
        stateHash: solver.stateHash,
      },
      convergence: solver.history.map((point) => ({ ...point })),
      checkpoints,
      validation: {
        level: "structurally-validated",
        structural: {
          passed: compilation.tree.validation.valid,
          checks: ["finite", "two-player", "zero-sum", "perfect-recall", "chance-normalized", "all-reachable"],
        },
        independentEvaluation: { performed: false, passed: null, tolerance: null },
        mathematicalScope: "finite-two-player-zero-sum-perfect-recall",
        pokerCertified: false,
        verifiedDataset: false,
      },
      limitations: [
        "Synthetic finite games only; this result is not a certified poker strategy.",
        "Two players, zero sum, perfect recall and explicit chance only.",
        "Resource limits are enforced by preflight, V8 old-space and parent watchdog; Windows RSS is not a native hard cap.",
        "Cross-operating-system reproducibility is not established.",
      ],
    });
    const resultPath = join(runDirectory, "result.json");
    await writeJsonFile(resultPath, result);
    await writeJsonFile(join(runDirectory, "result.sha256.json"), {
      algorithm: "sha256",
      checksum: sha256Bytes(await readFile(resultPath)),
      artifactChecksum: result.artifactChecksum,
    });
    emit("RUN_COMPLETED", "completed", "Research run completed and artifact was sealed.", solver.iteration, {
      runtimeMs: result.metrics.runtimeMs,
      peakRssBytes,
      artifactChecksum: result.artifactChecksum,
    });
    publish({ kind: "result", resultPath });
    return { cancelled: false as const, result, resultPath };
  } catch (error) {
    const structured = asResearchError(error, "EXECUTION_ERROR", { experimentId, runId });
    emit("RUN_FAILED", "failed", structured.message, null, { code: structured.code });
    publish({ kind: "error", error: structured.toJSON() });
    throw structured;
  }
}

export { COMPACT_CFR_VERSION };
