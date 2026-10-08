import { cpus, platform, release, totalmem } from "node:os";
import { hashValue } from "../../core/stable";
import type { SolverConfiguration } from "../../core/types";
import { SOLVER_VERSION } from "../../core/version";
import { SCALE_CONFIGURATIONS } from "../scalability/experiment-runner";
import { estimateSyntheticGame } from "../scalability/tree-size-estimator";
import { runIsolatedExperiment } from "./isolated-runner";
import {
  calibrateResourcePolicy,
  estimateResourcesV3,
  preflightV3,
  RESOURCE_POLICY_V3_LIMITS,
  RESOURCE_POLICY_V3_VERSION,
} from "./resource-policy-v3";
import type {
  CalibrationRun,
  IsolatedExperimentRequest,
  IsolatedExperimentResult,
  ResourceCalibration,
  ResourceLimits,
} from "./types";

export const PHASE_610_BASELINE = "fdc8e9dd6c0628bd9281bb78cf1574208e5eb764";
export const PHASE_610_RESEARCH_VERSION = "0.10.0";

const solverConfiguration: SolverConfiguration = {
  algorithm: "dcfr",
  seed: 610,
  exactMetrics: false,
  engine: "indexed-tree",
  dcfr: { alpha: 2, beta: 0, gamma: 3 },
};

const productionLimits: ResourceLimits = {
  maximumRssBytes: RESOURCE_POLICY_V3_LIMITS.maximumMemoryBytes,
  maximumRuntimeMs: RESOURCE_POLICY_V3_LIMITS.maximumRuntimeMs,
  maximumIdleMs: 5_000,
  maximumIterations: 1,
  sampleIntervalMs: 500,
};

function profileRequest(
  experimentId: string,
  scale: (typeof SCALE_CONFIGURATIONS)[number],
  tier: "tier0" | "tier2",
  calibration: ResourceCalibration | null,
): IsolatedExperimentRequest {
  const preflight = preflightV3({
    configuration: scale.configuration,
    tier,
    iterations: 1,
    explicitLargeScaleAuthorization: tier === "tier2",
    calibration,
  });
  return {
    experimentId,
    kind: "profile",
    configuration: scale.configuration,
    solverConfiguration,
    iterations: 1,
    evaluate: true,
    checkpoint: true,
    tier,
    explicitLargeScaleAuthorization: tier === "tier2",
    limits: productionLimits,
    preflight,
  };
}

function fixtureRequest(
  experimentId: string,
  kind: IsolatedExperimentRequest["kind"],
  limits: Partial<ResourceLimits>,
  fixtureAllocationBytes?: number,
): IsolatedExperimentRequest {
  return {
    experimentId,
    kind,
    iterations: 0,
    evaluate: false,
    checkpoint: false,
    tier: "tier0",
    explicitLargeScaleAuthorization: false,
    limits: { ...productionLimits, maximumIterations: 0, ...limits },
    fixtureAllocationBytes,
  };
}

function firstChildRss(result: IsolatedExperimentResult) {
  const snapshots = result.result?.snapshots;
  if (Array.isArray(snapshots)) {
    const first = snapshots[0];
    if (first && typeof first === "object" && typeof (first as { rss?: unknown }).rss === "number") {
      return (first as { rss: number }).rss;
    }
  }
  return Math.min(result.peakChildSelfReportedRssBytes, result.peakRssObservedBytes ?? Number.POSITIVE_INFINITY);
}

function checkpointSummary(result: IsolatedExperimentResult | undefined) {
  const checkpoint = result?.result?.checkpoint;
  if (!checkpoint || typeof checkpoint !== "object") return null;
  return checkpoint as Record<string, unknown>;
}

function stageRuntime(result: IsolatedExperimentResult | undefined, stage: string) {
  return result?.stages.find((entry) => entry.stage === stage && entry.status === "completed")?.runtimeMs ?? null;
}

async function runFailureRecovery() {
  const crash = await runIsolatedExperiment(fixtureRequest("phase610-failure-crash", "crash-fixture", {
    maximumRuntimeMs: 5_000,
  }));
  const timeout = await runIsolatedExperiment(fixtureRequest("phase610-failure-timeout", "timeout-fixture", {
    maximumRuntimeMs: 500,
    maximumIdleMs: 2_000,
    sampleIntervalMs: 100,
  }));
  const unresponsive = await runIsolatedExperiment(fixtureRequest("phase610-failure-unresponsive", "hang-fixture", {
    maximumRuntimeMs: 5_000,
    maximumIdleMs: 400,
    sampleIntervalMs: 100,
  }));
  const memory = await runIsolatedExperiment(fixtureRequest(
    "phase610-failure-memory",
    "memory-fixture",
    { maximumRssBytes: 120 * 1024 * 1024, maximumRuntimeMs: 8_000, sampleIntervalMs: 100 },
    256 * 1024 * 1024,
  ));
  return {
    crash,
    timeout,
    unresponsive,
    memory,
    expectedReasons: {
      crash: crash.terminationReason === "child-crash",
      timeout: timeout.terminationReason === "timeout" && timeout.watchdogTriggered,
      unresponsive: unresponsive.terminationReason === "unresponsive" && unresponsive.watchdogTriggered,
      memory: memory.terminationReason === "memory-limit" && memory.watchdogTriggered,
    },
  };
}

export async function runPhase610Research(previousPhase69: Record<string, unknown>) {
  const startedAt = new Date().toISOString();
  const failureRecovery = await runFailureRecovery();
  const watchdogValidated = Object.values(failureRecovery.expectedReasons).every(Boolean);
  const profileScales = SCALE_CONFIGURATIONS.filter((entry) => ["S2", "S3", "S4"].includes(entry.level));
  const isolatedProfiles: Array<{ scale: string; repetition: number; estimate: ReturnType<typeof estimateResourcesV3>; run: IsolatedExperimentResult }> = [];
  for (const scale of profileScales) {
    for (let repetition = 1; repetition <= 2; repetition += 1) {
      const request = profileRequest(`phase610-${scale.level.toLowerCase()}-r${repetition}`, scale, "tier0", null);
      const run = await runIsolatedExperiment(request);
      isolatedProfiles.push({ scale: scale.level, repetition, estimate: request.preflight!.estimate, run });
    }
  }

  const isolationValidated = isolatedProfiles.every(({ run }) => (
    run.terminationReason === "completed"
    && run.pid !== null
    && run.pid !== process.pid
    && Math.max(run.peakRssObservedBytes ?? 0, run.peakChildSelfReportedRssBytes) > 0
  )) && isolatedProfiles.some(({ scale, run }) => scale === "S4" && run.peakRssMeasurement === "os-sampled");
  const calibrationRuns: CalibrationRun[] = isolatedProfiles.map(({ scale, estimate, run }) => ({
    scale,
    nodes: estimate.nodes,
    estimatedPeakBytes: estimate.estimatedPeakBytes,
    logicalVariablePeakBytes: estimate.logicalPeakBytes,
    observedPeakBytes: Math.max(run.peakRssObservedBytes ?? 0, run.peakChildSelfReportedRssBytes),
    baselineRssBytes: firstChildRss(run),
    runtimeMs: run.runtimeMs,
    estimatedRuntimeMs: estimate.estimatedRuntimeMs,
    completed: run.terminationReason === "completed",
  }));
  const calibration = calibrateResourcePolicy(calibrationRuns, { isolationValidated, watchdogValidated });

  const s5 = SCALE_CONFIGURATIONS.find((entry) => entry.level === "S5")!;
  const s5Logical = estimateSyntheticGame(s5.configuration);
  const s5Preflight = preflightV3({
    configuration: s5.configuration,
    tier: "tier2",
    iterations: 1,
    explicitLargeScaleAuthorization: true,
    calibration,
  });
  const s5Runs: IsolatedExperimentResult[] = [];
  let s5Decision = s5Preflight.decision === "ALLOW" ? "EXECUTE" : "SAFE_ABORT";
  if (s5Preflight.decision === "ALLOW") {
    const first = await runIsolatedExperiment(profileRequest("phase610-s5-r1", s5, "tier2", calibration));
    s5Runs.push(first);
    const repeatSafe = first.terminationReason === "completed"
      && first.runtimeMs < productionLimits.maximumRuntimeMs * 0.7
      && Math.max(first.peakRssObservedBytes ?? 0, first.peakChildSelfReportedRssBytes) < productionLimits.maximumRssBytes * 0.7;
    if (repeatSafe) s5Runs.push(await runIsolatedExperiment(profileRequest("phase610-s5-r2", s5, "tier2", calibration)));
    else s5Decision = first.terminationReason === "completed" ? "EXECUTED_NO_SAFE_REPEAT" : "EXECUTION_FAILED_SAFE";
  }

  const s4Runs = isolatedProfiles.filter((entry) => entry.scale === "S4").map((entry) => entry.run);
  const s4Checkpoint = checkpointSummary(s4Runs[0]);
  const s5Completed = s5Runs.length > 0 && s5Runs.every((run) => run.terminationReason === "completed");
  const s5Deterministic = s5Runs.length >= 2
    ? s5Runs.every((run) => run.semanticResultHash === s5Runs[0].semanticResultHash)
    : null;
  const s5SubtreeValid = s5Runs.length > 0 && s5Runs.every((run) => {
    const validation = run.result?.subtreeValidation;
    return Boolean(validation && typeof validation === "object" && (validation as { valid?: boolean }).valid);
  });
  const s5WithinLimits = s5Runs.every((run) => (
    run.runtimeMs <= productionLimits.maximumRuntimeMs
    && Math.max(run.peakRssObservedBytes ?? Number.POSITIVE_INFINITY, run.peakChildSelfReportedRssBytes) <= productionLimits.maximumRssBytes
  ));
  const profileReproducibility = profileScales.every((scale) => {
    const runs = isolatedProfiles.filter((entry) => entry.scale === scale.level).map((entry) => entry.run);
    return runs.length === 2 && runs[0].semanticResultHash === runs[1].semanticResultHash;
  });
  const v5 = s4Checkpoint?.v5 as Record<string, unknown> | undefined;
  const v4 = s4Checkpoint?.v4 as Record<string, unknown> | undefined;
  const checkpointPassed = Boolean(
    s4Checkpoint?.deterministicResume
    && v5?.payloadChecksum === v5?.persistedChecksum
    && typeof v5?.bytes === "number"
    && typeof v4?.bytes === "number"
    && v5.bytes < v4.bytes,
  );
  const historicalGates = (previousPhase69.historicalGates ?? {}) as Record<string, boolean>;
  const phase69Scales = Array.isArray(previousPhase69.scales) ? previousPhase69.scales as Array<Record<string, unknown>> : [];
  const oldS4 = phase69Scales.find((entry) => entry.level === "S4") ?? null;
  const mathematicalIntegrity = s5Logical.nodes === 2_097_149
    && s5Logical.informationSets === 174_762
    && s5Logical.maximumDepth === 19
    && s5SubtreeValid
    && Object.values((previousPhase69.gates ?? {}) as Record<string, boolean>).every(Boolean);
  const gates = {
    R1_isolationIntegrity: isolationValidated,
    R2_watchdogReliability: watchdogValidated,
    R3_estimatorCalibration: calibration.completedRuns >= 6 && calibration.safetyMarginAdequate,
    R4_mathematicalIntegrity: mathematicalIntegrity,
    R5_binaryCheckpointIntegrity: checkpointPassed,
    R6_safeLargeScaleExecution: s5Preflight.decision === "ALLOW" && s5Completed && s5WithinLimits,
    R7_honestPerformanceReporting: s4Runs.every((run) => ["compilation", "traversal", "evaluation", "checkpoint"].every((stage) => stageRuntime(run, stage) !== null)),
    R8_reproducibleResearch: profileReproducibility && s5Deterministic === true && s5Runs.every((run) => Boolean(run.semanticResultHash && run.gameHash && run.configurationHash)),
  };
  const completedAt = new Date().toISOString();
  const artifactWithoutHash = {
    schemaVersion: 1,
    phase: "6.10",
    researchVersion: PHASE_610_RESEARCH_VERSION,
    solverVersion: SOLVER_VERSION,
    baseline: PHASE_610_BASELINE,
    startedAt,
    completedAt,
    trust: "Experimental",
    verifiedDatasets: 0,
    historicalGates,
    experimentConfigurations: {
      solver: solverConfiguration,
      scales: SCALE_CONFIGURATIONS.filter((entry) => ["S2", "S3", "S4", "S5"].includes(entry.level)),
      repetitions: { S2: 2, S3: 2, S4: 2, S5: s5Runs.length },
    },
    mathematicalValidation: {
      preservedPhase69Gates: previousPhase69.gates ?? null,
      controlledS5Subtree: s5Runs[0]?.result?.subtreeValidation ?? null,
      s5StructuralValidation: s5Runs[0]?.result?.structuralValidation ?? null,
      s5ExactEvaluation: s5Runs[0]?.result?.evaluation ?? null,
      proofScope: "Phase 6.9 differential/metamorphic oracles are preserved; S5 adds structural invariants and a controlled subtree oracle, not an independent full-game proof.",
    },
    regressionPolicy: {
      historicalGateDStillFails: historicalGates.D === false,
      verifiedDatasetsRemainZero: previousPhase69.verifiedDatasets === 0,
      pokerStrategyChanges: false,
    },
    architecture: {
      processIsolation: "parent watchdog -> child protocol/heartbeat -> worker compute",
      resourcePolicy: RESOURCE_POLICY_V3_VERSION,
      checkpoint: "binary-v5 with legacy V4 reader",
      topology: "compact-indexed-v2",
      strategySemanticsChanged: false,
    },
    environment: {
      platform: platform(),
      release: release(),
      node: process.version,
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    policy: {
      limits: productionLimits,
      tierDefinitions: {
        tier0: "historical <=250k-node envelope",
        tier1: "validated extension inside calibrated evidence envelope",
        tier2: "explicitly authorized one-iteration large-scale research only; never automatic",
      },
      calibration,
      s5Preflight,
    },
    failureRecovery,
    isolatedProfiles,
    s5Experiment: {
      decision: s5Decision,
      exactLogicalSize: s5Logical,
      runs: s5Runs,
      deterministicRepeat: s5Deterministic,
      subtreeValidationPassed: s5SubtreeValid,
      withinLimits: s5WithinLimits,
    },
    checkpointComparison: {
      source: "first isolated S4 run",
      v4: v4 ?? null,
      v5: v5 ?? null,
      deterministicResume: s4Checkpoint?.deterministicResume ?? false,
      passed: checkpointPassed,
      scope: "V5 stores exact numeric state; V4 remains readable for the legacy compact schema",
    },
    performance: {
      phase69S4: oldS4,
      isolatedS4: s4Runs.map((run) => ({
        pid: run.pid,
        totalRuntimeMs: run.runtimeMs,
        compilationMs: stageRuntime(run, "compilation"),
        traversalMs: stageRuntime(run, "traversal"),
        evaluationMs: stageRuntime(run, "evaluation"),
        checkpointMs: stageRuntime(run, "checkpoint"),
        peakRssObservedBytes: run.peakRssObservedBytes,
      })),
      caveat: "Parent-observed runtime includes process startup, tsx loader, protocol, watchdog sampling, and cleanup; stage durations isolate solver work.",
    },
    gates,
    verdict: Object.values(gates).every(Boolean) ? "PHASE_6_10_RESEARCH_GATES_PASS" : "PHASE_6_10_RESEARCH_GATES_PARTIAL",
    limitations: [
      "Synthetic games validate architecture and exact internal math; they are not verified poker strategy datasets.",
      "OS peak RSS is sampled and can miss a transient spike between samples.",
      "On Windows the watchdog polls WorkingSet64 and also constrains V8 old space; it does not use a native Job Object hard cap.",
      "Controlled subtree equivalence does not prove full-game strategy equivalence.",
      "Historical Gate D remains FAIL and no product poker range was changed.",
    ],
  };
  return { ...artifactWithoutHash, artifactHash: hashValue(artifactWithoutHash) };
}
