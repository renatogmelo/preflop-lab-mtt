import { performance } from "node:perf_hooks";
import { stableStringify } from "../../core/stable";
import type { CompactGameProvider, CompactLevel } from "../compact/provider";
import { COMPACT_TREE_VERSION, compactRegistryBytes, compactTopologyBytes, type CompactIndexedTree } from "../compact/compact-tree";
import { structuralHashCompactTree } from "../fast-compiler/compiler-v2";
import { validateCompactTreeInvariants } from "../fast-compiler/structural-cache-v1";
import { DynamicTypedBuffer, type DynamicBufferMetrics, type DynamicGrowthPolicy } from "./dynamic-buffer";
import type { ExtensiveGameProviderV2 } from "./provider-v2";

export const GENERIC_COMPILER_VERSION = "generic-compiler-v3.0.0";

export type GenericCompilerOptions = {
  initialCapacity?: number;
  segmentSize?: number;
  growthPolicy?: DynamicGrowthPolicy;
  processingChunkSize?: number;
  maximumNodes?: number;
  maximumDepth?: number;
  maximumRuntimeMs?: number;
  signal?: AbortSignal;
};

export type GenericCompilerProgress = {
  status: "partial" | "complete" | "cancelled" | "failed";
  processedNodes: number;
  discoveredNodes: number;
  fraction: number | null;
  chunks: number;
};

export type GenericCompilerProfile = {
  policy: DynamicGrowthPolicy;
  initialCapacity: number;
  segmentSize: number;
  chunks: number;
  cancellationChecks: number;
  nodeBufferMetrics: Record<string, DynamicBufferMetrics>;
  allocations: number;
  reallocations: number;
  bytesCopied: number;
  finalizationBytesCopied: number;
  logicalFragmentationBytes: number;
  maximumResidentCapacityBytes: number;
  constructionMs: number;
  finalizationMs: number;
  validationMs: number;
  structuralHashMs: number;
  totalMs: number;
};

type NodeBuffers = {
  kind: DynamicTypedBuffer<Uint8Array>;
  actor: DynamicTypedBuffer<Int8Array>;
  firstChild: DynamicTypedBuffer<Uint32Array>;
  childCount: DynamicTypedBuffer<Uint16Array>;
  informationSet: DynamicTypedBuffer<Int32Array>;
  edgeProbability: DynamicTypedBuffer<Float64Array>;
  terminalP0: DynamicTypedBuffer<Float64Array>;
};

type InformationEntry = { provisional: number; key: string; actionKeys: readonly string[]; depth: number; recall: string };

const bytesPerElement: Record<keyof NodeBuffers, number> = {
  kind: 1, actor: 1, firstChild: 4, childCount: 2, informationSet: 4, edgeProbability: 8, terminalP0: 8,
};

function createBuffers(policy: DynamicGrowthPolicy, initial: number, segment: number): NodeBuffers {
  return {
    kind: new DynamicTypedBuffer(Uint8Array, policy, initial, segment),
    actor: new DynamicTypedBuffer(Int8Array, policy, initial, segment),
    firstChild: new DynamicTypedBuffer(Uint32Array, policy, initial, segment),
    childCount: new DynamicTypedBuffer(Uint16Array, policy, initial, segment),
    informationSet: new DynamicTypedBuffer(Int32Array, policy, initial, segment),
    edgeProbability: new DynamicTypedBuffer(Float64Array, policy, initial, segment),
    terminalP0: new DynamicTypedBuffer(Float64Array, policy, initial, segment),
  };
}

function appendNode(buffers: NodeBuffers, incomingProbability = 1) {
  const index = buffers.kind.push(0);
  buffers.actor.push(-1);
  buffers.firstChild.push(0);
  buffers.childCount.push(0);
  buffers.informationSet.push(-1);
  buffers.edgeProbability.push(incomingProbability);
  buffers.terminalP0.push(0);
  return index;
}

export class IncrementalGenericCompiler<State, Action> {
  private buffers: NodeBuffers | null;
  private states: State[] = [];
  private depths: number[] = [];
  private recalls: Array<[string, string]> = [];
  private cursor = 0;
  private chunks = 0;
  private cancellationChecks = 0;
  private status: GenericCompilerProgress["status"] = "partial";
  private readonly started = performance.now();
  private constructionMs = 0;
  private readonly seenStateKeys = new Set<string>();
  private readonly informationByKey = new Map<string, InformationEntry>();
  private readonly observationToInformation = new Map<string, string>();
  private readonly informationToObservation = new Map<string, string>();
  private terminals = 0;
  private chanceNodes = 0;
  private decisionNodes = 0;
  private chanceMaximumError = 0;
  private maximumZeroSumError = 0;
  private maximumDepthSeen = 0;
  readonly policy: DynamicGrowthPolicy;
  readonly initialCapacity: number;
  readonly segmentSize: number;

  constructor(readonly provider: ExtensiveGameProviderV2<State, Action>, readonly options: GenericCompilerOptions = {}) {
    if (!provider.capabilities.deterministic || !provider.capabilities.twoPlayerZeroSum) throw new Error("Provider V2 must declare deterministic two-player zero-sum semantics.");
    this.policy = options.growthPolicy ?? "segmented";
    this.initialCapacity = options.initialCapacity ?? 64;
    this.segmentSize = options.segmentSize ?? 4_096;
    this.buffers = createBuffers(this.policy, this.initialCapacity, this.segmentSize);
    const root = provider.initialState();
    const rootKey = provider.stateKey(root);
    if (!rootKey) throw new Error("Provider root state key is empty.");
    this.seenStateKeys.add(rootKey);
    this.states.push(root);
    this.depths.push(0);
    this.recalls.push(["", ""]);
    appendNode(this.buffers);
  }

  progress(): GenericCompilerProgress {
    const exact = this.provider.capabilities.exactNodeCount;
    return { status: this.status, processedNodes: this.cursor, discoveredNodes: this.states.length, fraction: exact ? this.cursor / exact : null, chunks: this.chunks };
  }

  private checkBudget() {
    this.cancellationChecks += 1;
    if (this.options.signal?.aborted) throw new Error("Generic compilation cancelled by AbortSignal.");
    if (this.options.maximumRuntimeMs !== undefined && performance.now() - this.started > this.options.maximumRuntimeMs) throw new Error("Generic compilation exceeded runtime budget.");
    const maximumNodes = this.options.maximumNodes ?? 250_000;
    if (this.states.length > maximumNodes) throw new Error(`Generic compilation exceeded node budget ${maximumNodes}.`);
  }

  private deterministicSnapshot(state: State) {
    const key = this.provider.stateKey(state);
    const actor = this.provider.actor(state);
    const actions = this.provider.legalActions(state);
    const actionKeys = actions.map((action) => this.provider.actionKey(state, action));
    const secondKey = this.provider.stateKey(state);
    const secondActor = this.provider.actor(state);
    const secondActionKeys = this.provider.legalActions(state).map((action) => this.provider.actionKey(state, action));
    if (key !== secondKey || actor !== secondActor || stableStringify(actionKeys) !== stableStringify(secondActionKeys)) throw new Error(`Provider is non-deterministic at state ${key}.`);
    if (new Set(actionKeys).size !== actionKeys.length) throw new Error(`Provider has duplicate action identities at state ${key}.`);
    return { key, actor, actions, actionKeys };
  }

  private processNode(index: number) {
    const buffers = this.buffers!;
    const state = this.states[index];
    const depth = this.depths[index];
    const { key, actor, actions, actionKeys } = this.deterministicSnapshot(state);
    this.maximumDepthSeen = Math.max(this.maximumDepthSeen, depth);
    const declaredMaximumDepth = Math.min(this.options.maximumDepth ?? 0xffff, this.provider.capabilities.maximumDepth ?? 0xffff);
    if (depth > declaredMaximumDepth) throw new Error(`Generic compilation exceeded depth budget ${declaredMaximumDepth}.`);
    const utility = this.provider.terminalUtility(state);
    if (actor === null) {
      if (actions.length) throw new Error(`Terminal state ${key} exposes legal actions.`);
      if (!utility || !Number.isFinite(utility[0]) || !Number.isFinite(utility[1])) throw new Error(`Terminal state ${key} has invalid utility.`);
      this.maximumZeroSumError = Math.max(this.maximumZeroSumError, Math.abs(utility[0] + utility[1]));
      buffers.kind.set(index, 0);
      buffers.terminalP0.set(index, utility[0]);
      this.terminals += 1;
      return;
    }
    if (utility !== null) throw new Error(`Non-terminal state ${key} exposes terminal utility.`);
    if (!actions.length || actions.length > 0xffff) throw new Error(`Non-terminal state ${key} has unsupported action count.`);
    const firstChild = this.states.length;
    if (firstChild + actions.length > 0xffff_ffff) throw new Error("Generic topology exceeds Uint32 index capacity.");
    buffers.firstChild.set(index, firstChild);
    buffers.childCount.set(index, actions.length);
    let chanceTotal = 0;
    if (actor === "chance") {
      buffers.kind.set(index, 1);
      this.chanceNodes += 1;
    } else {
      buffers.kind.set(index, 2);
      buffers.actor.set(index, actor);
      const informationKey = this.provider.informationSetKey(state);
      if (!informationKey) throw new Error(`Decision state ${key} has empty information-set identity.`);
      const recall = this.recalls[index][actor];
      const existing = this.informationByKey.get(informationKey);
      if (existing) {
        if (existing.depth !== depth || existing.recall !== recall || stableStringify(existing.actionKeys) !== stableStringify(actionKeys)) throw new Error(`Information set ${informationKey} is inconsistent or violates perfect recall.`);
        buffers.informationSet.set(index, existing.provisional);
      } else {
        const provisional = this.informationByKey.size;
        this.informationByKey.set(informationKey, { provisional, key: informationKey, actionKeys, depth, recall });
        buffers.informationSet.set(index, provisional);
      }
      const audit = this.provider.informationSetAudit?.(state);
      if (!audit) throw new Error(`Provider did not supply information-set leakage evidence at ${key}.`);
      const observation = `${actor}|${audit.ownObservation}|${audit.publicHistory}`;
      const observedInformation = this.observationToInformation.get(observation);
      if (observedInformation !== undefined && observedInformation !== informationKey) throw new Error(`Information-set identity is unstable for observation ${observation}.`);
      const observedMeaning = this.informationToObservation.get(informationKey);
      if (observedMeaning !== undefined && observedMeaning !== observation) throw new Error(`Information set ${informationKey} merges distinguishable observations.`);
      this.observationToInformation.set(observation, informationKey);
      this.informationToObservation.set(informationKey, observation);
      this.decisionNodes += 1;
    }
    for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
      const action = actions[actionIndex];
      const next = this.provider.transition(state, action);
      const nextAgain = this.provider.transition(state, action);
      const childKey = this.provider.stateKey(next);
      if (childKey !== this.provider.stateKey(nextAgain)) throw new Error(`Provider transition is non-deterministic at ${key}/${actionKeys[actionIndex]}.`);
      if (!childKey || this.seenStateKeys.has(childKey)) throw new Error(`Provider generated a cycle or multiple-parent state ${childKey}.`);
      this.seenStateKeys.add(childKey);
      const probability = actor === "chance" ? this.provider.chanceProbability(state, action) : 1;
      if (actor === "chance") {
        if (!Number.isFinite(probability) || probability < 0) throw new Error(`Chance probability is invalid at ${key}/${actionKeys[actionIndex]}.`);
        chanceTotal += probability;
      }
      const childIndex = appendNode(buffers, probability);
      if (childIndex !== firstChild + actionIndex) throw new Error("Generic compiler failed contiguous-child allocation.");
      this.states.push(next);
      this.depths.push(depth + 1);
      const childRecall: [string, string] = [...this.recalls[index]] as [string, string];
      if (actor === 0 || actor === 1) childRecall[actor] = `${childRecall[actor]}|${this.provider.informationSetKey(state)}:${actionKeys[actionIndex]}`;
      this.recalls.push(childRecall);
    }
    if (actor === "chance") {
      this.chanceMaximumError = Math.max(this.chanceMaximumError, Math.abs(chanceTotal - 1));
      if (Math.abs(chanceTotal - 1) > 1e-12) throw new Error(`Chance probabilities at ${key} are not normalized.`);
    }
  }

  processNextChunk(limit = this.options.processingChunkSize ?? 4_096) {
    if (this.status !== "partial") throw new Error(`Cannot process generic compiler in ${this.status} state.`);
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Generic compiler chunk size must be positive.");
    try {
      this.checkBudget();
      const started = performance.now();
      const end = Math.min(this.states.length, this.cursor + limit);
      while (this.cursor < end) {
        this.processNode(this.cursor);
        this.cursor += 1;
        if ((this.cursor & 1023) === 0) this.checkBudget();
      }
      this.constructionMs += performance.now() - started;
      this.chunks += 1;
      if (this.cursor === this.states.length) this.status = "complete";
      return this.progress();
    } catch (error) {
      this.status = error instanceof Error && /cancelled|budget/.test(error.message) ? "cancelled" : "failed";
      throw error;
    }
  }

  cancelAndRelease() {
    if (this.status === "complete") throw new Error("Cannot release a completed generic compilation.");
    const releasedNodes = this.states.length;
    this.status = "cancelled";
    this.states = [];
    this.depths = [];
    this.recalls = [];
    this.buffers = null;
    return { releasedNodes, progress: this.progress() };
  }

  finish() {
    if (this.status !== "complete" || this.cursor !== this.states.length || !this.buffers) throw new Error("Cannot finalize an incomplete generic compilation.");
    const exact = this.provider.capabilities.exactNodeCount;
    if (exact !== undefined && exact !== this.states.length) throw new Error(`Provider exact node count ${exact} differs from expanded count ${this.states.length}.`);
    const finalizationStarted = performance.now();
    const buffers = this.buffers;
    const kind = buffers.kind.finalize();
    const actor = buffers.actor.finalize();
    const firstChild = buffers.firstChild.finalize();
    const childCount = buffers.childCount.finalize();
    const provisionalInformation = buffers.informationSet.finalize();
    const edgeProbability = buffers.edgeProbability.finalize();
    const terminalP0 = buffers.terminalP0.finalize();
    const canonical = [...this.informationByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
    const oldToNew = new Int32Array(canonical.length);
    canonical.forEach((entry, next) => { oldToNew[entry.provisional] = next; });
    const informationSet = new Int32Array(provisionalInformation.length);
    informationSet.fill(-1);
    for (let node = 0; node < provisionalInformation.length; node += 1) if (provisionalInformation[node] >= 0) informationSet[node] = oldToNew[provisionalInformation[node]];
    const informationSetActionCount = new Uint16Array(canonical.length);
    const informationSetActionOffset = new Uint32Array(canonical.length + 1);
    let totalInformationSetActions = 0;
    canonical.forEach((entry, index) => {
      informationSetActionOffset[index] = totalInformationSetActions;
      informationSetActionCount[index] = entry.actionKeys.length;
      totalInformationSetActions += entry.actionKeys.length;
      if (totalInformationSetActions > 0xffff_ffff) throw new Error("Generic information-set action storage exceeds Uint32 capacity.");
    });
    informationSetActionOffset[canonical.length] = totalInformationSetActions;
    const levels: CompactLevel[] = [];
    let offset = 0;
    while (offset < this.depths.length) {
      const depth = this.depths[offset];
      let end = offset + 1;
      while (end < this.depths.length && this.depths[end] === depth) end += 1;
      levels.push({ kind: "mixed", stage: depth, offset, count: end - offset });
      offset = end;
    }
    const finalizationMs = performance.now() - finalizationStarted;
    const tree: CompactIndexedTree = {
      version: COMPACT_TREE_VERSION, gameId: this.provider.id, gameHash: this.provider.semanticIdentity, root: 0,
      kind, actor, firstChild, childCount, informationSet, edgeProbability, terminalP0,
      informationSetActionOffset, informationSetActionCount, levels, totalInformationSetActions, maximumDepth: this.maximumDepthSeen,
      validation: {
        valid: true, issues: [], nodes: kind.length, terminals: this.terminals, chanceNodes: this.chanceNodes,
        decisionNodes: this.decisionNodes, informationSets: canonical.length, chanceMaximumError: this.chanceMaximumError,
        maximumZeroSumError: this.maximumZeroSumError, allReachable: true, noInformationLeakage: true, perfectRecall: true,
      },
    };
    const validationStarted = performance.now();
    const issues = validateCompactTreeInvariants(tree);
    if (issues.length) throw new Error(`Generic topology invariant validation failed: ${issues.join(", ")}`);
    const validationMs = performance.now() - validationStarted;
    const hashStarted = performance.now();
    const structuralHash = structuralHashCompactTree(tree);
    const structuralHashMs = performance.now() - hashStarted;
    const nodeBufferMetrics = Object.fromEntries(Object.entries(buffers).map(([name, value]) => [name, value.metrics()])) as Record<string, DynamicBufferMetrics>;
    const metrics = Object.values(nodeBufferMetrics);
    const maximumResidentCapacityBytes = (Object.keys(buffers) as Array<keyof NodeBuffers>)
      .reduce((sum, name) => sum + buffers[name].capacity * bytesPerElement[name], 0);
    const profile: GenericCompilerProfile = {
      policy: this.policy, initialCapacity: this.initialCapacity, segmentSize: this.segmentSize, chunks: this.chunks,
      cancellationChecks: this.cancellationChecks, nodeBufferMetrics,
      allocations: metrics.reduce((sum, item) => sum + item.allocations, 0),
      reallocations: metrics.reduce((sum, item) => sum + item.reallocations, 0),
      bytesCopied: metrics.reduce((sum, item) => sum + item.bytesCopied, 0) + informationSet.byteLength,
      finalizationBytesCopied: metrics.reduce((sum, item) => sum + item.finalizationBytesCopied, 0) + informationSet.byteLength,
      logicalFragmentationBytes: metrics.reduce((sum, item) => sum + item.logicalFragmentationBytes, 0),
      maximumResidentCapacityBytes, constructionMs: this.constructionMs, finalizationMs, validationMs, structuralHashMs,
      totalMs: performance.now() - this.started,
    };
    const topologyBytes = compactTopologyBytes(tree);
    const registryBytes = compactRegistryBytes(tree);
    return {
      tree, provider: new CompiledTreeProvider(tree), compilerVersion: GENERIC_COMPILER_VERSION, structuralHash, profile,
      topologyBytes, registryBytes, bytesPerNode: (topologyBytes + registryBytes) / tree.kind.length,
      informationSetKeys: canonical.map((entry) => entry.key),
    };
  }
}

export function compileGenericGame<State, Action>(provider: ExtensiveGameProviderV2<State, Action>, options: GenericCompilerOptions = {}) {
  const compiler = new IncrementalGenericCompiler(provider, options);
  while (compiler.progress().status === "partial") compiler.processNextChunk();
  return compiler.finish();
}

export class CompiledTreeProvider implements CompactGameProvider<number> {
  readonly validationClaims = { noInformationLeakage: true, perfectRecall: true } as const;
  readonly levels;
  readonly nodeCount;
  readonly informationSetCount;
  readonly maximumDepth;
  readonly id;
  readonly logicalGameHash;
  private readonly actions = new Map<number, readonly number[]>();
  constructor(readonly tree: CompactIndexedTree) {
    this.levels = tree.levels; this.nodeCount = tree.kind.length; this.informationSetCount = tree.informationSetActionCount.length;
    this.maximumDepth = tree.maximumDepth; this.id = tree.gameId; this.logicalGameHash = tree.gameHash;
  }
  initialState() { return this.tree.root; }
  stateAt(ordinal: number) { return ordinal; }
  actor(state: number) { return this.tree.kind[state] === 0 ? null : this.tree.kind[state] === 1 ? "chance" as const : this.tree.actor[state] as 0 | 1; }
  legalActions(state: number) {
    const count = this.tree.childCount[state];
    let actions = this.actions.get(count);
    if (!actions) { actions = Object.freeze(Array.from({ length: count }, (_, index) => index)); this.actions.set(count, actions); }
    return actions;
  }
  transition(state: number, action: number) { return this.tree.firstChild[state] + action; }
  informationSet(state: number) { return this.tree.informationSet[state]; }
  informationSetKey(informationSet: number) { return `generic-info:${informationSet}`; }
  informationSetActionCount(informationSet: number) { return this.tree.informationSetActionCount[informationSet]; }
  actionLabel(_informationSet: number, action: number) { return `a${action}`; }
  chanceProbability(state: number, action: number) { return this.tree.edgeProbability[this.transition(state, action)]; }
  terminalUtility(state: number): readonly [number, number] | null { return this.tree.kind[state] === 0 ? [this.tree.terminalP0[state], -this.tree.terminalP0[state]] : null; }
  terminalUtilityP0(state: number) { return this.tree.kind[state] === 0 ? this.tree.terminalP0[state] : null; }
}
