import { performance } from "node:perf_hooks";
import type { BehavioralStrategy } from "../../core/types";
import { assertUint32, type CompactGameProvider, type CompactLevel } from "./provider";

export const COMPACT_TREE_VERSION = "compact-indexed-v2";

export type CompactIndexedTree = {
  version: typeof COMPACT_TREE_VERSION;
  gameId: string;
  gameHash: string;
  root: number;
  kind: Uint8Array;
  actor: Int8Array;
  firstChild: Uint32Array;
  childCount: Uint16Array;
  informationSet: Int32Array;
  edgeProbability: Float64Array;
  terminalP0: Float64Array;
  informationSetActionOffset: Uint32Array;
  informationSetActionCount: Uint16Array;
  levels: readonly CompactLevel[];
  totalInformationSetActions: number;
  maximumDepth: number;
  validation: {
    valid: boolean;
    issues: string[];
    nodes: number;
    terminals: number;
    chanceNodes: number;
    decisionNodes: number;
    informationSets: number;
    chanceMaximumError: number;
    maximumZeroSumError: number;
    allReachable: boolean;
    noInformationLeakage: boolean;
    perfectRecall: boolean;
  };
};

export type CompactCompilation = {
  tree: CompactIndexedTree;
  compilationMs: number;
  topologyBytes: number;
  registryBytes: number;
  temporaryBytes: number;
  bytesPerNode: number;
};

export function compactTopologyBytes(tree: CompactIndexedTree) {
  return tree.kind.byteLength + tree.actor.byteLength + tree.firstChild.byteLength
    + tree.childCount.byteLength + tree.informationSet.byteLength
    + tree.edgeProbability.byteLength + tree.terminalP0.byteLength;
}

export function compactRegistryBytes(tree: CompactIndexedTree) {
  return tree.informationSetActionOffset.byteLength + tree.informationSetActionCount.byteLength;
}

export function compileCompactGame(provider: CompactGameProvider<number>): CompactCompilation {
  const started = performance.now();
  assertUint32(provider.nodeCount, "Compact node count");
  assertUint32(provider.informationSetCount, "Compact information-set count");
  const kind = new Uint8Array(provider.nodeCount);
  const actor = new Int8Array(provider.nodeCount);
  actor.fill(-1);
  const firstChild = new Uint32Array(provider.nodeCount);
  const childCount = new Uint16Array(provider.nodeCount);
  const informationSet = new Int32Array(provider.nodeCount);
  informationSet.fill(-1);
  const edgeProbability = new Float64Array(provider.nodeCount);
  edgeProbability.fill(1);
  const terminalP0 = new Float64Array(provider.nodeCount);
  const parentSeen = new Uint8Array(provider.nodeCount);
  parentSeen[0] = 1;
  const informationSetActionOffset = new Uint32Array(provider.informationSetCount + 1);
  const informationSetActionCount = new Uint16Array(provider.informationSetCount);
  let totalInformationSetActions = 0;
  for (let id = 0; id < provider.informationSetCount; id += 1) {
    const count = provider.informationSetActionCount(id);
    if (!Number.isInteger(count) || count < 1 || count > 0xffff) throw new Error(`Information set ${id} exceeds Uint16 action capacity.`);
    informationSetActionOffset[id] = totalInformationSetActions;
    informationSetActionCount[id] = count;
    totalInformationSetActions += count;
    assertUint32(totalInformationSetActions, "Compact information-set action storage");
  }
  informationSetActionOffset[provider.informationSetCount] = totalInformationSetActions;

  const issues: string[] = [];
  let terminals = 0;
  let chanceNodes = 0;
  let decisionNodes = 0;
  let chanceMaximumError = 0;
  let maximumZeroSumError = 0;
  for (let ordinal = 0; ordinal < provider.nodeCount; ordinal += 1) {
    const state = provider.stateAt(ordinal);
    const nodeActor = provider.actor(state);
    const utilityP0 = provider.terminalUtilityP0?.(state);
    const terminal = utilityP0 === undefined ? provider.terminalUtility(state) : null;
    const resolvedUtility = utilityP0 === undefined ? terminal?.[0] ?? null : utilityP0;
    if (nodeActor === null) {
      kind[ordinal] = 0;
      terminals += 1;
      if (resolvedUtility === null || !Number.isFinite(resolvedUtility)) issues.push(`terminal-utility:${ordinal}`);
      terminalP0[ordinal] = resolvedUtility ?? Number.NaN;
      const second = terminal?.[1] ?? -(resolvedUtility ?? Number.NaN);
      maximumZeroSumError = Math.max(maximumZeroSumError, Math.abs((resolvedUtility ?? 0) + second));
      continue;
    }
    const actions = provider.legalActions(state);
    if (!actions.length || actions.length > 0xffff) throw new Error(`Node ${ordinal} has unsupported action count.`);
    childCount[ordinal] = actions.length;
    const initialChild = provider.transition(state, actions[0]);
    if (!Number.isInteger(initialChild) || initialChild <= ordinal || initialChild >= provider.nodeCount) throw new Error(`Node ${ordinal} has invalid forward child ${initialChild}.`);
    firstChild[ordinal] = initialChild;
    let chanceTotal = 0;
    actions.forEach((actionValue, actionIndex) => {
      if (actionValue !== actionIndex) throw new Error("Compact actions must use stable contiguous numeric IDs.");
      const child = provider.transition(state, actionValue);
      if (child !== initialChild + actionIndex) throw new Error(`Node ${ordinal} children are not compact and contiguous.`);
      if (parentSeen[child]) throw new Error(`Compact node ${child} has multiple parents.`);
      parentSeen[child] = 1;
      if (nodeActor === "chance") {
        const probability = provider.chanceProbability(state, actionValue);
        if (!Number.isFinite(probability) || probability < 0) issues.push(`chance-probability:${ordinal}:${actionValue}`);
        edgeProbability[child] = probability;
        chanceTotal += probability;
      }
    });
    if (nodeActor === "chance") {
      kind[ordinal] = 1;
      chanceNodes += 1;
      chanceMaximumError = Math.max(chanceMaximumError, Math.abs(chanceTotal - 1));
    } else {
      kind[ordinal] = 2;
      actor[ordinal] = nodeActor;
      decisionNodes += 1;
      const id = provider.informationSet(state);
      if (!Number.isInteger(id) || id < 0 || id >= provider.informationSetCount) throw new Error(`Invalid information set ${id} at node ${ordinal}.`);
      if (informationSetActionCount[id] !== actions.length) throw new Error(`Information set ${id} changed legal actions.`);
      informationSet[ordinal] = id;
    }
  }
  const allReachable = parentSeen.every((value) => value === 1);
  const noInformationLeakage = provider.informationSetCount === 0
    || provider.validationClaims?.noInformationLeakage === true;
  const perfectRecall = provider.informationSetCount === 0
    || provider.validationClaims?.perfectRecall === true;
  if (!allReachable) issues.push("unreachable-node");
  if (chanceMaximumError > 1e-12) issues.push("chance-normalization");
  if (maximumZeroSumError > 1e-12) issues.push("zero-sum");
  if (!noInformationLeakage) issues.push("information-leakage-unvalidated");
  if (!perfectRecall) issues.push("perfect-recall-unvalidated");
  const tree: CompactIndexedTree = {
    version: COMPACT_TREE_VERSION,
    gameId: provider.id,
    gameHash: provider.logicalGameHash,
    root: 0,
    kind,
    actor,
    firstChild,
    childCount,
    informationSet,
    edgeProbability,
    terminalP0,
    informationSetActionOffset,
    informationSetActionCount,
    levels: provider.levels,
    totalInformationSetActions,
    maximumDepth: provider.maximumDepth,
    validation: {
      valid: issues.length === 0,
      issues,
      nodes: provider.nodeCount,
      terminals,
      chanceNodes,
      decisionNodes,
      informationSets: provider.informationSetCount,
      chanceMaximumError,
      maximumZeroSumError,
      allReachable,
      noInformationLeakage,
      perfectRecall,
    },
  };
  const topologyBytes = compactTopologyBytes(tree);
  const registryBytes = compactRegistryBytes(tree);
  return {
    tree,
    compilationMs: performance.now() - started,
    topologyBytes,
    registryBytes,
    temporaryBytes: parentSeen.byteLength,
    bytesPerNode: (topologyBytes + registryBytes) / provider.nodeCount,
  };
}

export class CompactExtensiveGame {
  private compilation: CompactCompilation | null = null;

  constructor(readonly provider: CompactGameProvider<number>) {}

  get id() { return this.provider.id; }
  get gameHash() { return this.provider.logicalGameHash; }

  compile() {
    this.compilation ??= compileCompactGame(this.provider);
    return this.compilation;
  }

  successors(state: number) {
    return this.provider.legalActions(state).map((action) => ({
      action,
      probability: this.provider.actor(state) === "chance" ? this.provider.chanceProbability(state, action) : 1,
      state: this.provider.transition(state, action),
    }));
  }

  walkLazy(visitor: (state: number) => void, nodeLimit = this.provider.nodeCount) {
    const stack: number[] = [this.provider.initialState()];
    let visited = 0;
    while (stack.length) {
      const state = stack.pop()!;
      visitor(state);
      visited += 1;
      if (visited > nodeLimit) throw new Error(`Lazy traversal exceeded node limit ${nodeLimit}.`);
      const actions = this.provider.legalActions(state);
      for (let index = actions.length - 1; index >= 0; index -= 1) stack.push(this.provider.transition(state, actions[index]));
    }
    return visited;
  }
}

export type CompactProbability = (informationSet: number, action: number) => number;

export function strategyArrayProbability(tree: CompactIndexedTree, strategy: Float64Array): CompactProbability {
  if (strategy.length !== tree.totalInformationSetActions) throw new Error("Compact strategy length mismatch.");
  return (informationSet, action) => strategy[tree.informationSetActionOffset[informationSet] + action];
}

export function compactStrategyToBehavioral(
  provider: CompactGameProvider<number>,
  tree: CompactIndexedTree,
  strategy: Float64Array,
): BehavioralStrategy {
  const result: BehavioralStrategy = {};
  for (let id = 0; id < provider.informationSetCount; id += 1) {
    const offset = tree.informationSetActionOffset[id];
    const count = tree.informationSetActionCount[id];
    const actions: Record<string, number> = {};
    for (let action = 0; action < count; action += 1) actions[provider.actionLabel(id, action)] = strategy[offset + action];
    result[provider.informationSetKey(id)] = actions;
  }
  return result;
}

export function evaluateLazyStrategy(
  provider: CompactGameProvider<number>,
  probability: CompactProbability,
) {
  const capacity = provider.maximumDepth + 2;
  const stateStack = new Uint32Array(capacity);
  const actionStack = new Uint16Array(capacity);
  const accumulator = new Float64Array(capacity);
  const incomingWeight = new Float64Array(capacity);
  const entered = new Uint8Array(capacity);
  stateStack[0] = provider.initialState();
  incomingWeight[0] = 1;
  let depth = 0;
  let visited = 0;
  let rootValue = 0;
  while (depth >= 0) {
    const state = stateStack[depth];
    if (!entered[depth]) {
      entered[depth] = 1;
      visited += 1;
      const terminal = provider.terminalUtilityP0?.(state) ?? provider.terminalUtility(state)?.[0] ?? null;
      if (terminal !== null) {
        const weighted = terminal * incomingWeight[depth];
        depth -= 1;
        if (depth >= 0) accumulator[depth] += weighted;
        else rootValue = weighted;
        continue;
      }
    }
    const actions = provider.legalActions(state);
    const nextAction = actionStack[depth];
    if (nextAction < actions.length) {
      actionStack[depth] += 1;
      const action = actions[nextAction];
      const nodeActor = provider.actor(state);
      const weight = nodeActor === "chance"
        ? provider.chanceProbability(state, action)
        : probability(provider.informationSet(state), action);
      depth += 1;
      if (depth >= capacity) throw new Error("Lazy traversal exceeded declared maximum depth.");
      stateStack[depth] = provider.transition(state, action);
      actionStack[depth] = 0;
      accumulator[depth] = 0;
      incomingWeight[depth] = weight;
      entered[depth] = 0;
      continue;
    }
    const weighted = accumulator[depth] * incomingWeight[depth];
    depth -= 1;
    if (depth >= 0) accumulator[depth] += weighted;
    else rootValue = weighted;
  }
  return { utilities: [rootValue, -rootValue] as [number, number], nodesVisited: visited, stackBytes: stateStack.byteLength + actionStack.byteLength + accumulator.byteLength + incomingWeight.byteLength + entered.byteLength };
}

