import type { AlgorithmName, DcfrParameters } from "../../core/types";
import type { ResourceTier } from "../resource-safe/types";

export const RESEARCH_ENGINE_VERSION = "1.0.0";
export const PUBLIC_API_VERSION = "research-api-v1";
export const EXPERIMENT_SCHEMA_VERSION = "research-experiment-v1";
export const RESULT_SCHEMA_VERSION = "research-result-v1";
export const EVENT_SCHEMA_VERSION = "research-event-v1";
export const PROVIDER_CONTRACT_V3 = "provider-contract-v3.0.0";

export const CAPABILITY_IDS = [
  "finite-game",
  "two-player",
  "zero-sum",
  "perfect-recall",
  "explicit-chance",
  "compact-compiler",
  "generic-compiler",
  "checkpoint-v5",
  "structural-cache-v1",
  "structural-cache-v2",
  "independent-evaluation",
  "isolated-execution",
  "resource-policy-v3",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];
export type ValidationLevel =
  | "unvalidated"
  | "structurally-validated"
  | "differentially-validated"
  | "analytically-validated"
  | "reproducible-research-result";

export type ProviderSelection = {
  id: "variable-depth-hidden" | "asymmetric-chance" | "irregular-branching" | "regular-synthetic";
  version?: string;
  parameters?: Readonly<Record<string, unknown>>;
};

export type AlgorithmConfigurationV1 = {
  id: AlgorithmName;
  version?: string;
  seed: number;
  cfrPlusAveragingDelay?: number;
  dcfr?: DcfrParameters;
};

export type ResearchExperimentConfigurationV1 = {
  schemaVersion: typeof EXPERIMENT_SCHEMA_VERSION;
  experimentId?: string;
  provider: ProviderSelection;
  algorithm: AlgorithmConfigurationV1;
  budget: {
    iterations: number;
    runtimeMs: number;
    memoryBytes: number;
    tier: ResourceTier;
    explicitLargeScaleAuthorization?: boolean;
  };
  evaluation: {
    interval: number;
    exact: boolean;
  };
  checkpoint: {
    interval: number;
    retain: number;
  };
  outputDirectory: string;
  validation: {
    structural: boolean;
    independentEvaluation: boolean;
  };
};

export type ExperimentState =
  | "created"
  | "preflight"
  | "ready"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "interrupted";

export type ResearchProgressEventType =
  | "EXPERIMENT_CREATED"
  | "PREFLIGHT_STARTED"
  | "PREFLIGHT_PASSED"
  | "COMPILATION_STARTED"
  | "COMPILATION_COMPLETED"
  | "RUN_STARTED"
  | "ITERATION_PROGRESS"
  | "CHECKPOINT_CREATED"
  | "EVALUATION_COMPLETED"
  | "RUN_INTERRUPTED"
  | "RECOVERY_STARTED"
  | "RUN_COMPLETED"
  | "RUN_FAILED";

export type ResearchProgressEvent = {
  schemaVersion: typeof EVENT_SCHEMA_VERSION;
  sequence: number;
  type: ResearchProgressEventType;
  experimentId: string;
  runId: string;
  timestamp: string;
  state: ExperimentState;
  iteration: number | null;
  totalIterations: number;
  progress: number;
  message: string;
  metrics?: Readonly<Record<string, number | string | boolean | null>>;
};

export type ExperimentStatusV1 = {
  apiVersion: typeof PUBLIC_API_VERSION;
  experimentId: string;
  runId: string;
  state: ExperimentState;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
  lastEvent: ResearchProgressEvent | null;
  error: ResearchErrorShape | null;
};

export type ResearchMetricsV1 = {
  iterations: number;
  nodesVisited: number;
  nodes: number;
  informationSets: number;
  exploitability: number | null;
  nashConv: number | null;
  utilityP0: number | null;
  runtimeMs: number;
  peakRssBytes: number;
  stateHash: string;
};

export type ValidationEvidenceV1 = {
  level: ValidationLevel;
  structural: { passed: boolean; checks: readonly string[] };
  independentEvaluation: { performed: boolean; passed: boolean | null; tolerance: number | null };
  mathematicalScope: "finite-two-player-zero-sum-perfect-recall";
  pokerCertified: false;
  verifiedDataset: false;
};

export type ResearchResultV1 = {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  apiVersion: typeof PUBLIC_API_VERSION;
  engineVersion: typeof RESEARCH_ENGINE_VERSION;
  experimentId: string;
  runId: string;
  game: { id: string; version: string; semanticIdentity: string; providerContract: typeof PROVIDER_CONTRACT_V3 };
  algorithm: { id: AlgorithmName; version: string; parameters: AlgorithmConfigurationV1 };
  completion: { status: "completed"; stoppedBy: "iterations" | "runtime"; completedAt: string };
  configuration: ResearchExperimentConfigurationV1;
  compiler: { id: "compiler-v2" | "compiler-v3"; version: string; structuralHash: string };
  metrics: ResearchMetricsV1;
  convergence: readonly Readonly<Record<string, number>>[];
  checkpoints: readonly { file: string; iteration: number; checksum: string }[];
  validation: ValidationEvidenceV1;
  limitations: readonly string[];
  artifactChecksum: string;
};

export type ResearchErrorCode =
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_CAPABILITY"
  | "INVALID_CONFIGURATION"
  | "RESOURCE_LIMIT"
  | "COMPILATION_ERROR"
  | "EXECUTION_ERROR"
  | "CHECKPOINT_ERROR"
  | "CACHE_ERROR"
  | "RECOVERY_ERROR"
  | "ARTIFACT_ERROR"
  | "INTERNAL_ERROR";

export type ResearchErrorShape = {
  name: "ResearchEngineError";
  code: ResearchErrorCode;
  message: string;
  details: Readonly<Record<string, unknown>>;
  recoverable: boolean;
};

export type ResearchOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ResearchErrorShape };

export type EngineCapabilitiesV1 = {
  apiVersion: typeof PUBLIC_API_VERSION;
  engineVersion: typeof RESEARCH_ENGINE_VERSION;
  capabilities: readonly CapabilityId[];
  algorithms: readonly { id: AlgorithmName; version: string; checkpointVersion: 5 }[];
  providers: readonly { id: string; version: string; capabilities: readonly CapabilityId[] }[];
  scope: {
    finiteGames: true;
    players: 2;
    zeroSum: true;
    perfectRecall: true;
    explicitChance: true;
    multiplayer: false;
    pokerStrategiesCertified: false;
  };
  formats: {
    provider: readonly ["provider-contract-v2.0.0", typeof PROVIDER_CONTRACT_V3];
    compiler: readonly ["compiler-v2", "compiler-v3"];
    cache: readonly ["structural-cache-v1", "structural-cache-v2"];
    checkpoint: readonly ["checkpoint-v5"];
    experiment: readonly [typeof EXPERIMENT_SCHEMA_VERSION];
    result: readonly [typeof RESULT_SCHEMA_VERSION];
  };
};

export type FutureUiExperimentSummary = Pick<ExperimentStatusV1, "experimentId" | "runId" | "state" | "updatedAt"> & {
  algorithm: AlgorithmName;
  provider: string;
  progress: number;
};

export type FutureUiExperimentDetails = {
  summary: FutureUiExperimentSummary;
  configuration: ResearchExperimentConfigurationV1;
  convergence: readonly Readonly<Record<string, number>>[];
  checkpoints: readonly { iteration: number; file: string }[];
  diagnostics: readonly ResearchErrorShape[];
  resources: { runtimeMs: number; peakRssBytes: number } | null;
  validation: ValidationEvidenceV1 | null;
};
