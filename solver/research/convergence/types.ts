import type { AlgorithmName, SolverConfiguration } from "../../core/types";

export const CONVERGENCE_EXPERIMENT_SCHEMA = "phase6.14-experiment-v1";
export const CONVERGENCE_FRAMEWORK_VERSION = "convergence-framework-v0.14.0";

export type ConvergenceGameConfiguration =
  | {
      family:
        | "matching-pennies"
        | "rock-paper-scissors"
        | "hidden-information"
        | "variable-depth-hidden"
        | "asymmetric-chance";
    }
  | { family: "controlled-random"; seed: number }
  | {
      family: "irregular-branching";
      seed: number;
      maximumDepth: number;
      minimumTerminalDepth: number;
      maximumBranching: number;
    }
  | { family: "chance-stress"; probability: number };

export type ConvergenceResourceBudget = {
  maximumNodes: number;
  maximumRuntimeMs: number;
  maximumRssBytes: number;
  maximumWorkUnits: number;
  maximumPurePolicies: number;
};

export type ConvergenceExperimentConfiguration = {
  schema: typeof CONVERGENCE_EXPERIMENT_SCHEMA;
  experimentId: string;
  game: ConvergenceGameConfiguration;
  algorithm: AlgorithmName;
  solverConfiguration: SolverConfiguration;
  seed: number;
  comparisonMode: "iteration-matched" | "time-matched";
  iterationBudget: number;
  timeBudgetMs?: number;
  evaluationSchedule: number[];
  checkpointSchedule: number[];
  initialState: "zero" | "alternating-bias";
  utilityScale: number;
  resourceBudget: ConvergenceResourceBudget;
  commit: string;
};

export type RegretStatistics = {
  positiveMass: number;
  negativeMass: number;
  maximumAbsolute: number;
  meanAbsolute: number;
  normalizedPositiveMass: number;
  normalizedMaximumAbsolute: number;
};

export type NumericalDiagnostics = {
  finiteRegrets: boolean;
  finiteStrategySums: boolean;
  finiteUtilities: boolean;
  currentNormalizationError: number;
  averageNormalizationError: number;
  minimumNonZeroReachProxy: number | null;
  anomalies: string[];
};

export type ConvergencePointV1 = {
  iteration: number;
  elapsedMs: number;
  traversalMs: number;
  evaluationMs: number;
  checkpointMs: number;
  nashConv: number;
  exploitability: number;
  utilities: [number, number];
  bestResponseValues: [number, number];
  independentNashConv: number | null;
  independentDelta: number | null;
  averageStrategyHash: string;
  regret: RegretStatistics;
  numerical: NumericalDiagnostics;
  rssBytes: number;
  heapUsedBytes: number;
};

export type ConvergenceClassification =
  | "OBSERVED IMPROVEMENT"
  | "OBSERVED PLATEAU"
  | "NUMERICAL INSTABILITY"
  | "BUDGET LIMITED"
  | "INCONCLUSIVE"
  | "ANALYTICALLY CROSS-CHECKED";

export type ConvergenceExperimentResult = {
  schema: typeof CONVERGENCE_EXPERIMENT_SCHEMA;
  frameworkVersion: typeof CONVERGENCE_FRAMEWORK_VERSION;
  experimentId: string;
  configuration: ConvergenceExperimentConfiguration;
  gameId: string;
  gameHash: string;
  structuralHash: string;
  algorithmVersion: string;
  environment: Record<string, unknown>;
  status:
    | "completed"
    | "budget-limited"
    | "cancelled"
    | "numerical-failure"
    | "failed";
  stopReason:
    | "iteration-budget"
    | "runtime-budget"
    | "memory-budget"
    | "work-budget"
    | "numerical-failure"
    | "cancelled"
    | "error";
  iterations: number;
  runtimeMs: number;
  peakRssBytes: number;
  iterationsPerSecond: number;
  series: ConvergencePointV1[];
  checkpointHashes: string[];
  classifications: ConvergenceClassification[];
  plateau: PlateauDiagnostic;
  empiricalRate: EmpiricalRateDiagnostic;
  finalStateHash: string;
  failureReason: string | null;
};

export type PlateauDiagnostic = {
  classification:
    | "improving"
    | "plateau"
    | "oscillation"
    | "divergence"
    | "insufficient-data";
  window: number;
  relativeImprovement: number | null;
  signChanges: number;
  evidence: string;
};

export type EmpiricalRateDiagnostic = {
  method: "log-log-ols";
  sampleCount: number;
  slope: number | null;
  intercept: number | null;
  rSquared: number | null;
  interval: [number, number] | null;
  limitation: string;
};
