export type Player = 0 | 1;
export type Actor = Player | "chance";

export type ChanceOutcome<Action extends string> = {
  action: Action;
  probability: number;
};

export type BehavioralStrategy = Record<string, Record<string, number>>;

export interface ExtensiveGame<State, Action extends string> {
  readonly id: string;
  readonly definition: unknown;
  initialState(): State;
  actor(state: State): Actor | null;
  isTerminal(state: State): boolean;
  utility(state: State, player: Player): number;
  actions(state: State): readonly Action[];
  next(state: State, action: Action): State;
  chanceOutcomes(state: State): readonly ChanceOutcome<Action>[];
  informationSet(state: State): string;
  evaluateStrategy?(strategy: BehavioralStrategy): [number, number];
  bestResponseValue?(player: Player, strategy: BehavioralStrategy): number;
}

export type AlgorithmName = "vanilla-cfr" | "cfr-plus" | "dcfr";

export type DcfrParameters = {
  alpha: number;
  beta: number;
  gamma: number;
};

export type SolverConfiguration = {
  algorithm: AlgorithmName;
  seed: number;
  dcfr?: DcfrParameters;
  cfrPlusAveragingDelay?: number;
};

export type ConvergencePoint = {
  iteration: number;
  exploitability: number | null;
  nashConv: number | null;
  averagePositiveRegret: number;
  strategyDelta: number;
  elapsedMs: number;
  nodesVisited: number;
};

export type SolveOptions = {
  maxIterations: number;
  targetExploitability?: number;
  maxRuntimeMs?: number;
  metricInterval?: number;
};

export type SolveMetrics = {
  iteration: number;
  infosets: number;
  nodesVisited: number;
  exploitability: number | null;
  nashConv: number | null;
  averagePositiveRegret: number;
  strategyDelta: number;
  elapsedMs: number;
  stoppedBy: "iterations" | "exploitability" | "runtime";
  history: ConvergencePoint[];
};

export type SolveResult = {
  strategy: BehavioralStrategy;
  currentStrategy: BehavioralStrategy;
  metrics: SolveMetrics;
};

export type SerializedInfoSet = {
  key: string;
  actions: string[];
  regrets: number[];
  strategySum: number[];
};

export type SolverCheckpoint = {
  schemaVersion: 1;
  solverVersion: string;
  solveId: string;
  gameId: string;
  gameDefinitionHash: string;
  configurationHash: string;
  configuration: SolverConfiguration;
  iteration: number;
  nodesVisited: number;
  infosets: SerializedInfoSet[];
  convergenceHistory: ConvergencePoint[];
  createdAt: string;
};

export interface SolverAlgorithm {
  initialize(): void;
  iterate(): void;
  currentStrategy(): BehavioralStrategy;
  averageStrategy(): BehavioralStrategy;
  metrics(): SolveMetrics;
  solve(options: SolveOptions): SolveResult;
  checkpoint(): SolverCheckpoint;
  restore(checkpoint: SolverCheckpoint): void;
}
