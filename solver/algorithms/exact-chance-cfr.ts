import { cfrPlusAveragingWeight, dcfrDiscountScales, DEFAULT_DCFR } from "./cfr";
import { compileIndexedTree, type IndexedCompiledTree } from "./indexed-cfr";
import { hashValue } from "../core/stable";
import { SOLVER_VERSION } from "../core/version";
import type {
  BehavioralStrategy,
  ConvergencePoint,
  ExtensiveGame,
  Player,
  SolveMetrics,
  SolveOptions,
  SolveResult,
  SolverCheckpoint,
  SolverConfiguration,
} from "../core/types";
import { CompiledNashConvEvaluator } from "../evaluation/compiled-analysis";
import { compileGameTree, type CompiledGameTree } from "../tree/compiled";

function maximumStrategyDelta(previous: BehavioralStrategy, current: BehavioralStrategy) {
  let delta = 0;
  Object.entries(current).forEach(([key, actions]) => {
    Object.entries(actions).forEach(([action, frequency]) => {
      delta = Math.max(delta, Math.abs(frequency - (previous[key]?.[action] ?? 0)));
    });
  });
  return delta;
}

export class ExactChanceCfrSolver<State, Action extends string> {
  readonly compiledTree: CompiledGameTree<Action>;
  readonly indexed: IndexedCompiledTree<Action>;
  readonly regrets: Float64Array;
  readonly strategySums: Float64Array;
  readonly solveId: string;
  readonly gameDefinitionHash: string;
  readonly configurationHash: string;
  private readonly evaluator: CompiledNashConvEvaluator<Action>;
  private iterationCount = 0;
  private nodesVisited = 0;
  private convergenceHistory: ConvergencePoint[] = [];
  private previousMetricStrategy: BehavioralStrategy = {};
  private startedAt = 0;

  constructor(
    readonly game: ExtensiveGame<State, Action>,
    readonly configuration: SolverConfiguration,
    compiledTree?: CompiledGameTree<Action>,
  ) {
    this.compiledTree = compiledTree ?? compileGameTree(game);
    this.indexed = compileIndexedTree(this.compiledTree);
    this.regrets = new Float64Array(this.indexed.totalInformationSetActions);
    this.strategySums = new Float64Array(this.indexed.totalInformationSetActions);
    this.evaluator = new CompiledNashConvEvaluator(this.compiledTree.root);
    this.gameDefinitionHash = hashValue(game.definition);
    this.configurationHash = hashValue(configuration);
    this.solveId = hashValue({
      gameDefinition: game.definition,
      configuration,
      solverVersion: SOLVER_VERSION,
      traversalEngine: "exact-chance-synchronous-f64-v1",
    });
  }

  initialize() {
    this.regrets.fill(0);
    this.strategySums.fill(0);
    this.iterationCount = 0;
    this.nodesVisited = 0;
    this.convergenceHistory = [];
    this.previousMetricStrategy = {};
    this.startedAt = Date.now();
  }

  private actionProbability(regrets: Float64Array, offset: number, count: number, index: number) {
    let total = 0;
    for (let action = 0; action < count; action += 1) total += Math.max(0, regrets[offset + action]);
    return total > 1e-15 ? Math.max(0, regrets[offset + index]) / total : 1 / count;
  }

  private traverse(
    node: number,
    updatingPlayer: Player,
    reach0: number,
    reach1: number,
    chanceReach: number,
    averageWeight: number,
    frozenRegrets: Float64Array,
    regretDelta: Float64Array,
    strategyDelta: Float64Array,
  ): number {
    this.nodesVisited += 1;
    const kind = this.indexed.kind[node];
    if (kind === 0) return updatingPlayer === 0 ? this.indexed.terminalP0[node] : this.indexed.terminalP1[node];
    const firstEdge = this.indexed.firstEdge[node];
    const count = this.indexed.edgeCount[node];
    if (kind === 1) {
      let result = 0;
      for (let index = 0; index < count; index += 1) {
        const edge = firstEdge + index;
        const probability = this.indexed.edgeProbability[edge];
        result += probability * this.traverse(
          this.indexed.edgeChild[edge],
          updatingPlayer,
          reach0,
          reach1,
          chanceReach * probability,
          averageWeight,
          frozenRegrets,
          regretDelta,
          strategyDelta,
        );
      }
      return result;
    }
    const actor = this.indexed.actor[node] as Player;
    const informationSet = this.indexed.informationSets[this.indexed.informationSet[node]];
    const offset = informationSet.offset;
    const strategies = new Float64Array(count);
    const utilities = new Float64Array(count);
    let nodeUtility = 0;
    for (let index = 0; index < count; index += 1) {
      const strategy = this.actionProbability(frozenRegrets, offset, count, index);
      strategies[index] = strategy;
      utilities[index] = this.traverse(
        this.indexed.edgeChild[firstEdge + index],
        updatingPlayer,
        actor === 0 ? reach0 * strategy : reach0,
        actor === 1 ? reach1 * strategy : reach1,
        chanceReach,
        averageWeight,
        frozenRegrets,
        regretDelta,
        strategyDelta,
      );
      nodeUtility += strategy * utilities[index];
    }
    if (actor === updatingPlayer) {
      const counterfactualReach = chanceReach * (actor === 0 ? reach1 : reach0);
      const ownReach = chanceReach * (actor === 0 ? reach0 : reach1);
      for (let index = 0; index < count; index += 1) {
        regretDelta[offset + index] += counterfactualReach * (utilities[index] - nodeUtility);
        strategyDelta[offset + index] += averageWeight * ownReach * strategies[index];
      }
    }
    return nodeUtility;
  }

  private discount(nextIteration: number) {
    if (this.configuration.algorithm !== "dcfr") return;
    const scales = dcfrDiscountScales(nextIteration, this.configuration.dcfr ?? DEFAULT_DCFR);
    for (let index = 0; index < this.regrets.length; index += 1) {
      this.regrets[index] *= this.regrets[index] >= 0 ? scales.positive : scales.negative;
      this.strategySums[index] *= scales.strategy;
    }
  }

  iterate() {
    if (!this.startedAt) this.startedAt = Date.now();
    const nextIteration = this.iterationCount + 1;
    this.discount(nextIteration);
    const averageWeight = this.configuration.algorithm === "cfr-plus"
      ? cfrPlusAveragingWeight(nextIteration, this.configuration.cfrPlusAveragingDelay ?? 0)
      : 1;
    for (const player of [0, 1] as const) {
      const frozenRegrets = this.regrets.slice();
      const regretDelta = new Float64Array(this.regrets.length);
      const strategyDelta = new Float64Array(this.strategySums.length);
      this.traverse(0, player, 1, 1, 1, averageWeight, frozenRegrets, regretDelta, strategyDelta);
      for (let index = 0; index < this.regrets.length; index += 1) {
        const next = this.regrets[index] + regretDelta[index];
        this.regrets[index] = this.configuration.algorithm === "cfr-plus" ? Math.max(0, next) : next;
        this.strategySums[index] += strategyDelta[index];
      }
    }
    this.iterationCount = nextIteration;
    for (let index = 0; index < this.regrets.length; index += 1) {
      if (!Number.isFinite(this.regrets[index]) || !Number.isFinite(this.strategySums[index])) {
        throw new Error("Exact CFR encountered NaN or Infinity.");
      }
    }
  }

  private strategy(average: boolean): BehavioralStrategy {
    return Object.fromEntries(this.indexed.informationSets.map((info) => {
      let total = 0;
      if (average) {
        for (let index = 0; index < info.actions.length; index += 1) total += this.strategySums[info.offset + index];
      }
      return [info.key, Object.fromEntries(info.actions.map((action, index) => [
        action,
        average && total > 1e-15
          ? this.strategySums[info.offset + index] / total
          : this.actionProbability(this.regrets, info.offset, info.actions.length, index),
      ]))];
    }));
  }

  currentStrategy() { return this.strategy(false); }
  averageStrategy() { return this.strategy(true); }

  private convergencePoint(): ConvergencePoint {
    const strategy = this.averageStrategy();
    const evaluated = this.configuration.exactMetrics === false ? null : this.evaluator.evaluate(strategy);
    const positive = this.regrets.reduce((sum, value) => sum + Math.max(0, value), 0);
    const point: ConvergencePoint = {
      iteration: this.iterationCount,
      exploitability: evaluated?.exploitability ?? null,
      nashConv: evaluated?.nashConv ?? null,
      averagePositiveRegret: positive / Math.max(1, this.regrets.length) / Math.max(1, this.iterationCount),
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
      infosets: this.indexed.informationSets.length,
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
    const interval = Math.max(1, options.metricInterval ?? Math.ceil(options.maxIterations / 20));
    let stoppedBy: SolveMetrics["stoppedBy"] = "iterations";
    while (this.iterationCount < options.maxIterations) {
      this.iterate();
      const measure = this.iterationCount % interval === 0 || this.iterationCount === options.maxIterations;
      if (measure) {
        const point = this.convergencePoint();
        this.convergenceHistory.push(point);
        if (options.targetExploitability !== undefined && point.exploitability !== null && point.exploitability <= options.targetExploitability) {
          stoppedBy = "exploitability";
          break;
        }
      }
      if (options.maxRuntimeMs !== undefined && Date.now() - this.startedAt >= options.maxRuntimeMs) {
        stoppedBy = "runtime";
        if (!measure) this.convergenceHistory.push(this.convergencePoint());
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
      infosets: this.indexed.informationSets.map((info) => ({
        key: info.key,
        actions: [...info.actions],
        regrets: info.actions.map((_, index) => this.regrets[info.offset + index]),
        strategySum: info.actions.map((_, index) => this.strategySums[info.offset + index]),
      })),
      convergenceHistory: [...this.convergenceHistory],
      createdAt: new Date().toISOString(),
    };
  }

  restore(checkpoint: SolverCheckpoint) {
    if (checkpoint.schemaVersion !== 1 || checkpoint.solverVersion !== SOLVER_VERSION) throw new Error("Unsupported checkpoint version.");
    if (checkpoint.gameId !== this.game.id || checkpoint.gameDefinitionHash !== this.gameDefinitionHash) throw new Error("Checkpoint belongs to another game.");
    if (checkpoint.configurationHash !== this.configurationHash) throw new Error("Checkpoint configuration mismatch.");
    checkpoint.infosets.forEach((stored) => {
      const info = this.indexed.informationSets.find((candidate) => candidate.key === stored.key);
      if (!info || info.actions.join("|") !== stored.actions.join("|")) throw new Error(`Checkpoint information set ${stored.key} mismatch.`);
      stored.actions.forEach((_, index) => {
        if (!Number.isFinite(stored.regrets[index]) || !Number.isFinite(stored.strategySum[index])) throw new Error("Checkpoint contains NaN or Infinity.");
        this.regrets[info.offset + index] = stored.regrets[index];
        this.strategySums[info.offset + index] = stored.strategySum[index];
      });
    });
    this.iterationCount = checkpoint.iteration;
    this.nodesVisited = checkpoint.nodesVisited;
    this.convergenceHistory = [...checkpoint.convergenceHistory];
    this.previousMetricStrategy = this.averageStrategy();
    this.startedAt = Date.now();
  }
}