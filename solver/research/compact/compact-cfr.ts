import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { cfrPlusAveragingWeight, dcfrDiscountScales, DEFAULT_DCFR } from "../../algorithms/cfr";
import type { AlgorithmName, BehavioralStrategy, Player, SolverConfiguration } from "../../core/types";
import { hashValue } from "../../core/stable";
import { SOLVER_VERSION } from "../../core/version";
import { CompactNashConvEvaluatorV2 } from "./compact-evaluation";
import { compactStrategyToBehavioral, type CompactIndexedTree, strategyArrayProbability } from "./compact-tree";
import type { CompactGameProvider } from "./provider";

export const COMPACT_CFR_VERSION = "compact-cfr-v0.9.0";
export const COMPACT_CHECKPOINT_SCHEMA = 4;

export type CompactMemorySnapshot = {
  label: string;
  elapsedMs: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  logicalBytes: number;
};

export type CompactConvergencePoint = {
  iteration: number;
  exploitability: number;
  nashConv: number;
  utilityP0: number;
  averagePositiveRegret: number;
  strategyDelta: number;
  elapsedMs: number;
  nodesVisited: number;
};

export type CompactCheckpointV4 = {
  schemaVersion: typeof COMPACT_CHECKPOINT_SCHEMA;
  solverVersion: string;
  compactSolverVersion: typeof COMPACT_CFR_VERSION;
  compactTreeVersion: string;
  solveId: string;
  gameId: string;
  gameHash: string;
  configurationHash: string;
  configuration: SolverConfiguration;
  iteration: number;
  nodesVisited: number;
  regrets: number[];
  strategySums: number[];
  convergenceHistory: CompactConvergencePoint[];
  semanticHash: string;
};

export type CompactSolveOptions = {
  maxIterations: number;
  maxRuntimeMs?: number;
  metricInterval?: number;
  collectExactMetrics?: boolean;
};

function hashFloatArrays(...arrays: Float64Array[]) {
  const hash = createHash("sha256");
  arrays.forEach((array) => hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)));
  return hash.digest("hex");
}

function assertFiniteArray(values: Float64Array, label: string) {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) throw new Error(`${label} contains NaN or Infinity at ${index}.`);
  }
}

function checkpointSemanticHash(
  checkpoint: Pick<CompactCheckpointV4, "solveId" | "gameHash" | "configurationHash" | "iteration" | "nodesVisited" | "convergenceHistory">,
  stateHash: string,
) {
  return hashValue({
    schemaVersion: COMPACT_CHECKPOINT_SCHEMA,
    solveId: checkpoint.solveId,
    gameHash: checkpoint.gameHash,
    configurationHash: checkpoint.configurationHash,
    iteration: checkpoint.iteration,
    nodesVisited: checkpoint.nodesVisited,
    stateHash,
    convergenceHistory: checkpoint.convergenceHistory.map((point) => ({ ...point, elapsedMs: undefined })),
  });
}

function compactSolveId(
  tree: Pick<CompactIndexedTree, "gameHash" | "version">,
  configuration: SolverConfiguration,
  solverVersion: string,
) {
  return hashValue({
    gameHash: tree.gameHash,
    configuration,
    solverVersion,
    compactSolverVersion: COMPACT_CFR_VERSION,
    treeVersion: tree.version,
  });
}

export class CompactCfrSolver {
  readonly regrets: Float64Array;
  readonly strategySums: Float64Array;
  readonly configurationHash: string;
  readonly solveId: string;
  private readonly evaluator: CompactNashConvEvaluatorV2;
  private iterationCount = 0;
  private nodesVisited = 0;
  private startedAt = 0;
  private previousMetricStrategy: Float64Array | null = null;
  private convergenceHistory: CompactConvergencePoint[] = [];
  private memorySnapshots: CompactMemorySnapshot[] = [];

  constructor(
    readonly provider: CompactGameProvider<number>,
    readonly tree: CompactIndexedTree,
    readonly configuration: SolverConfiguration,
  ) {
    if (configuration.algorithm !== "vanilla-cfr" && configuration.algorithm !== "cfr-plus" && configuration.algorithm !== "dcfr") {
      throw new Error(`Unsupported compact CFR algorithm ${configuration.algorithm as string}.`);
    }
    this.regrets = new Float64Array(tree.totalInformationSetActions);
    this.strategySums = new Float64Array(tree.totalInformationSetActions);
    this.evaluator = new CompactNashConvEvaluatorV2(tree);
    this.configurationHash = hashValue(configuration);
    this.solveId = compactSolveId(tree, configuration, SOLVER_VERSION);
  }

  initialize() {
    this.regrets.fill(0);
    this.strategySums.fill(0);
    this.iterationCount = 0;
    this.nodesVisited = 0;
    this.startedAt = performance.now();
    this.previousMetricStrategy = null;
    this.convergenceHistory = [];
    this.memorySnapshots = [];
    this.captureMemory("initialize");
  }

  get iteration() { return this.iterationCount; }
  get visitedNodes() { return this.nodesVisited; }
  get history() { return [...this.convergenceHistory]; }
  get snapshots() { return [...this.memorySnapshots]; }
  get stateHash() { return hashFloatArrays(this.regrets, this.strategySums); }
  get logicalStateBytes() { return this.regrets.byteLength + this.strategySums.byteLength; }

  captureMemory(label: string) {
    const usage = process.memoryUsage();
    const snapshot: CompactMemorySnapshot = {
      label,
      elapsedMs: this.startedAt ? performance.now() - this.startedAt : 0,
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
      logicalBytes: this.logicalStateBytes,
    };
    this.memorySnapshots.push(snapshot);
    return snapshot;
  }

  private actionProbability(informationSet: number, action: number) {
    const offset = this.tree.informationSetActionOffset[informationSet];
    const count = this.tree.informationSetActionCount[informationSet];
    let positive = 0;
    for (let index = 0; index < count; index += 1) positive += Math.max(0, this.regrets[offset + index]);
    return positive > 1e-15 ? Math.max(0, this.regrets[offset + action]) / positive : 1 / count;
  }

  private discount(nextIteration: number) {
    if (this.configuration.algorithm !== "dcfr") return;
    const scales = dcfrDiscountScales(nextIteration, this.configuration.dcfr ?? DEFAULT_DCFR);
    for (let index = 0; index < this.regrets.length; index += 1) {
      this.regrets[index] *= this.regrets[index] >= 0 ? scales.positive : scales.negative;
      this.strategySums[index] *= scales.strategy;
    }
  }

  private traverse(node: number, updatingPlayer: Player, reach0: number, reach1: number, chanceReach: number, averageWeight: number): number {
    this.nodesVisited += 1;
    const kind = this.tree.kind[node];
    if (kind === 0) return updatingPlayer === 0 ? this.tree.terminalP0[node] : -this.tree.terminalP0[node];
    const first = this.tree.firstChild[node];
    const count = this.tree.childCount[node];
    if (kind === 1) {
      let result = 0;
      for (let action = 0; action < count; action += 1) {
        const child = first + action;
        const probability = this.tree.edgeProbability[child];
        result += probability * this.traverse(child, updatingPlayer, reach0, reach1, chanceReach * probability, averageWeight);
      }
      return result;
    }

    const actor = this.tree.actor[node] as Player;
    const informationSet = this.tree.informationSet[node];
    const offset = this.tree.informationSetActionOffset[informationSet];
    const strategies = new Float64Array(count);
    const utilities = new Float64Array(count);
    let nodeUtility = 0;
    for (let action = 0; action < count; action += 1) {
      const strategy = this.actionProbability(informationSet, action);
      strategies[action] = strategy;
      utilities[action] = this.traverse(
        first + action,
        updatingPlayer,
        actor === 0 ? reach0 * strategy : reach0,
        actor === 1 ? reach1 * strategy : reach1,
        chanceReach,
        averageWeight,
      );
      nodeUtility += strategy * utilities[action];
    }
    if (actor === updatingPlayer) {
      const counterfactualReach = chanceReach * (actor === 0 ? reach1 : reach0);
      const ownReach = chanceReach * (actor === 0 ? reach0 : reach1);
      for (let action = 0; action < count; action += 1) {
        const next = this.regrets[offset + action] + counterfactualReach * (utilities[action] - nodeUtility);
        this.regrets[offset + action] = this.configuration.algorithm === "cfr-plus" ? Math.max(0, next) : next;
        this.strategySums[offset + action] += averageWeight * ownReach * strategies[action];
      }
    }
    return nodeUtility;
  }

  iterate() {
    if (!this.startedAt) this.initialize();
    const nextIteration = this.iterationCount + 1;
    this.discount(nextIteration);
    const averageWeight = this.configuration.algorithm === "cfr-plus"
      ? cfrPlusAveragingWeight(nextIteration, this.configuration.cfrPlusAveragingDelay ?? 0)
      : 1;
    this.traverse(this.tree.root, 0, 1, 1, 1, averageWeight);
    this.traverse(this.tree.root, 1, 1, 1, 1, averageWeight);
    this.iterationCount = nextIteration;
    assertFiniteArray(this.regrets, "Compact regrets");
    assertFiniteArray(this.strategySums, "Compact strategy sums");
  }

  currentStrategyArray() {
    const result = new Float64Array(this.tree.totalInformationSetActions);
    for (let info = 0; info < this.tree.informationSetActionCount.length; info += 1) {
      const offset = this.tree.informationSetActionOffset[info];
      const count = this.tree.informationSetActionCount[info];
      for (let action = 0; action < count; action += 1) result[offset + action] = this.actionProbability(info, action);
    }
    return result;
  }

  averageStrategyArray() {
    const result = new Float64Array(this.tree.totalInformationSetActions);
    for (let info = 0; info < this.tree.informationSetActionCount.length; info += 1) {
      const offset = this.tree.informationSetActionOffset[info];
      const count = this.tree.informationSetActionCount[info];
      let total = 0;
      for (let action = 0; action < count; action += 1) total += this.strategySums[offset + action];
      for (let action = 0; action < count; action += 1) {
        result[offset + action] = total > 1e-15
          ? this.strategySums[offset + action] / total
          : this.actionProbability(info, action);
      }
    }
    return result;
  }

  currentStrategy(): BehavioralStrategy {
    return compactStrategyToBehavioral(this.provider, this.tree, this.currentStrategyArray());
  }

  averageStrategy(): BehavioralStrategy {
    return compactStrategyToBehavioral(this.provider, this.tree, this.averageStrategyArray());
  }

  measure(): CompactConvergencePoint {
    const strategy = this.averageStrategyArray();
    const evaluation = this.evaluator.evaluate(strategyArrayProbability(this.tree, strategy));
    let strategyDelta = 0;
    if (this.previousMetricStrategy) {
      for (let index = 0; index < strategy.length; index += 1) {
        strategyDelta = Math.max(strategyDelta, Math.abs(strategy[index] - this.previousMetricStrategy[index]));
      }
    }
    let positive = 0;
    for (const regret of this.regrets) positive += Math.max(0, regret);
    const point: CompactConvergencePoint = {
      iteration: this.iterationCount,
      exploitability: evaluation.exploitability,
      nashConv: evaluation.nashConv,
      utilityP0: evaluation.utilities[0],
      averagePositiveRegret: positive / Math.max(1, this.regrets.length) / Math.max(1, this.iterationCount),
      strategyDelta,
      elapsedMs: performance.now() - this.startedAt,
      nodesVisited: this.nodesVisited,
    };
    this.previousMetricStrategy = strategy;
    this.convergenceHistory.push(point);
    return point;
  }

  solve(options: CompactSolveOptions) {
    if (!this.startedAt) this.initialize();
    const interval = Math.max(1, options.metricInterval ?? options.maxIterations);
    let stoppedBy: "iterations" | "runtime" = "iterations";
    while (this.iterationCount < options.maxIterations) {
      this.iterate();
      if (options.collectExactMetrics !== false && (this.iterationCount % interval === 0 || this.iterationCount === options.maxIterations)) this.measure();
      if (options.maxRuntimeMs !== undefined && performance.now() - this.startedAt >= options.maxRuntimeMs) {
        stoppedBy = "runtime";
        break;
      }
    }
    this.captureMemory("solve-end");
    return {
      stoppedBy,
      iteration: this.iterationCount,
      nodesVisited: this.nodesVisited,
      stateHash: this.stateHash,
      history: this.history,
      memorySnapshots: this.snapshots,
    };
  }

  checkpoint(): CompactCheckpointV4 {
    const checkpoint: CompactCheckpointV4 = {
      schemaVersion: COMPACT_CHECKPOINT_SCHEMA,
      solverVersion: SOLVER_VERSION,
      compactSolverVersion: COMPACT_CFR_VERSION,
      compactTreeVersion: this.tree.version,
      solveId: this.solveId,
      gameId: this.tree.gameId,
      gameHash: this.tree.gameHash,
      configurationHash: this.configurationHash,
      configuration: this.configuration,
      iteration: this.iterationCount,
      nodesVisited: this.nodesVisited,
      regrets: Array.from(this.regrets),
      strategySums: Array.from(this.strategySums),
      convergenceHistory: [...this.convergenceHistory],
      semanticHash: "",
    };
    checkpoint.semanticHash = checkpointSemanticHash(checkpoint, this.stateHash);
    return checkpoint;
  }

  restore(checkpoint: CompactCheckpointV4) {
    if (checkpoint.schemaVersion !== COMPACT_CHECKPOINT_SCHEMA || checkpoint.compactSolverVersion !== COMPACT_CFR_VERSION) throw new Error("Unsupported compact checkpoint version.");
    if (checkpoint.compactTreeVersion !== this.tree.version || checkpoint.gameHash !== this.tree.gameHash || checkpoint.gameId !== this.tree.gameId) throw new Error("Compact checkpoint belongs to another game.");
    const compatibleSolverVersions = new Set(["0.9.0", SOLVER_VERSION]);
    if (!compatibleSolverVersions.has(checkpoint.solverVersion)) throw new Error("Unsupported compact checkpoint solver version.");
    const expectedSolveId = compactSolveId(this.tree, this.configuration, checkpoint.solverVersion);
    if (checkpoint.configurationHash !== this.configurationHash || checkpoint.solveId !== expectedSolveId) throw new Error("Compact checkpoint configuration mismatch.");
    if (checkpoint.regrets.length !== this.regrets.length || checkpoint.strategySums.length !== this.strategySums.length) throw new Error("Compact checkpoint state length mismatch.");
    this.regrets.set(checkpoint.regrets);
    this.strategySums.set(checkpoint.strategySums);
    assertFiniteArray(this.regrets, "Checkpoint regrets");
    assertFiniteArray(this.strategySums, "Checkpoint strategy sums");
    if (checkpoint.semanticHash !== checkpointSemanticHash(checkpoint, this.stateHash)) throw new Error("Compact checkpoint semantic hash mismatch.");
    this.iterationCount = checkpoint.iteration;
    this.nodesVisited = checkpoint.nodesVisited;
    this.convergenceHistory = [...checkpoint.convergenceHistory];
    this.previousMetricStrategy = this.averageStrategyArray();
    this.startedAt = performance.now();
    this.memorySnapshots = [];
    this.captureMemory("restore");
  }

  restoreNumericState(state: {
    iteration: number;
    nodesVisited: number;
    regrets: Float64Array;
    strategySums: Float64Array;
  }) {
    if (!Number.isInteger(state.iteration) || state.iteration < 0) throw new Error("Invalid compact checkpoint iteration.");
    if (!Number.isInteger(state.nodesVisited) || state.nodesVisited < 0) throw new Error("Invalid compact checkpoint node count.");
    if (state.regrets.length !== this.regrets.length || state.strategySums.length !== this.strategySums.length) {
      throw new Error("Compact numeric checkpoint state length mismatch.");
    }
    this.regrets.set(state.regrets);
    this.strategySums.set(state.strategySums);
    assertFiniteArray(this.regrets, "Numeric checkpoint regrets");
    assertFiniteArray(this.strategySums, "Numeric checkpoint strategy sums");
    this.iterationCount = state.iteration;
    this.nodesVisited = state.nodesVisited;
    this.convergenceHistory = [];
    this.previousMetricStrategy = this.averageStrategyArray();
    this.startedAt = performance.now();
    this.memorySnapshots = [];
    this.captureMemory("restore-numeric");
  }
}

export function compactConfiguration(algorithm: AlgorithmName = "dcfr"): SolverConfiguration {
  return {
    algorithm,
    seed: 1,
    exactMetrics: true,
    engine: "indexed-tree",
    ...(algorithm === "dcfr" ? { dcfr: DEFAULT_DCFR } : {}),
  };
}
