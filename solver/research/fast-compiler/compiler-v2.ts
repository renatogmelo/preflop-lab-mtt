import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { CompactCfrSolver } from "../compact/compact-cfr";
import {
  COMPACT_TREE_VERSION,
  compactRegistryBytes,
  compactTopologyBytes,
  type CompactCompilation,
  type CompactIndexedTree,
} from "../compact/compact-tree";
import { COMPACT_SYNTHETIC_PROVIDER_VERSION, SyntheticCompactProvider } from "../compact/synthetic-compact-provider";

export const FAST_COMPILER_VERSION = "compact-compiler-v2.0.0";

export type CompilerCapacityMode = "preallocated" | "chunked";

export type CompilerV2Profile = {
  providerInitializationMs: number;
  stateEnumerationMs: number | null;
  successorGenerationMs: number | null;
  informationSetAssignmentMs: number | null;
  topologyAllocationMs: number;
  topologyPopulationMs: number;
  chanceValidationMs: number | null;
  perfectRecallValidationMs: number;
  structuralHashMs: number;
  finalizationMs: number;
  totalMs: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  chunks: number;
  chunkSize: number;
  cancellationChecks: number;
};

export type IncrementalProgress = {
  status: "partial" | "complete" | "cancelled" | "failed";
  processedNodes: number;
  totalNodes: number;
  fraction: number;
  chunks: number;
  issues: string[];
};

function seededUnit(seed: number, label: string) {
  let state = seed >>> 0;
  for (let index = 0; index < label.length; index += 1) {
    state ^= label.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x1_0000_0000;
}

function geometricSum(base: number, terms: number) {
  if (base === 1) return terms;
  return (base ** terms - 1) / (base - 1);
}

function historyDigits(history: number, stages: number, branching: number) {
  const digits = new Uint16Array(stages);
  let remaining = history;
  for (let index = stages - 1; index >= 0; index -= 1) {
    digits[index] = remaining % branching;
    remaining = Math.floor(remaining / branching);
  }
  return digits;
}

function historyLabel(digits: Uint16Array, publicSignals: number) {
  let result = "";
  for (let stage = 0; stage < digits.length; stage += 1) {
    if (result) result += "|";
    result += `a${stage}:${Math.floor(digits[stage] / publicSignals)}|s${stage}:${digits[stage] % publicSignals}`;
  }
  return result;
}

function terminalUtility(configuration: SyntheticGameConfiguration, state: number, terminalOffset: number) {
  const branching = configuration.actionsPerDecision * configuration.publicSignals;
  const histories = branching ** configuration.stages;
  const ordinal = state - terminalOffset;
  const deal = Math.floor(ordinal / histories);
  const historyCode = ordinal % histories;
  const first = Math.floor(deal / configuration.privateStates);
  const second = deal % configuration.privateStates;
  const digits = historyDigits(historyCode, configuration.stages, branching);
  const denominator = Math.max(1, configuration.privateStates - 1);
  let value = (first - second) / denominator;
  if (configuration.dependencyComplexity !== "independent") {
    for (let stage = 0; stage < configuration.stages; stage += 1) {
      const action = Math.floor(digits[stage] / configuration.publicSignals);
      const actor = stage % 2;
      const privateState = actor === 0 ? first : second;
      const aligned = action === privateState % configuration.actionsPerDecision;
      value += (actor === 0 ? 1 : -1) * (aligned ? 0.45 : -0.12);
    }
  }
  if (configuration.dependencyComplexity === "history-coupled") {
    for (let stage = 0; stage < configuration.stages; stage += 1) {
      const signal = digits[stage] % configuration.publicSignals;
      value += (stage % 2 === 0 ? 1 : -1) * (signal - (configuration.publicSignals - 1) / 2) * 0.08;
    }
  }
  const label = historyLabel(digits, configuration.publicSignals);
  value += (seededUnit(configuration.seed, `utility|${first}|${second}|${label}`) - 0.5) * 0.02;
  return Math.tanh(value);
}

function chanceProbabilities(
  configuration: SyntheticGameConfiguration,
  state: number,
  levelOffset: number,
  stage: number,
) {
  const branching = configuration.actionsPerDecision * configuration.publicSignals;
  const decisionOrdinal = Math.floor((state - levelOffset) / configuration.actionsPerDecision);
  const action = (state - levelOffset) % configuration.actionsPerDecision;
  const histories = branching ** stage;
  const deal = Math.floor(decisionOrdinal / histories);
  const history = decisionOrdinal % histories;
  const first = Math.floor(deal / configuration.privateStates);
  const second = deal % configuration.privateStates;
  const prefix = historyLabel(historyDigits(history, stage, branching), configuration.publicSignals);
  const label = prefix ? `${first}|${second}|${prefix}|a${stage}:${action}` : `${first}|${second}|a${stage}:${action}`;
  const weights = new Uint16Array(configuration.publicSignals);
  let total = 0;
  for (let signal = 0; signal < weights.length; signal += 1) {
    const weight = 1 + Math.floor(seededUnit(configuration.seed, `${label}|${signal}`) * 9);
    weights[signal] = weight;
    total += weight;
  }
  return { weights, total };
}

function updateHash(hash: ReturnType<typeof createHash>, array: ArrayBufferView) {
  hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

export function structuralHashCompactTree(tree: CompactIndexedTree) {
  const hash = createHash("sha256");
  hash.update(`${tree.version}|${tree.gameHash}|${tree.root}|${tree.maximumDepth}|${tree.totalInformationSetActions}|`);
  updateHash(hash, tree.kind);
  updateHash(hash, tree.actor);
  updateHash(hash, tree.firstChild);
  updateHash(hash, tree.childCount);
  updateHash(hash, tree.informationSet);
  updateHash(hash, tree.edgeProbability);
  updateHash(hash, tree.terminalP0);
  updateHash(hash, tree.informationSetActionOffset);
  updateHash(hash, tree.informationSetActionCount);
  return hash.digest("hex");
}

export class IncrementalSyntheticCompiler {
  readonly provider: SyntheticCompactProvider;
  readonly profile: CompilerV2Profile;
  parentSeen: Uint8Array;
  kind: Uint8Array;
  actor: Int8Array;
  firstChild: Uint32Array;
  childCount: Uint16Array;
  informationSet: Int32Array;
  edgeProbability: Float64Array;
  terminalP0: Float64Array;
  informationSetActionOffset: Uint32Array;
  informationSetActionCount: Uint16Array;
  private cursor = 0;
  private levelIndex = 0;
  private status: IncrementalProgress["status"] = "partial";
  private issues: string[] = [];
  private terminals = 0;
  private chanceNodes = 0;
  private decisionNodes = 0;
  private chanceMaximumError = 0;
  private maximumZeroSumError = 0;
  private totalInformationSetActions = 0;
  private readonly started = performance.now();
  private readonly cpuStarted = process.cpuUsage();

  constructor(
    readonly configuration: SyntheticGameConfiguration,
    readonly options: {
      chunkSize?: number;
      signal?: AbortSignal;
      maximumRuntimeMs?: number;
      maximumNodes?: number;
      capacityMode?: CompilerCapacityMode;
    } = {},
  ) {
    const providerStarted = performance.now();
    this.provider = new SyntheticCompactProvider(configuration);
    const providerInitializationMs = performance.now() - providerStarted;
    if ((options.maximumNodes ?? Number.POSITIVE_INFINITY) < this.provider.nodeCount) {
      throw new Error(`Structural budget permits ${options.maximumNodes} nodes but compilation requires ${this.provider.nodeCount}.`);
    }
    const allocationStarted = performance.now();
    this.kind = new Uint8Array(this.provider.nodeCount);
    this.actor = new Int8Array(this.provider.nodeCount);
    this.actor.fill(-1);
    this.firstChild = new Uint32Array(this.provider.nodeCount);
    this.childCount = new Uint16Array(this.provider.nodeCount);
    this.informationSet = new Int32Array(this.provider.nodeCount);
    this.informationSet.fill(-1);
    this.edgeProbability = new Float64Array(this.provider.nodeCount);
    this.edgeProbability.fill(1);
    this.terminalP0 = new Float64Array(this.provider.nodeCount);
    this.parentSeen = new Uint8Array(this.provider.nodeCount);
    this.parentSeen[0] = 1;
    this.informationSetActionOffset = new Uint32Array(this.provider.informationSetCount + 1);
    this.informationSetActionCount = new Uint16Array(this.provider.informationSetCount);
    for (let id = 0; id < this.provider.informationSetCount; id += 1) {
      this.informationSetActionOffset[id] = this.totalInformationSetActions;
      this.informationSetActionCount[id] = configuration.actionsPerDecision;
      this.totalInformationSetActions += configuration.actionsPerDecision;
    }
    this.informationSetActionOffset[this.provider.informationSetCount] = this.totalInformationSetActions;
    this.profile = {
      providerInitializationMs,
      stateEnumerationMs: null,
      successorGenerationMs: null,
      informationSetAssignmentMs: null,
      topologyAllocationMs: performance.now() - allocationStarted,
      topologyPopulationMs: 0,
      chanceValidationMs: null,
      perfectRecallValidationMs: 0,
      structuralHashMs: 0,
      finalizationMs: 0,
      totalMs: 0,
      cpuUserMicros: 0,
      cpuSystemMicros: 0,
      chunks: 0,
      chunkSize: options.chunkSize ?? 65_536,
      cancellationChecks: 0,
    };
  }

  private checkCancellation() {
    this.profile.cancellationChecks += 1;
    if (this.options.signal?.aborted) {
      this.status = "cancelled";
      throw new Error("Incremental compilation cancelled.");
    }
    if (this.options.maximumRuntimeMs !== undefined && performance.now() - this.started > this.options.maximumRuntimeMs) {
      this.status = "cancelled";
      throw new Error("Incremental compilation exceeded runtime budget.");
    }
  }

  processNextChunk(limit = this.profile.chunkSize): IncrementalProgress {
    try {
      if (this.status !== "partial") throw new Error(`Cannot process compiler in ${this.status} state.`);
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Chunk size must be a positive integer.");
    this.checkCancellation();
    const chunkStarted = performance.now();
    const end = Math.min(this.provider.nodeCount, this.cursor + limit);
    while (this.cursor < end) {
      const level = this.provider.levels[this.levelIndex];
      const levelEnd = level.offset + level.count;
      const rangeEnd = Math.min(end, levelEnd);
      if (level.kind === "root-chance") this.processRootChance();
      else if (level.kind === "decision") this.processDecisions(this.cursor, rangeEnd, level.offset, level.stage, this.levelIndex);
      else if (level.kind === "public-chance") this.processChance(this.cursor, rangeEnd, level.offset, level.stage, this.levelIndex);
      else this.processTerminals(this.cursor, rangeEnd, level.offset);
      this.cursor = rangeEnd;
      if (this.cursor === levelEnd) this.levelIndex += 1;
    }
    this.profile.topologyPopulationMs += performance.now() - chunkStarted;
    this.profile.chunks += 1;
    if (this.cursor === this.provider.nodeCount) this.status = "complete";
      return this.progress();
    } catch (error) {
      if (this.status === "partial") this.status = "failed";
      throw error;
    }
  }

  private processRootChance() {
    const level = this.provider.levels[0];
    const next = this.provider.levels[1];
    this.kind[0] = 1;
    this.firstChild[0] = next.offset;
    this.childCount[0] = this.configuration.privateStates ** 2;
    this.chanceNodes += 1;
    const probability = 1 / this.childCount[0];
    let total = 0;
    for (let action = 0; action < this.childCount[0]; action += 1) {
      const child = next.offset + action;
      this.parentSeen[child] = 1;
      this.edgeProbability[child] = probability;
      total += probability;
    }
    this.chanceMaximumError = Math.max(this.chanceMaximumError, Math.abs(total - 1));
    if (level.offset !== 0) this.issues.push("root-offset");
  }

  private processDecisions(start: number, end: number, offset: number, stage: number, levelIndex: number) {
    const branching = this.configuration.actionsPerDecision * this.configuration.publicSignals;
    const histories = branching ** stage;
    const next = this.provider.levels[levelIndex + 1];
    for (let state = start; state < end; state += 1) {
      const ordinal = state - offset;
      const first = next.offset + ordinal * this.configuration.actionsPerDecision;
      this.kind[state] = 2;
      this.actor[state] = stage % 2;
      this.firstChild[state] = first;
      this.childCount[state] = this.configuration.actionsPerDecision;
      const deal = Math.floor(ordinal / histories);
      const own = stage % 2 === 0 ? Math.floor(deal / this.configuration.privateStates) : deal % this.configuration.privateStates;
      this.informationSet[state] = this.configuration.privateStates * geometricSum(branching, stage) + own * histories + ordinal % histories;
      for (let action = 0; action < this.configuration.actionsPerDecision; action += 1) this.parentSeen[first + action] = 1;
      this.decisionNodes += 1;
    }
  }

  private processChance(start: number, end: number, offset: number, stage: number, levelIndex: number) {
    const next = this.provider.levels[levelIndex + 1];
    for (let state = start; state < end; state += 1) {
      const ordinal = state - offset;
      const first = next.offset + ordinal * this.configuration.publicSignals;
      this.kind[state] = 1;
      this.firstChild[state] = first;
      this.childCount[state] = this.configuration.publicSignals;
      const probabilities = chanceProbabilities(this.configuration, state, offset, stage);
      let total = 0;
      for (let signal = 0; signal < this.configuration.publicSignals; signal += 1) {
        const child = first + signal;
        const probability = probabilities.weights[signal] / probabilities.total;
        this.parentSeen[child] = 1;
        this.edgeProbability[child] = probability;
        total += probability;
      }
      this.chanceMaximumError = Math.max(this.chanceMaximumError, Math.abs(total - 1));
      this.chanceNodes += 1;
    }
  }

  private processTerminals(start: number, end: number, offset: number) {
    for (let state = start; state < end; state += 1) {
      this.kind[state] = 0;
      const utility = terminalUtility(this.configuration, state, offset);
      this.terminalP0[state] = utility;
      if (!Number.isFinite(utility)) this.issues.push(`terminal-utility:${state}`);
      this.terminals += 1;
    }
  }

  cancelAndRelease() {
    if (this.status === "complete") throw new Error("Cannot discard a completed compilation.");
    const releasedBytes = this.kind.byteLength + this.actor.byteLength + this.firstChild.byteLength
      + this.childCount.byteLength + this.informationSet.byteLength + this.edgeProbability.byteLength
      + this.terminalP0.byteLength + this.parentSeen.byteLength + this.informationSetActionOffset.byteLength
      + this.informationSetActionCount.byteLength;
    this.status = "cancelled";
    this.kind = new Uint8Array();
    this.actor = new Int8Array();
    this.firstChild = new Uint32Array();
    this.childCount = new Uint16Array();
    this.informationSet = new Int32Array();
    this.edgeProbability = new Float64Array();
    this.terminalP0 = new Float64Array();
    this.parentSeen = new Uint8Array();
    this.informationSetActionOffset = new Uint32Array();
    this.informationSetActionCount = new Uint16Array();
    return { releasedBytes, progress: this.progress() };
  }
  progress(): IncrementalProgress {
    return {
      status: this.status,
      processedNodes: this.cursor,
      totalNodes: this.provider.nodeCount,
      fraction: this.cursor / this.provider.nodeCount,
      chunks: this.profile.chunks,
      issues: [...this.issues],
    };
  }

  finish(): CompactCompilation & { provider: SyntheticCompactProvider; structuralHash: string; profile: CompilerV2Profile; compilerVersion: string } {
    if (this.status !== "complete" || this.cursor !== this.provider.nodeCount) {
      throw new Error(`Cannot finalize ${this.status} compilation at ${this.cursor}/${this.provider.nodeCount} nodes.`);
    }
    const finalizationStarted = performance.now();
    const allReachable = this.parentSeen.every((value) => value === 1);
    if (!allReachable) this.issues.push("unreachable-node");
    if (this.chanceMaximumError > 1e-12) this.issues.push("chance-normalization");
    if (this.maximumZeroSumError > 1e-12) this.issues.push("zero-sum");
    const perfectStarted = performance.now();
    const noInformationLeakage = this.provider.validationClaims.noInformationLeakage;
    const perfectRecall = this.provider.validationClaims.perfectRecall;
    this.profile.perfectRecallValidationMs += performance.now() - perfectStarted;
    if (!noInformationLeakage) this.issues.push("information-leakage-unvalidated");
    if (!perfectRecall) this.issues.push("perfect-recall-unvalidated");
    const tree: CompactIndexedTree = {
      version: COMPACT_TREE_VERSION,
      gameId: this.provider.id,
      gameHash: this.provider.logicalGameHash,
      root: 0,
      kind: this.kind,
      actor: this.actor,
      firstChild: this.firstChild,
      childCount: this.childCount,
      informationSet: this.informationSet,
      edgeProbability: this.edgeProbability,
      terminalP0: this.terminalP0,
      informationSetActionOffset: this.informationSetActionOffset,
      informationSetActionCount: this.informationSetActionCount,
      levels: this.provider.levels,
      totalInformationSetActions: this.totalInformationSetActions,
      maximumDepth: this.provider.maximumDepth,
      validation: {
        valid: this.issues.length === 0,
        issues: [...this.issues],
        nodes: this.provider.nodeCount,
        terminals: this.terminals,
        chanceNodes: this.chanceNodes,
        decisionNodes: this.decisionNodes,
        informationSets: this.provider.informationSetCount,
        chanceMaximumError: this.chanceMaximumError,
        maximumZeroSumError: this.maximumZeroSumError,
        allReachable,
        noInformationLeakage,
        perfectRecall,
      },
    };
    const hashStarted = performance.now();
    const structuralHash = structuralHashCompactTree(tree);
    this.profile.structuralHashMs = performance.now() - hashStarted;
    this.profile.finalizationMs = performance.now() - finalizationStarted;
    this.profile.totalMs = performance.now() - this.started;
    const cpu = process.cpuUsage(this.cpuStarted);
    this.profile.cpuUserMicros = cpu.user;
    this.profile.cpuSystemMicros = cpu.system;
    const topologyBytes = compactTopologyBytes(tree);
    const registryBytes = compactRegistryBytes(tree);
    return {
      provider: this.provider,
      tree,
      compilationMs: this.profile.totalMs,
      topologyBytes,
      registryBytes,
      temporaryBytes: this.parentSeen.byteLength,
      bytesPerNode: (topologyBytes + registryBytes) / this.provider.nodeCount,
      structuralHash,
      profile: { ...this.profile },
      compilerVersion: FAST_COMPILER_VERSION,
    };
  }
}

export function compileSyntheticGameV2(
  configuration: SyntheticGameConfiguration,
  options: ConstructorParameters<typeof IncrementalSyntheticCompiler>[1] = {},
) {
  const compiler = new IncrementalSyntheticCompiler(configuration, options);
  while (compiler.progress().status === "partial") compiler.processNextChunk();
  return compiler.finish();
}

export function restoreSolverWithCompiledTree(
  compilation: ReturnType<typeof compileSyntheticGameV2>,
  configuration: ConstructorParameters<typeof CompactCfrSolver>[2],
) {
  return new CompactCfrSolver(compilation.provider, compilation.tree, configuration);
}

export function compilerIdentity(configuration: SyntheticGameConfiguration) {
  return {
    configuration,
    providerVersion: COMPACT_SYNTHETIC_PROVIDER_VERSION,
    structuralSchemaVersion: COMPACT_TREE_VERSION,
    compilerVersion: FAST_COMPILER_VERSION,
  };
}
