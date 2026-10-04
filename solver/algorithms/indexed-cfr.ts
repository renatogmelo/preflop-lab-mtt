import { cfrPlusAveragingWeight, dcfrDiscountScales, DEFAULT_DCFR } from "./cfr";
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
  SolverAlgorithm,
  SolverCheckpoint,
  SolverConfiguration,
} from "../core/types";
import { CompiledNashConvEvaluator } from "../evaluation/compiled-analysis";
import { compileGameTree, type CompiledGameTree, type CompiledNode } from "../tree/compiled";

type IndexedInformationSet<Action extends string> = {
  key: string;
  actions: Action[];
  offset: number;
};

export type IndexedCompiledTree<Action extends string> = {
  kind: Uint8Array;
  actor: Int8Array;
  firstEdge: Uint32Array;
  edgeCount: Uint16Array;
  edgeChild: Uint32Array;
  edgeProbability: Float64Array;
  informationSet: Int32Array;
  terminalP0: Float64Array;
  terminalP1: Float64Array;
  informationSets: IndexedInformationSet<Action>[];
  totalInformationSetActions: number;
};

type TemporaryNode = {
  kind: 0 | 1 | 2;
  actor: number;
  children: number[];
  probabilities: number[];
  informationSet: number;
  utilities: [number, number];
};

export function compileIndexedTree<Action extends string>(
  compiled: CompiledGameTree<Action>,
): IndexedCompiledTree<Action> {
  const nodes: TemporaryNode[] = [];
  const informationSetIds = new Map<string, number>();
  const informationSets: Array<{ key: string; actions: Action[] }> = [];

  const visit = (node: CompiledNode<Action>): number => {
    const index = nodes.length;
    nodes.push({
      kind: 0,
      actor: -1,
      children: [],
      probabilities: [],
      informationSet: -1,
      utilities: [0, 0],
    });
    if (node.kind === "terminal") {
      nodes[index] = {
        kind: 0,
        actor: -1,
        children: [],
        probabilities: [],
        informationSet: -1,
        utilities: node.utilities,
      };
      return index;
    }
    if (node.kind === "chance") {
      nodes[index] = {
        kind: 1,
        actor: -1,
        children: node.outcomes.map((outcome) => visit(outcome.child)),
        probabilities: node.outcomes.map((outcome) => outcome.probability),
        informationSet: -1,
        utilities: [0, 0],
      };
      return index;
    }
    let informationSet = informationSetIds.get(node.informationSet);
    if (informationSet === undefined) {
      informationSet = informationSets.length;
      informationSetIds.set(node.informationSet, informationSet);
      informationSets.push({ key: node.informationSet, actions: [...node.actions] });
    } else if (informationSets[informationSet].actions.join("|") !== node.actions.join("|")) {
      throw new Error(`Information set ${node.informationSet} changed legal actions during indexed compilation.`);
    }
    nodes[index] = {
      kind: 2,
      actor: node.player,
      children: node.children.map(visit),
      probabilities: [],
      informationSet,
      utilities: [0, 0],
    };
    return index;
  };
  visit(compiled.root);

  let actionOffset = 0;
  const indexedInformationSets = informationSets.map((entry) => {
    const result = { ...entry, offset: actionOffset };
    actionOffset += entry.actions.length;
    return result;
  });
  const edgeTotal = nodes.reduce((sum, node) => sum + node.children.length, 0);
  const result: IndexedCompiledTree<Action> = {
    kind: new Uint8Array(nodes.length),
    actor: new Int8Array(nodes.length),
    firstEdge: new Uint32Array(nodes.length),
    edgeCount: new Uint16Array(nodes.length),
    edgeChild: new Uint32Array(edgeTotal),
    edgeProbability: new Float64Array(edgeTotal),
    informationSet: new Int32Array(nodes.length),
    terminalP0: new Float64Array(nodes.length),
    terminalP1: new Float64Array(nodes.length),
    informationSets: indexedInformationSets,
    totalInformationSetActions: actionOffset,
  };
  result.informationSet.fill(-1);
  let edge = 0;
  nodes.forEach((node, index) => {
    result.kind[index] = node.kind;
    result.actor[index] = node.actor;
    result.firstEdge[index] = edge;
    result.edgeCount[index] = node.children.length;
    result.informationSet[index] = node.informationSet;
    result.terminalP0[index] = node.utilities[0];
    result.terminalP1[index] = node.utilities[1];
    node.children.forEach((child, childIndex) => {
      result.edgeChild[edge] = child;
      result.edgeProbability[edge] = node.probabilities[childIndex] ?? 0;
      edge += 1;
    });
  });
  return result;
}

function strategyPair(regrets: Float64Array, offset: number) {
  const first = Math.max(0, regrets[offset]);
  const second = Math.max(0, regrets[offset + 1]);
  const total = first + second;
  return total > 1e-15 ? [first / total, second / total] as const : [0.5, 0.5] as const;
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

export class IndexedCfrSolver<State, Action extends string> implements SolverAlgorithm {
  readonly compiledTree: CompiledGameTree<Action>;
  readonly indexed: IndexedCompiledTree<Action>;
  readonly regrets: Float64Array;
  readonly strategySums: Float64Array;
  readonly gameDefinitionHash: string;
  readonly configurationHash: string;
  readonly solveId: string;
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
      traversalEngine: "indexed-f64-v1",
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

  private actionProbability(offset: number, count: number, index: number) {
    if (count === 2) return strategyPair(this.regrets, offset)[index];
    let total = 0;
    for (let action = 0; action < count; action += 1) total += Math.max(0, this.regrets[offset + action]);
    return total > 1e-15 ? Math.max(0, this.regrets[offset + index]) / total : 1 / count;
  }

  private traverse(
    node: number,
    updatingPlayer: Player,
    reach0: number,
    reach1: number,
    chanceReach: number,
    averageWeight: number,
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
        );
      }
      return result;
    }

    const actor = this.indexed.actor[node] as Player;
    const informationSet = this.indexed.informationSets[this.indexed.informationSet[node]];
    const offset = informationSet.offset;
    if (count === 2) {
      const [strategy0, strategy1] = strategyPair(this.regrets, offset);
      const utility0 = this.traverse(
        this.indexed.edgeChild[firstEdge],
        updatingPlayer,
        actor === 0 ? reach0 * strategy0 : reach0,
        actor === 1 ? reach1 * strategy0 : reach1,
        chanceReach,
        averageWeight,
      );
      const utility1 = this.traverse(
        this.indexed.edgeChild[firstEdge + 1],
        updatingPlayer,
        actor === 0 ? reach0 * strategy1 : reach0,
        actor === 1 ? reach1 * strategy1 : reach1,
        chanceReach,
        averageWeight,
      );
      const nodeUtility = strategy0 * utility0 + strategy1 * utility1;
      if (actor === updatingPlayer) {
        const counterfactualReach = chanceReach * (actor === 0 ? reach1 : reach0);
        const ownReach = chanceReach * (actor === 0 ? reach0 : reach1);
        const next0 = this.regrets[offset] + counterfactualReach * (utility0 - nodeUtility);
        const next1 = this.regrets[offset + 1] + counterfactualReach * (utility1 - nodeUtility);
        this.regrets[offset] = this.configuration.algorithm === "cfr-plus" ? Math.max(0, next0) : next0;
        this.regrets[offset + 1] = this.configuration.algorithm === "cfr-plus" ? Math.max(0, next1) : next1;
        this.strategySums[offset] += averageWeight * ownReach * strategy0;
        this.strategySums[offset + 1] += averageWeight * ownReach * strategy1;
      }
      return nodeUtility;
    }

    const strategies = new Float64Array(count);
    const utilities = new Float64Array(count);
    let nodeUtility = 0;
    for (let index = 0; index < count; index += 1) {
      const strategy = this.actionProbability(offset, count, index);
      strategies[index] = strategy;
      utilities[index] = this.traverse(
        this.indexed.edgeChild[firstEdge + index],
        updatingPlayer,
        actor === 0 ? reach0 * strategy : reach0,
        actor === 1 ? reach1 * strategy : reach1,
        chanceReach,
        averageWeight,
      );
      nodeUtility += strategy * utilities[index];
    }
    if (actor === updatingPlayer) {
      const counterfactualReach = chanceReach * (actor === 0 ? reach1 : reach0);
      const ownReach = chanceReach * (actor === 0 ? reach0 : reach1);
      for (let index = 0; index < count; index += 1) {
        const next = this.regrets[offset + index] + counterfactualReach * (utilities[index] - nodeUtility);
        this.regrets[offset + index] = this.configuration.algorithm === "cfr-plus" ? Math.max(0, next) : next;
        this.strategySums[offset + index] += averageWeight * ownReach * strategies[index];
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
    this.traverse(0, 0, 1, 1, 1, averageWeight);
    this.traverse(0, 1, 1, 1, 1, averageWeight);
    this.iterationCount = nextIteration;
    for (let index = 0; index < this.regrets.length; index += 1) {
      if (!Number.isFinite(this.regrets[index]) || !Number.isFinite(this.strategySums[index])) {
        throw new Error("Indexed CFR encountered NaN or Infinity.");
      }
    }
  }

  currentStrategy(): BehavioralStrategy {
    return Object.fromEntries(this.indexed.informationSets.map((info) => [
      info.key,
      Object.fromEntries(info.actions.map((action, index) => [
        action,
        this.actionProbability(info.offset, info.actions.length, index),
      ])),
    ]));
  }

  averageStrategy(): BehavioralStrategy {
    return Object.fromEntries(this.indexed.informationSets.map((info) => {
      let total = 0;
      for (let index = 0; index < info.actions.length; index += 1) total += this.strategySums[info.offset + index];
      return [
        info.key,
        Object.fromEntries(info.actions.map((action, index) => [
          action,
          total > 1e-15
            ? this.strategySums[info.offset + index] / total
            : this.actionProbability(info.offset, info.actions.length, index),
        ])),
      ];
    }));
  }

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
    if (checkpoint.infosets.length !== this.indexed.informationSets.length) throw new Error("Checkpoint information-set count mismatch.");
    checkpoint.infosets.forEach((stored) => {
      const info = this.indexed.informationSets.find((candidate) => candidate.key === stored.key);
      if (!info || info.actions.join("|") !== stored.actions.join("|")) throw new Error(`Checkpoint information set ${stored.key} mismatch.`);
      stored.actions.forEach((_, index) => {
        const regret = stored.regrets[index];
        const strategySum = stored.strategySum[index];
        if (!Number.isFinite(regret) || !Number.isFinite(strategySum)) throw new Error("Checkpoint contains NaN or Infinity.");
        this.regrets[info.offset + index] = regret;
        this.strategySums[info.offset + index] = strategySum;
      });
    });
    this.iterationCount = checkpoint.iteration;
    this.nodesVisited = checkpoint.nodesVisited;
    this.convergenceHistory = [...checkpoint.convergenceHistory];
    this.previousMetricStrategy = this.averageStrategy();
    this.startedAt = Date.now();
  }
}
