import type { SolverConfiguration } from "../../core/types";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import type { PreflightV3Result } from "./resource-policy-v3";

export const RESOURCE_SAFE_VERSION = "resource-safe-v0.10.0";

export type ResourceTier = "tier0" | "tier1" | "tier2";
export type PreflightDecision = "ALLOW" | "DENY" | "REQUIRE_VALIDATION";
export type TerminationReason =
  | "completed"
  | "preflight-denied"
  | "timeout"
  | "memory-limit"
  | "unresponsive"
  | "child-crash"
  | "fatal-error"
  | "structural-limit";

export type ProcessMemory = {
  timestamp: string;
  stage: string;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  peakRssSelfReported: number;
};

export type ResourceLimits = {
  maximumRssBytes: number;
  maximumRuntimeMs: number;
  maximumIdleMs: number;
  maximumIterations: number;
  sampleIntervalMs: number;
};

export type IsolatedExperimentKind =
  | "profile"
  | "compiler-profile"
  | "generic-compiler-profile"
  | "generic-cache-profile"
  | "timeout-fixture"
  | "hang-fixture"
  | "memory-fixture"
  | "crash-fixture";

export type IsolatedExperimentRequest = {
  experimentId: string;
  kind: IsolatedExperimentKind;
  configuration?: SyntheticGameConfiguration;
  solverConfiguration?: SolverConfiguration;
  iterations: number;
  evaluate: boolean;
  checkpoint: boolean;
  tier: ResourceTier;
  explicitLargeScaleAuthorization: boolean;
  limits: ResourceLimits;
  fixtureAllocationBytes?: number;
  preflight?: PreflightV3Result;
  compilerMode?: "baseline" | "typescript-v2" | "cache-load" | "rust";
  chunkSize?: number;
  structuralPath?: string;
  rustExecutable?: string;
  cachePath?: string;
  crossValidate?: boolean;
  genericFamily?: "irregular-branching" | "variable-depth-hidden" | "asymmetric-chance" | "regular-synthetic";
  genericScale?: number;
  genericGrowthPolicy?: "geometric" | "chunked" | "segmented";
  genericInitialCapacity?: number;
  genericCacheFormat?: "v1" | "v2";
  cacheLoadMode?: "safe-copy" | "shared-view";
  cacheIntegrityMode?: "whole-buffer" | "streaming";
};

export type StageMetric = {
  stage: string;
  status: "started" | "completed" | "failed";
  timestamp: string;
  runtimeMs?: number;
  details?: Record<string, unknown>;
  memory?: ProcessMemory;
};

export type IsolatedExperimentResult = {
  experimentId: string;
  pid: number | null;
  kind: IsolatedExperimentKind;
  tier: ResourceTier;
  configurationHash: string;
  gameHash: string | null;
  startTimestamp: string;
  endTimestamp: string;
  runtimeMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  terminationReason: TerminationReason;
  watchdogTriggered: boolean;
  peakRssObservedBytes: number | null;
  peakRssMeasurement: "os-sampled" | "child-self-reported" | "unavailable";
  peakChildSelfReportedRssBytes: number;
  stages: StageMetric[];
  result: Record<string, unknown> | null;
  error: string | null;
  limits: ResourceLimits;
  semanticResultHash: string | null;
};

export type CalibrationRun = {
  scale: string;
  nodes: number;
  estimatedPeakBytes: number;
  logicalVariablePeakBytes?: number;
  observedPeakBytes: number;
  baselineRssBytes: number;
  runtimeMs: number;
  estimatedRuntimeMs: number;
  completed: boolean;
};

export type ResourceCalibration = {
  version: 1;
  runs: CalibrationRun[];
  completedRuns: number;
  validatedMaximumNodes: number;
  fixedProcessOverheadBytes: number;
  fixedRuntimeOverheadMs: number;
  variableMemoryMultiplier: number;
  runtimeMultiplier: number;
  meanAbsoluteErrorBytes: number;
  meanRelativeError: number;
  underestimationFrequency: number;
  worstUnderestimationBytes: number;
  worstUnderestimationFraction: number;
  safetyMarginAdequate: boolean;
  isolationValidated: boolean;
  watchdogValidated: boolean;
  semanticHash: string;
};
