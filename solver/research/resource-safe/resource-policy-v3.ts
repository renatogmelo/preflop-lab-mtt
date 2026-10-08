import { hashValue } from "../../core/stable";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { estimateSyntheticGame } from "../scalability/tree-size-estimator";
import type { CalibrationRun, ResourceCalibration, ResourceTier } from "./types";

export const RESOURCE_POLICY_V3_VERSION = "resource-policy-v3.0.0";
export const RESOURCE_POLICY_V3_LIMITS = {
  maximumMemoryBytes: 768 * 1024 * 1024,
  maximumRuntimeMs: 30_000,
  tier0MaximumNodes: 250_000,
  tier1MaximumValidatedMultiplier: 4,
  maximumIterationsTier0: 20,
  maximumIterationsTier1: 20,
  maximumIterationsTier2: 1,
  minimumCalibrationRuns: 6,
  minimumSafetyMultiplier: 1.15,
} as const;

export type ResourceEstimateV3 = {
  nodes: number;
  informationSets: number;
  informationSetActions: number;
  topologyBytes: number;
  registryBytes: number;
  regretBytes: number;
  strategySumBytes: number;
  compilationOverheadBytes: number;
  evaluationBufferBytes: number;
  checkpointPayloadBytes: number;
  checkpointTemporaryBytes: number;
  logicalResidentBytes: number;
  logicalPeakBytes: number;
  fixedProcessOverheadBytes: number;
  calibratedVariableMultiplier: number;
  safetyMarginBytes: number;
  estimatedPeakBytes: number;
  estimatedRuntimeMs: number;
};

export type PreflightV3Input = {
  configuration: SyntheticGameConfiguration;
  tier: ResourceTier;
  iterations: number;
  explicitLargeScaleAuthorization: boolean;
  calibration?: ResourceCalibration | null;
};

export type PreflightV3Result = {
  version: typeof RESOURCE_POLICY_V3_VERSION;
  decision: "ALLOW" | "DENY" | "REQUIRE_VALIDATION";
  reasons: string[];
  tier: ResourceTier;
  estimate: ResourceEstimateV3;
  limits: typeof RESOURCE_POLICY_V3_LIMITS;
  calibrationHash: string | null;
};

export function estimateResourcesV3(
  configuration: SyntheticGameConfiguration,
  iterations: number,
  calibration?: ResourceCalibration | null,
): ResourceEstimateV3 {
  const logical = estimateSyntheticGame(configuration);
  const informationSetActions = logical.informationSets * configuration.actionsPerDecision;
  const topologyBytes = logical.nodes * 28;
  const registryBytes = (logical.informationSets + 1) * 4 + logical.informationSets * 2;
  const regretBytes = informationSetActions * 8;
  const strategySumBytes = informationSetActions * 8;
  const compilationOverheadBytes = logical.nodes;
  const evaluationBufferBytes = logical.nodes * 16 + informationSetActions * 8 + logical.informationSets * 2;
  const checkpointPayloadBytes = regretBytes + strategySumBytes;
  const checkpointTemporaryBytes = checkpointPayloadBytes + 4096;
  const logicalResidentBytes = topologyBytes + registryBytes + regretBytes + strategySumBytes;
  const variablePeak = logicalResidentBytes + Math.max(compilationOverheadBytes, evaluationBufferBytes, checkpointTemporaryBytes);
  const fixedProcessOverheadBytes = calibration?.fixedProcessOverheadBytes ?? 64 * 1024 * 1024;
  const calibratedVariableMultiplier = calibration?.variableMemoryMultiplier ?? 1.5;
  const uncalibratedRuntime = logical.nodes / 2_000_000 * 1000 * (2 * iterations + (iterations > 0 ? 5 : 1));
  const runtimeMultiplier = calibration?.runtimeMultiplier ?? 1.5;
  const fixedRuntimeOverheadMs = calibration?.fixedRuntimeOverheadMs ?? 0;
  const safetyMarginBytes = Math.ceil(variablePeak * (calibratedVariableMultiplier - 1));
  return {
    nodes: logical.nodes,
    informationSets: logical.informationSets,
    informationSetActions,
    topologyBytes,
    registryBytes,
    regretBytes,
    strategySumBytes,
    compilationOverheadBytes,
    evaluationBufferBytes,
    checkpointPayloadBytes,
    checkpointTemporaryBytes,
    logicalResidentBytes,
    logicalPeakBytes: variablePeak,
    fixedProcessOverheadBytes,
    calibratedVariableMultiplier,
    safetyMarginBytes,
    estimatedPeakBytes: Math.ceil(fixedProcessOverheadBytes + variablePeak * calibratedVariableMultiplier),
    estimatedRuntimeMs: fixedRuntimeOverheadMs + uncalibratedRuntime * runtimeMultiplier,
  };
}

export function preflightV3(input: PreflightV3Input): PreflightV3Result {
  const estimate = estimateResourcesV3(input.configuration, input.iterations, input.calibration);
  const reasons: string[] = [];
  let decision: PreflightV3Result["decision"] = "ALLOW";
  const deny = (reason: string) => { reasons.push(reason); decision = "DENY"; };
  const requireValidation = (reason: string) => {
    reasons.push(reason);
    if (decision !== "DENY") decision = "REQUIRE_VALIDATION";
  };
  if (input.iterations < 0 || !Number.isInteger(input.iterations)) deny("invalid-iteration-count");
  if (estimate.estimatedPeakBytes > RESOURCE_POLICY_V3_LIMITS.maximumMemoryBytes) deny("estimated-memory-budget");
  if (estimate.estimatedRuntimeMs > RESOURCE_POLICY_V3_LIMITS.maximumRuntimeMs) deny("estimated-runtime-budget");
  if (input.tier === "tier0") {
    if (estimate.nodes > RESOURCE_POLICY_V3_LIMITS.tier0MaximumNodes) deny("tier0-node-budget");
    if (input.iterations > RESOURCE_POLICY_V3_LIMITS.maximumIterationsTier0) deny("tier0-iteration-budget");
  } else if (input.tier === "tier1") {
    if (!input.calibration || input.calibration.completedRuns < RESOURCE_POLICY_V3_LIMITS.minimumCalibrationRuns
      || !input.calibration.isolationValidated || !input.calibration.watchdogValidated) {
      requireValidation("tier1-calibration-required");
    } else {
      const maximumNodes = input.calibration.validatedMaximumNodes * RESOURCE_POLICY_V3_LIMITS.tier1MaximumValidatedMultiplier;
      if (estimate.nodes > maximumNodes) deny("tier1-evidence-envelope");
      if (!input.calibration.safetyMarginAdequate) deny("tier1-safety-margin-inadequate");
    }
    if (input.iterations > RESOURCE_POLICY_V3_LIMITS.maximumIterationsTier1) deny("tier1-iteration-budget");
  } else {
    if (!input.explicitLargeScaleAuthorization) deny("tier2-explicit-authorization-required");
    if (!input.calibration || input.calibration.completedRuns < RESOURCE_POLICY_V3_LIMITS.minimumCalibrationRuns
      || !input.calibration.isolationValidated || !input.calibration.watchdogValidated) {
      requireValidation("tier2-calibration-required");
    } else if (!input.calibration.safetyMarginAdequate) {
      deny("tier2-safety-margin-inadequate");
    }
    if (input.iterations > RESOURCE_POLICY_V3_LIMITS.maximumIterationsTier2) deny("tier2-one-iteration-limit");
  }
  return {
    version: RESOURCE_POLICY_V3_VERSION,
    decision,
    reasons,
    tier: input.tier,
    estimate,
    limits: RESOURCE_POLICY_V3_LIMITS,
    calibrationHash: input.calibration?.semanticHash ?? null,
  };
}

function median(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function calibrateResourcePolicy(
  runs: CalibrationRun[],
  evidence: { isolationValidated: boolean; watchdogValidated: boolean },
): ResourceCalibration {
  const completed = runs.filter((run) => run.completed && run.observedPeakBytes > 0);
  if (!completed.length) throw new Error("Resource calibration requires completed isolated runs.");
  const absoluteErrors = completed.map((run) => Math.abs(run.observedPeakBytes - run.estimatedPeakBytes));
  const relativeErrors = completed.map((run) => Math.abs(run.observedPeakBytes - run.estimatedPeakBytes) / Math.max(1, run.observedPeakBytes));
  const underestimations = completed.map((run) => Math.max(0, run.observedPeakBytes - run.estimatedPeakBytes));
  const baseline = median(completed.map((run) => run.baselineRssBytes));
  const fixedProcessOverheadBytes = Math.min(...completed.map((run) => run.observedPeakBytes));
  const variableRatios = completed.map((run) => {
    const observedVariable = Math.max(0, run.observedPeakBytes - fixedProcessOverheadBytes);
    const estimatedVariable = Math.max(1, run.logicalVariablePeakBytes ?? (run.estimatedPeakBytes - 64 * 1024 * 1024) / 1.5);
    return observedVariable / estimatedVariable;
  });
  const variableMemoryMultiplier = Math.max(
    RESOURCE_POLICY_V3_LIMITS.minimumSafetyMultiplier,
    Math.max(...variableRatios) * 1.15,
  );
  const runtimePoints = [...new Map(completed.map((run) => [run.nodes, run])).values()]
    .map((representative) => ({
      x: representative.estimatedRuntimeMs / 1.5,
      y: Math.max(...completed.filter((run) => run.nodes === representative.nodes).map((run) => run.runtimeMs)),
    }))
    .sort((left, right) => left.x - right.x);
  const slopes: number[] = [];
  for (let left = 0; left < runtimePoints.length; left += 1) {
    for (let right = left + 1; right < runtimePoints.length; right += 1) {
      slopes.push(Math.max(0, runtimePoints[right].y - runtimePoints[left].y) / Math.max(1, runtimePoints[right].x - runtimePoints[left].x));
    }
  }
  const runtimeMultiplier = Math.max(1, ...(slopes.length ? slopes : runtimePoints.map((point) => point.y / Math.max(1, point.x)))) * 1.15;
  const fixedRuntimeOverheadMs = Math.max(0, ...runtimePoints.map((point) => point.y - runtimeMultiplier * point.x));  const worstUnderestimationBytes = Math.max(...underestimations);
  const worstUnderestimationFraction = Math.max(...completed.map((run) => (
    Math.max(0, run.observedPeakBytes - run.estimatedPeakBytes) / Math.max(1, run.observedPeakBytes)
  )));
  const semantic = {
    runs: completed.map((run) => ({ ...run, runtimeMs: Math.round(run.runtimeMs * 1000) / 1000 })),
    evidence,
    baseline,
    fixedRuntimeOverheadMs,
    variableMemoryMultiplier,
    runtimeMultiplier,
  };
  return {
    version: 1,
    runs,
    completedRuns: completed.length,
    validatedMaximumNodes: Math.max(...completed.map((run) => run.nodes)),
    fixedProcessOverheadBytes: Math.ceil(fixedProcessOverheadBytes),
    fixedRuntimeOverheadMs,
    variableMemoryMultiplier,
    runtimeMultiplier,
    meanAbsoluteErrorBytes: absoluteErrors.reduce((sum, value) => sum + value, 0) / completed.length,
    meanRelativeError: relativeErrors.reduce((sum, value) => sum + value, 0) / completed.length,
    underestimationFrequency: underestimations.filter((value) => value > 0).length / completed.length,
    worstUnderestimationBytes,
    worstUnderestimationFraction,
    safetyMarginAdequate: Number.isFinite(variableMemoryMultiplier) && variableMemoryMultiplier >= 1.15,
    isolationValidated: evidence.isolationValidated,
    watchdogValidated: evidence.watchdogValidated,
    semanticHash: hashValue(semantic),
  };
}
