import {
  type BehavioralStrategy,
  type ConvergencePoint,
  type ExtensiveGame,
  type Player,
  type SolveMetrics,
  type SolveOptions,
  type SolveResult,
  type SolverAlgorithm,
  type SolverCheckpoint,
  type SolverConfiguration,
} from "../core/types";
import { hashValue } from "../core/stable";
import { SOLVER_VERSION } from "../core/version";

type InfoSetState<Action extends string> = {
  actions: Action[];
  regrets: number[];
  strategySum: number[];
};

const DEFAULT_DCFR = { alpha: 1.5, beta: 0, gamma: 2 };

function assertFinite(values: number[], label: string) {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Numerical failure: ${label} contains NaN or Infinity.`);
  }
}

function strategyFromRegrets(regrets: number[]) {
  const positive = regrets.map((value) => Math.max(0, value));
  const total = positive.reduce((sum, value) => sum + value, 0);
  return total > 1e-15
    ? positive.map((value) => value / total)
    : positive.map(() => 1 / positive.length);
}

function maximumStrategyDelta(previous: BehavioralStrategy, current: BehavioralStrategy) {
  let delta = 0;
  Object.entries(current).forEach(([key, actions]) => {
    Object.entries(actions).forEach(([action, frequency]) => {
      delta = Math.max(delta, Math.abs(frequency - (previous[key]?.[action] ?? 0)));
    });
  });
  return delta;
}

export class CfrSolver<State, Action extends string> implements SolverAlgorithm {
  protected readonly infosets = new Map<string, InfoSetState<Action>>();
  protected iterationCount = 0;
  protected nodesVisited = 0;
  protected convergenceHistory: ConvergencePoint[] = [];
  protected startedAt = 0;
  protected previousMetricStrategy: BehavioralStrategy = {};
  readonly gameDefinitionHash: string;
  readonly configurationHash: string;
  readonly solveId: string;

  constructor(
    protected readonly game: ExtensiveGame<State, Action>,
    readonly configuration: SolverConfiguration,
  ) {
    this.gameDefinitionHash = hashValue(game.definition);
    this.configurationHash = hashValue(configuration);
    this.solveId = hashValue({
      gameDefinition: game.definition,
      configuration,
      solverVersion: SOLVER_VERSION,
    });
  }

  initialize() {
    this.infosets.clear();
    this.iterationCount = 0;
    this.nodesVisited = 0;
    this.convergenceHistory = [];
    this.previousMetricStrategy = {};
    this.startedAt = Date.now();
  }

  protected infoSet(key: string, actions: readonly Action[]) {
    const existing = this.infosets.get(key);
    if (existing) {
      if (existing.actions.join("|") !== actions.join("|")) {
        throw new Error(`Information set ${key} changed its legal actions.`);
      }
      return existing;
    }
    if (!actions.length) throw new Error(`Information set ${key} has no legal actions.`);
    const created: InfoSetState<Action> = {
      actions: [...actions],
      regrets: actions.map(() => 0),
      strategySum: actions.map(() => 0),
    };
    this.infosets.set(key, created);
    return created;
  }

  protected discountDcfr(nextIteration: number) {
    if (this.configuration.algorithm !== "dcfr") return;
    const { alpha, beta, gamma } = this.configuration.dcfr ?? DEFAULT_DCFR;
    const positiveScale = Math.pow(nextIteration, alpha) / (Math.pow(nextIteration, alpha) + 1);
    const negativeScale = Math.pow(nextIteration, beta) / (Math.pow(nextIteration, beta) + 1);
    const strategyScale = Math.pow((nextIteration - 1) / nextIteration, gamma);
    this.infosets.forEach((state) => {
      state.regrets = state.regrets.map((value) => value * (value >= 0 ? positiveScale : negativeScale));
      state.strategySum = state.strategySum.map((value) => value * strategyScale);
    });
  }

  protected averagingWeight(nextIteration: number) {
    if (this.configuration.algorithm !== "cfr-plus") return 1;
    const delay = this.configuration.cfrPlusAveragingDelay ?? 0;
    return Math.max(0, nextIteration - delay);
  }

  protected traverse(
    state: State,
    updatingPlayer: Player,
    playerReach: [number, number],
    chanceReach: number,
    averageWeight: number,
  ): number {
    this.nodesVisited += 1;
    if (this.game.isTerminal(state)) return this.game.utility(state, updatingPlayer);
    const actor = this.game.actor(state);
    if (actor === null) throw new Error("Non-terminal state has no actor.");
    if (actor === "chance") {
      const outcomes = this.game.chanceOutcomes(state);
      const probabilitySum = outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
      if (Math.abs(probabilitySum - 1) > 1e-9) throw new Error("Chance probabilities must sum to one.");
      return outcomes.reduce(
        (value, outcome) => value + outcome.probability * this.traverse(
          this.game.next(state, outcome.action),
          updatingPlayer,
          playerReach,
          chanceReach * outcome.probability,
          averageWeight,
        ),
        0,
      );
    }

    const actions = this.game.actions(state);
    const key = this.game.informationSet(state);
    const info = this.infoSet(key, actions);
    const strategy = strategyFromRegrets(info.regrets);
    const actionUtilities = actions.map((action, index) => {
      const nextReach: [number, number] = [...playerReach];
      nextReach[actor] *= strategy[index];
      return this.traverse(this.game.next(state, action), updatingPlayer, nextReach, chanceReach, averageWeight);
    });
    const nodeUtility = actionUtilities.reduce((sum, utility, index) => sum + strategy[index] * utility, 0);

    if (actor === updatingPlayer) {
      const counterfactualReach = chanceReach * playerReach[actor === 0 ? 1 : 0];
      const ownReach = chanceReach * playerReach[actor];
      info.regrets = info.regrets.map((regret, index) => {
        const next = regret + counterfactualReach * (actionUtilities[index] - nodeUtility);
        return this.configuration.algorithm === "cfr-plus" ? Math.max(0, next) : next;
      });
      info.strategySum = info.strategySum.map(
        (sum, index) => sum + averageWeight * ownReach * strategy[index],
      );
      assertFinite(info.regrets, `${key} regrets`);
      assertFinite(info.strategySum, `${key} strategy sums`);
    }
    return nodeUtility;
  }

  iterate() {
    if (!this.startedAt) this.startedAt = Date.now();
    const nextIteration = this.iterationCount + 1;
    this.discountDcfr(nextIteration);
    const averageWeight = this.averagingWeight(nextIteration);
    this.traverse(this.game.initialState(), 0, [1, 1], 1, averageWeight);
    this.traverse(this.game.initialState(), 1, [1, 1], 1, averageWeight);
    this.iterationCount = nextIteration;
  }

  currentStrategy(): BehavioralStrategy {
    return Object.fromEntries([...this.infosets].map(([key, info]) => [
      key,
      Object.fromEntries(info.actions.map((action, index) => [action, strategyFromRegrets(info.regrets)[index]])),
    ]));
  }

  averageStrategy(): BehavioralStrategy {
    return Object.fromEntries([...this.infosets].map(([key, info]) => {
      const total = info.strategySum.reduce((sum, value) => sum + value, 0);
      const strategy = total > 1e-15
        ? info.strategySum.map((value) => value / total)
        : strategyFromRegrets(info.regrets);
      return [key, Object.fromEntries(info.actions.map((action, index) => [action, strategy[index]]))];
    }));
  }

  protected convergencePoint(): ConvergencePoint {
    const strategy = this.averageStrategy();
    const nashConv = this.game.bestResponseValue
      ? this.game.bestResponseValue(0, strategy) + this.game.bestResponseValue(1, strategy)
      : null;
    const positiveRegrets = [...this.infosets.values()].flatMap((info) => info.regrets.map((value) => Math.max(0, value)));
    const point: ConvergencePoint = {
      iteration: this.iterationCount,
      exploitability: nashConv === null ? null : nashConv / 2,
      nashConv,
      averagePositiveRegret: positiveRegrets.length
        ? positiveRegrets.reduce((sum, value) => sum + value, 0) / positiveRegrets.length / Math.max(1, this.iterationCount)
        : 0,
      strategyDelta: maximumStrategyDelta(this.previousMetricStrategy, strategy),
      elapsedMs: Date.now() - this.startedAt,
      nodesVisited: this.nodesVisited,
    };
    this.previousMetricStrategy = strategy;
    return point;
  }

  metrics(): SolveMetrics {
    const latest = this.convergenceHistory.at(-1) ?? this.convergencePoint();
    return {
      iteration: this.iterationCount,
      infosets: this.infosets.size,
      nodesVisited: this.nodesVisited,
      exploitability: latest.exploitability,
      nashConv: latest.nashConv,
      averagePositiveRegret: latest.averagePositiveRegret,
      strategyDelta: latest.strategyDelta,
      elapsedMs: Date.now() - this.startedAt,
      stoppedBy: "iterations",
      history: [...this.convergenceHistory],
    };
  }

  solve(options: SolveOptions): SolveResult {
    if (!this.startedAt) this.initialize();
    const metricInterval = Math.max(1, options.metricInterval ?? Math.ceil(options.maxIterations / 20));
    let stoppedBy: SolveMetrics["stoppedBy"] = "iterations";
    while (this.iterationCount < options.maxIterations) {
      this.iterate();
      const shouldMeasure = this.iterationCount % metricInterval === 0 || this.iterationCount === options.maxIterations;
      if (shouldMeasure) {
        const point = this.convergencePoint();
        this.convergenceHistory.push(point);
        if (options.targetExploitability !== undefined && point.exploitability !== null && point.exploitability <= options.targetExploitability) {
          stoppedBy = "exploitability";
          break;
        }
      }
      if (options.maxRuntimeMs !== undefined && Date.now() - this.startedAt >= options.maxRuntimeMs) {
        stoppedBy = "runtime";
        if (!shouldMeasure) this.convergenceHistory.push(this.convergencePoint());
        break;
      }
    }
    const metrics = this.metrics();
    metrics.stoppedBy = stoppedBy;
    return { strategy: this.averageStrategy(), currentStrategy: this.currentStrategy(), metrics };
  }

  checkpoint(): SolverCheckpoint {
    return {
      schemaVersion: 1,
      solverVersion: SOLVER_VERSION,
      solveId: this.solveId,
      gameId: this.game.id,
      gameDefinitionHash: this.gameDefinitionHash,
      configurationHash: this.configurationHash,
      configuration: this.configuration,
      iteration: this.iterationCount,
      nodesVisited: this.nodesVisited,
      infosets: [...this.infosets].map(([key, info]) => ({
        key,
        actions: [...info.actions],
        regrets: [...info.regrets],
        strategySum: [...info.strategySum],
      })),
      convergenceHistory: [...this.convergenceHistory],
      createdAt: new Date().toISOString(),
    };
  }

  restore(checkpoint: SolverCheckpoint) {
    if (checkpoint.schemaVersion !== 1 || checkpoint.solverVersion !== SOLVER_VERSION) throw new Error("Unsupported checkpoint version.");
    if (checkpoint.gameId !== this.game.id || checkpoint.gameDefinitionHash !== this.gameDefinitionHash) throw new Error("Checkpoint belongs to a different game definition.");
    if (checkpoint.configurationHash !== this.configurationHash || checkpoint.solveId !== this.solveId) throw new Error("Checkpoint belongs to a different solver configuration.");
    this.infosets.clear();
    checkpoint.infosets.forEach((info) => {
      assertFinite(info.regrets, `${info.key} checkpoint regrets`);
      assertFinite(info.strategySum, `${info.key} checkpoint strategy sums`);
      this.infosets.set(info.key, {
        actions: info.actions as Action[],
        regrets: [...info.regrets],
        strategySum: [...info.strategySum],
      });
    });
    this.iterationCount = checkpoint.iteration;
    this.nodesVisited = checkpoint.nodesVisited;
    this.convergenceHistory = [...checkpoint.convergenceHistory];
    this.previousMetricStrategy = this.averageStrategy();
    this.startedAt = Date.now();
  }
}

export class VanillaCfr<State, Action extends string> extends CfrSolver<State, Action> {
  constructor(game: ExtensiveGame<State, Action>, configuration: Omit<SolverConfiguration, "algorithm"> = { seed: 1 }) {
    super(game, { ...configuration, algorithm: "vanilla-cfr" });
  }
}

export class CfrPlus<State, Action extends string> extends CfrSolver<State, Action> {
  constructor(game: ExtensiveGame<State, Action>, configuration: Omit<SolverConfiguration, "algorithm"> = { seed: 1 }) {
    super(game, { ...configuration, algorithm: "cfr-plus" });
  }
}

export class Dcfr<State, Action extends string> extends CfrSolver<State, Action> {
  constructor(game: ExtensiveGame<State, Action>, configuration: Omit<SolverConfiguration, "algorithm"> = { seed: 1 }) {
    super(game, { dcfr: DEFAULT_DCFR, ...configuration, algorithm: "dcfr" });
  }
}
