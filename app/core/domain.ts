export type Position = "UTG" | "UTG+1" | "LJ" | "HJ" | "CO" | "BTN" | "SB" | "BB";
export type ScenarioKey = "rfi" | "vs-open" | "vs-3bet" | "bb-defense" | "bvb" | "squeeze" | "vs-jam";
export type ActionKey = "fold" | "call" | "limp" | "raise" | "threebet" | "fourbet" | "jam";
export type StrategySourceType = "licensed" | "internal-solve" | "reviewed" | "imported" | "modeled" | "estimated";
export type StrategyTrustLevel = "verified" | "curated" | "modeled" | "experimental";
export type DatasetWorkflowStatus = "draft" | "review_required" | "reviewed" | "published" | "deprecated";
export type GameType = "MTT";
export type GameModel = "ChipEV" | "ICM";
export type InterfaceLevel = "beginner" | "advanced" | "professional";
export type Difficulty = "beginner" | "intermediate" | "advanced" | "pro";

export type Card = { rank: string; suit: string };
export type StrategyAction = {
  action: ActionKey;
  frequency: number;
  ev: number | null;
};
export type StrategyProvenance = {
  datasetId: string;
  datasetVersion: string;
  sourceType: StrategySourceType;
  trustLevel: StrategyTrustLevel;
  sourceLabel: string;
  isExact: boolean;
  frequencyPrecision: "exact" | "rounded" | "estimated";
  evAvailable: boolean;
  methodology: string;
  license: string;
  status: DatasetWorkflowStatus;
  reviewedAt?: string;
  notes?: string;
};
export type DatasetMetadata = {
  id: string;
  name: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  generatedAt: string;
  reviewedAt?: string;
  sourceType: StrategySourceType;
  trustLevel: StrategyTrustLevel;
  status: DatasetWorkflowStatus;
  gameType: GameType;
  model: GameModel;
  format: string;
  players: number;
  anteStructure: string;
  availableStacks: number[];
  availableOpenSizes: number[];
  available3betSizes: number[];
  supportedNodes: ScenarioKey[];
  methodology: string;
  frequencyPrecision: "exact" | "rounded" | "estimated";
  evAvailable: boolean;
  isExact: boolean;
  license: string;
  changeLog: Array<{ version: string; date: string; changes: string[] }>;
  notes: string;
  enabled: boolean;
};
export type StrategyQuery = {
  datasetId: string;
  gameType: GameType;
  model: GameModel;
  format: string;
  players: number;
  stack: number;
  hero: Position;
  scenario: ScenarioKey;
  villain?: Position;
  caller?: Position;
  openSize?: number;
  threeBetSize?: number;
};
export type NodeAction = {
  position: Position;
  action?: ActionKey;
  sizeBb?: number;
  text: string;
};
export type StrategyNode = {
  id: string;
  parentNodeId: string | null;
  datasetId: string;
  actingPosition: Position;
  effectiveStack: number;
  pot: number;
  openSize?: number;
  threeBetSize?: number;
  actionsAvailable: ActionKey[];
  actionHistory: NodeAction[];
  strategyByHand: Record<string, StrategyAction[]>;
  childNodeIds: string[];
  query: StrategyQuery;
  provenance: StrategyProvenance;
};
export type StrategyLookup =
  | { status: "available"; node: StrategyNode }
  | {
      status: "unavailable";
      query: StrategyQuery;
      reason: string;
      alternatives: StrategyQuery[];
    };
export type SerializedStrategyDataset = {
  metadata: DatasetMetadata;
  nodes: StrategyNode[];
};
export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
  severity: "error" | "warning";
};
export type ValidationReport = {
  valid: boolean;
  issues: ValidationIssue[];
};
export type SeatState = {
  position: Position;
  cards: Card[];
  notation: string;
  actionBeforeHero?: ActionKey;
};
export type ActionEvent = { position: Position; action: ActionKey; text: string };
export type RoundResolution = { events: ActionEvent[]; summary: string };
export type Spot = {
  id: string;
  cards: Card[];
  notation: string;
  hero: Position;
  villain?: Position;
  caller?: Position;
  scenario: ScenarioKey;
  stack: number;
  history: string[];
  pot: number;
  strategy: StrategyAction[];
  seats?: SeatState[];
  nodeId: string;
  datasetId: string;
  provenance: StrategyProvenance;
};
export type Confidence = 1 | 2 | 3 | 4 | 5;
export type KnowledgeState = "knowledge-gap" | "uncertain" | "misconception" | "mastered";
export type ResolutionPolicy = {
  allowModeledFallback: boolean;
  allowExperimental: boolean;
  trustedOnly?: boolean;
};

export type CoverageEntry = {
  query: StrategyQuery;
  status: "available" | "unavailable";
  trustLevel: StrategyTrustLevel | "unavailable";
  datasetId: string | null;
  datasetVersion: string | null;
  nodeId: string | null;
  reason?: string;
};

export type CoverageMetrics = {
  totalCombinations: number;
  supportedNodes: number;
  verifiedNodes: number;
  curatedNodes: number;
  modeledNodes: number;
  experimentalNodes: number;
  unavailableCombinations: number;
};

export type HandRecord = Spot & {
  selected: ActionKey;
  correct: boolean;
  score: number;
  frequencyError: number;
  loss: number | null;
  marked: boolean;
  confidence: Confidence;
  knowledgeState: KnowledgeState;
  timestamp: number;
  resolution?: RoundResolution;
};

export const POSITIONS: Position[] = ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export const STACKS = [8, 10, 12, 14, 15, 17, 20, 25, 30, 35, 40, 50, 60, 80, 100];

export const SCENARIOS: Record<ScenarioKey, { label: string; short: string; copy: string }> = {
  rfi: { label: "Pote não aberto", short: "RFI", copy: "Decida se entra no pote como primeiro agressor." },
  "vs-open": { label: "Contra open", short: "vs RFI", copy: "Defenda, 3-bete ou abandone contra uma abertura." },
  "vs-3bet": { label: "Contra 3-bet", short: "vs 3-bet", copy: "Continue corretamente depois de abrir e enfrentar uma 3-bet." },
  "bb-defense": { label: "Defesa do BB", short: "BB defend", copy: "Proteja o big blind contra diferentes posições." },
  bvb: { label: "Blind vs blind", short: "BvB", copy: "Jogue a árvore de SB contra BB." },
  squeeze: { label: "Spot de squeeze", short: "Squeeze", copy: "Há uma abertura e um call antes de você." },
  "vs-jam": { label: "Contra all-in", short: "vs Jam", copy: "Decida se paga um all-in pré-flop." },
};

export const ACTIONS: Record<ActionKey, { label: string; compact: string; color: string; hotkey: string }> = {
  fold: { label: "Fold", compact: "FOLD", color: "#64706c", hotkey: "F" },
  call: { label: "Call", compact: "CALL", color: "#2e9c76", hotkey: "C" },
  limp: { label: "Limp", compact: "LIMP", color: "#4e88d8", hotkey: "L" },
  raise: { label: "Raise", compact: "RAISE", color: "#ef9c46", hotkey: "R" },
  threebet: { label: "3-bet", compact: "3-BET", color: "#d76b52", hotkey: "T" },
  fourbet: { label: "4-bet", compact: "4-BET", color: "#b86fe0", hotkey: "B" },
  jam: { label: "All-in", compact: "JAM", color: "#e14f63", hotkey: "J" },
};

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const round = (value: number, digits = 2) => Number(value.toFixed(digits));
