import type {
  EngineCapabilitiesV1,
  ExperimentState,
  ExperimentStatusV1,
  ResearchErrorShape,
  ResearchExperimentConfigurationV1,
  ResearchProgressEvent,
  ResearchResultV1,
} from "../public/contracts";

export type ConsoleRunSummary = {
  experimentId: string;
  runId: string;
  state: ExperimentState;
  createdAt: string;
  updatedAt: string;
  algorithm: ResearchExperimentConfigurationV1["algorithm"]["id"];
  provider: ResearchExperimentConfigurationV1["provider"]["id"];
  iterations: number;
  completedIterations: number;
  progress: number;
  durationMs: number | null;
  resultAvailable: boolean;
  checkpointCount: number;
  error: ResearchErrorShape | null;
};

export type ConsoleRunDetails = {
  summary: ConsoleRunSummary;
  status: ExperimentStatusV1;
  configuration: ResearchExperimentConfigurationV1;
  result: ResearchResultV1 | null;
  events: ResearchProgressEvent[];
  checkpoints: { file: string; iteration: number | null; sizeBytes: number; modifiedAt: string }[];
};

export type ConsoleOverview = {
  capabilities: EngineCapabilitiesV1;
  totals: Record<"all" | "completed" | "running" | "interrupted" | "failed", number>;
  recentRuns: ConsoleRunSummary[];
  recentFailures: ConsoleRunSummary[];
  resources: { activeRuns: number; peakRssBytes: number | null; runtimeMs: number | null };
  environment: { status: "healthy" | "degraded"; checkedAt: string };
};

export type ConsoleGame = {
  selectionId: ResearchExperimentConfigurationV1["provider"]["id"];
  id: string;
  version: string;
  structuralHash: string;
  compiler: string;
  nodes: number;
  terminalNodes: number;
  chanceNodes: number;
  decisionNodes: number;
  informationSets: number;
  maximumDepth: number | null;
  actions: string[];
  capabilities: readonly string[];
  validation: { valid: boolean; issues: readonly string[]; independentDelta: number | null };
};

export type ConsoleTreeNode = {
  id: string;
  parentId: string | null;
  depth: number;
  kind: "player" | "chance" | "terminal";
  actor: number | "chance" | null;
  action: string | null;
  informationSet: string | null;
  chanceProbability: number | null;
  utility: readonly [number, number] | null;
};

export type ConsoleTree = { gameId: string; nodes: ConsoleTreeNode[]; truncated: boolean; limit: number };

export type ConsoleListResponse = {
  items: ConsoleRunSummary[];
  total: number;
  page: number;
  pageSize: number;
};
