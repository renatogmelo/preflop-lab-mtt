import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CompactCfrSolver, compactConfiguration } from "../solver/research/compact/compact-cfr.ts";
import { strategyArrayProbability } from "../solver/research/compact/compact-tree.ts";
import { compileSyntheticGameV2 } from "../solver/research/fast-compiler/compiler-v2.ts";
import { createStructuralCacheIdentity, serializeStructuralCache } from "../solver/research/fast-compiler/structural-cache-v1.ts";
import { deserializeBinaryCheckpointV5, restoreBinaryCheckpointV5, serializeBinaryCheckpointV5 } from "../solver/research/resource-safe/binary-checkpoint-v5.ts";
import { runIsolatedExperiment } from "../solver/research/resource-safe/isolated-runner.ts";
import { SCALE_CONFIGURATIONS } from "../solver/research/scalability/experiment-runner.ts";
import { compileWithDispatch } from "../solver/research/generic/compiler-dispatch.ts";
import { CompiledTreeProvider, IncrementalGenericCompiler, compileGenericGame } from "../solver/research/generic/compiler-v3.ts";
import { evaluateGenericCompactGame } from "../solver/research/generic/generic-evaluation.ts";
import { evaluateIndependentOracle } from "../solver/research/generic/independent-oracle.ts";
import {
  permuteProviderPlayers,
  permuteProviderStateKeys,
  renameProviderActions,
  reverseProviderActions,
  scaleProviderUtilities,
} from "../solver/research/generic/metamorphic-v2.ts";
import {
  AsymmetricChanceProvider,
  IrregularBranchingProvider,
  VariableDepthHiddenInformationProvider,
  regularSyntheticProviderV2,
} from "../solver/research/generic/synthetic-families.ts";
import {
  createStructuralCacheIdentityV2,
  deserializeStructuralCacheV2,
  serializeStructuralCacheV2,
} from "../solver/research/generic/structural-cache-v2.ts";
import { writeStructuralCacheV2Atomic } from "../solver/research/generic/structural-cache-v2-io.ts";

const scale = (level) => SCALE_CONFIGURATIONS.find((entry) => entry.level === level).configuration;
const bytesEqual = (left, right) => Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(Buffer.from(right.buffer, right.byteOffset, right.byteLength));
const arrays = ["kind", "actor", "firstChild", "childCount", "informationSet", "edgeProbability", "terminalP0", "informationSetActionOffset", "informationSetActionCount"];

function identity(compilation, suffix = "test") {
  return createStructuralCacheIdentityV2({
    gameId: compilation.tree.gameId,
    gameHash: compilation.tree.gameHash,
    compilerVersion: compilation.compilerVersion,
    configurationHash: suffix,
    actionOrdering: "provider-v2-stable-order",
    utilityModel: "two-player-zero-sum",
  });
}

function uniformEvaluation(provider) {
  const compilation = compileGenericGame(provider, { maximumNodes: 100_000, growthPolicy: "segmented", segmentSize: 32 });
  const strategy = new Float64Array(compilation.tree.totalInformationSetActions);
  for (let info = 0; info < compilation.tree.informationSetActionCount.length; info += 1) {
    const offset = compilation.tree.informationSetActionOffset[info];
    const count = compilation.tree.informationSetActionCount[info];
    for (let action = 0; action < count; action += 1) strategy[offset + action] = 1 / count;
  }
  return { compilation, evaluation: evaluateGenericCompactGame(compilation.tree, strategyArrayProbability(compilation.tree, strategy)) };
}

test("Phase 6.12 Provider Contract V2 compiles three irregular synthetic families", () => {
  const providers = [
    new IrregularBranchingProvider({ id: "irregular-test", seed: 612, maximumDepth: 6, minimumTerminalDepth: 2, maximumBranching: 4 }),
    new VariableDepthHiddenInformationProvider(),
    new AsymmetricChanceProvider(),
  ];
  for (const provider of providers) {
    const compiled = compileGenericGame(provider, { maximumNodes: 100_000 });
    assert.equal(compiled.tree.validation.valid, true);
    assert.equal(compiled.tree.validation.perfectRecall, true);
    assert.equal(compiled.tree.validation.noInformationLeakage, true);
    assert.ok(compiled.tree.kind.length > 1);
  }
});

test("Phase 6.12 Generic Compiler V3 is byte-identical to V2 on regular S2", () => {
  const configuration = scale("S2");
  const generic = compileGenericGame(regularSyntheticProviderV2(configuration), { maximumNodes: 10_000 });
  const specialized = compileSyntheticGameV2(configuration, { maximumNodes: 10_000 });
  for (const name of arrays) assert.equal(bytesEqual(generic.tree[name], specialized.tree[name]), true, name);
  assert.equal(generic.structuralHash, specialized.structuralHash);
});

test("Phase 6.12 unknown node count uses segmented growth and stable indices", () => {
  const provider = new IrregularBranchingProvider({ id: "unknown-count", seed: 77, maximumDepth: 8, minimumTerminalDepth: 2, maximumBranching: 5 });
  assert.equal(provider.capabilities.exactNodeCount, undefined);
  const compiled = compileGenericGame(provider, { initialCapacity: 8, segmentSize: 64, maximumNodes: 100_000 });
  assert.equal(compiled.profile.policy, "segmented");
  assert.ok(compiled.profile.reallocations > 0);
  assert.equal(compiled.profile.bytesCopied, compiled.profile.finalizationBytesCopied);
  for (let node = 0; node < compiled.tree.kind.length; node += 1) if (compiled.tree.kind[node] !== 0) assert.ok(compiled.tree.firstChild[node] > node);
});

test("Phase 6.12 geometric, chunked and segmented growth produce identical topology", () => {
  const make = () => new IrregularBranchingProvider({ id: "growth-compare", seed: 91, maximumDepth: 8, minimumTerminalDepth: 2, maximumBranching: 5 });
  const results = ["geometric", "chunked", "segmented"].map((growthPolicy) => compileGenericGame(make(), { growthPolicy, initialCapacity: 8, segmentSize: 64, maximumNodes: 100_000 }));
  assert.equal(new Set(results.map((entry) => entry.structuralHash)).size, 1);
  assert.ok(results[0].profile.bytesCopied > results[2].profile.bytesCopied);
  assert.ok(results[1].profile.bytesCopied > results[2].profile.bytesCopied);
});

test("Phase 6.12 chunk sizes and initial capacities do not change topology", () => {
  const variants = [[4, 8], [17, 16], [128, 64]].map(([processingChunkSize, initialCapacity]) => compileGenericGame(
    new IrregularBranchingProvider({ id: "chunk-stability", seed: 101, maximumDepth: 7, minimumTerminalDepth: 2, maximumBranching: 4 }),
    { processingChunkSize, initialCapacity, segmentSize: 32, maximumNodes: 100_000 },
  ));
  assert.equal(new Set(variants.map((entry) => entry.structuralHash)).size, 1);
});

test("Phase 6.12 dispatch selects validated fast path and safe generic path", () => {
  const configuration = scale("S1");
  const fast = compileWithDispatch(regularSyntheticProviderV2(configuration), { regularConfiguration: configuration, maximumNodes: 10_000 });
  const generic = compileWithDispatch(new AsymmetricChanceProvider(), { maximumNodes: 1_000 });
  assert.equal(fast.path, "fast-v2");
  assert.equal(generic.path, "generic-v3");
});

test("Phase 6.12 dispatch rejects inconsistent fast-path capability", () => {
  const configuration = scale("S0");
  const provider = regularSyntheticProviderV2(configuration);
  const broken = { ...provider, capabilities: { ...provider.capabilities, fastPath: { ...provider.capabilities.fastPath, configurationHash: "wrong" } } };
  assert.throws(() => compileWithDispatch(broken, { regularConfiguration: configuration }), /inconsistent/);
});

test("Phase 6.12 variable depth, branching and nonuniform chance are preserved", () => {
  const irregular = compileGenericGame(new IrregularBranchingProvider({ id: "shape", seed: 44, maximumDepth: 7, minimumTerminalDepth: 2, maximumBranching: 5 }), { maximumNodes: 100_000 }).tree;
  assert.ok(new Set(Array.from(irregular.childCount).filter(Boolean)).size > 1);
  const hidden = compileGenericGame(new VariableDepthHiddenInformationProvider()).tree;
  const terminalDepths = hidden.levels.filter((level) => Array.from(hidden.kind.subarray(level.offset, level.offset + level.count)).includes(0)).map((level) => level.stage);
  assert.ok(new Set(terminalDepths).size > 1);
  const chance = compileGenericGame(new AsymmetricChanceProvider()).tree;
  assert.ok(Array.from(chance.edgeProbability).includes(0.1));
  assert.ok(Array.from(chance.edgeProbability).includes(0.75));
});

test("Phase 6.12 canonical information-set IDs are independent from buffer allocation", () => {
  const left = compileGenericGame(new VariableDepthHiddenInformationProvider(), { initialCapacity: 1, segmentSize: 3 });
  const right = compileGenericGame(new VariableDepthHiddenInformationProvider(), { initialCapacity: 128, segmentSize: 64 });
  assert.deepEqual(left.informationSetKeys, right.informationSetKeys);
  assert.equal(bytesEqual(left.tree.informationSet, right.tree.informationSet), true);
});

test("Phase 6.12 rejects cycles, invalid chance and non-finite terminals", () => {
  const base = {
    id: "invalid", version: "1", semanticIdentity: "invalid", capabilities: { deterministic: true, twoPlayerZeroSum: true },
    initialState: () => 0, stateKey: (state) => String(state), actionKey: (_state, action) => String(action), actionLabel: (_state, action) => String(action),
    informationSetKey: () => "i", informationSetAudit: () => ({ ownObservation: "o", publicHistory: "p" }),
  };
  const cycle = { ...base, actor: () => 0, legalActions: () => [0], transition: () => 0, chanceProbability: () => 0, terminalUtility: () => null };
  assert.throws(() => compileGenericGame(cycle), /cycle or multiple-parent/);
  const chance = { ...base, actor: (state) => state === 0 ? "chance" : null, legalActions: (state) => state === 0 ? [0, 1] : [], transition: (_state, action) => action + 1, chanceProbability: () => 0.4, terminalUtility: (state) => state === 0 ? null : [0, 0] };
  assert.throws(() => compileGenericGame(chance), /not normalized/);
  const nan = { ...base, actor: () => null, legalActions: () => [], transition: () => 1, chanceProbability: () => 0, terminalUtility: () => [Number.NaN, Number.NaN] };
  assert.throws(() => compileGenericGame(nan), /invalid utility/);
});

test("Phase 6.12 rejects information-set inconsistency and non-deterministic providers", () => {
  const inconsistent = {
    id: "bad-info", version: "1", semanticIdentity: "bad-info", capabilities: { deterministic: true, twoPlayerZeroSum: true },
    initialState: () => ({ phase: "root" }), stateKey: (state) => JSON.stringify(state),
    actor: (state) => state.phase === "root" ? "chance" : state.phase === "decision" ? 0 : null,
    legalActions: (state) => state.phase === "root" ? [0, 1] : state.phase === "decision" ? Array.from({ length: state.branch + 1 }, (_, index) => index) : [],
    actionKey: (_state, action) => String(action), actionLabel: (_state, action) => String(action),
    transition: (state, action) => state.phase === "root" ? { phase: "decision", branch: action } : { phase: "terminal", branch: state.branch, action },
    chanceProbability: (state) => state.phase === "root" ? 0.5 : 0,
    informationSetKey: () => "same", informationSetAudit: () => ({ ownObservation: "same", publicHistory: "same" }),
    terminalUtility: (state) => state.phase === "terminal" ? [0, 0] : null,
  };
  assert.throws(() => compileGenericGame(inconsistent), /inconsistent or violates perfect recall/);
  let toggle = false;
  const nondeterministic = { ...inconsistent, initialState: () => ({ phase: "terminal" }), stateKey: () => String(toggle = !toggle), actor: () => null, legalActions: () => [], terminalUtility: () => [0, 0] };
  assert.throws(() => compileGenericGame(nondeterministic), /non-deterministic/);
});

test("Phase 6.12 generic compiler aborts safely and releases partial state", () => {
  const provider = new IrregularBranchingProvider({ id: "budget", seed: 12, maximumDepth: 10, minimumTerminalDepth: 2, maximumBranching: 5 });
  const compiler = new IncrementalGenericCompiler(provider, { maximumNodes: 50, processingChunkSize: 8 });
  assert.throws(() => { while (compiler.progress().status === "partial") compiler.processNextChunk(); }, /node budget/);
  const released = compiler.cancelAndRelease();
  assert.equal(released.progress.status, "cancelled");
  assert.ok(released.releasedNodes > 0);
});

test("Phase 6.12 Structural Cache V2 safe-copy round-trips every array", () => {
  const compilation = compileGenericGame(new VariableDepthHiddenInformationProvider());
  const cacheIdentity = identity(compilation);
  const serialized = serializeStructuralCacheV2(compilation.tree, cacheIdentity);
  const loaded = deserializeStructuralCacheV2(serialized.buffer, cacheIdentity, { mode: "safe-copy" });
  for (const name of arrays) assert.equal(bytesEqual(compilation.tree[name], loaded.tree[name]), true, name);
  assert.equal(loaded.copyAccounting.explicitPayloadBytesCopied, compilation.topologyBytes + compilation.registryBytes);
  assert.equal(loaded.copyAccounting.retainedInputBytes, 0);
});

test("Phase 6.12 shared-view loader copies zero payload bytes and detects mutation", () => {
  const compilation = compileGenericGame(new AsymmetricChanceProvider());
  const cacheIdentity = identity(compilation);
  const serialized = serializeStructuralCacheV2(compilation.tree, cacheIdentity);
  const loaded = deserializeStructuralCacheV2(serialized.buffer, cacheIdentity, { mode: "shared-view" });
  assert.equal(loaded.copyAccounting.explicitPayloadBytesCopied, 0);
  assert.equal(loaded.copyAccounting.backingArrayAllocations, 0);
  assert.ok(loaded.copyAccounting.retainedInputBytes > 0);
  assert.equal(loaded.lease.assertUnmodified(), true);
  loaded.tree.kind[0] = 9;
  assert.throws(() => loaded.lease.assertUnmodified(), /mutated/);
});

test("Phase 6.12 Cache V2 rejects corruption, identity and alignment errors", () => {
  const compilation = compileGenericGame(new AsymmetricChanceProvider());
  const cacheIdentity = identity(compilation);
  const serialized = serializeStructuralCacheV2(compilation.tree, cacheIdentity).buffer;
  const corrupted = Buffer.from(serialized);
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => deserializeStructuralCacheV2(corrupted, cacheIdentity), /checksum mismatch/);
  assert.throws(() => deserializeStructuralCacheV2(serialized, { ...cacheIdentity, configurationHash: "changed" }), /identity mismatch/);
  const misaligned = serialized.subarray(1);
  assert.throws(() => deserializeStructuralCacheV2(misaligned, cacheIdentity), /magic or length/);
});

test("Phase 6.12 Cache V2 reads Structural Cache V1 through explicit compatibility", () => {
  const configuration = scale("S0");
  const compilation = compileSyntheticGameV2(configuration);
  const v1Identity = createStructuralCacheIdentity(configuration);
  const v1 = serializeStructuralCache(compilation.tree, v1Identity).buffer;
  const loaded = deserializeStructuralCacheV2(v1, identity(compilation), { expectedV1Identity: v1Identity });
  assert.equal(loaded.format, "v1-compatibility");
  assert.equal(bytesEqual(loaded.tree.kind, compilation.tree.kind), true);
});

test("Phase 6.12 Cache V2 atomic writer preserves an immutable valid target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase612-cache-"));
  try {
    const compilation = compileGenericGame(new AsymmetricChanceProvider());
    const cacheIdentity = identity(compilation);
    const target = join(directory, "topology.plscv2");
    const first = await writeStructuralCacheV2Atomic(target, compilation.tree, cacheIdentity);
    const second = await writeStructuralCacheV2Atomic(target, compilation.tree, cacheIdentity);
    assert.equal(first.written, true);
    assert.equal(second.written, false);
    assert.ok((await readFile(target)).length > 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Phase 6.12 independent mathematical oracles match compact evaluation", () => {
  const providers = [
    new IrregularBranchingProvider({ id: "oracle-irregular", seed: 1, maximumDepth: 5, minimumTerminalDepth: 2, maximumBranching: 3 }),
    new VariableDepthHiddenInformationProvider(),
    new AsymmetricChanceProvider(),
  ];
  for (const provider of providers) {
    const { evaluation } = uniformEvaluation(provider);
    const oracle = evaluateIndependentOracle(provider);
    assert.ok(Math.abs(evaluation.utilities[0] - oracle.uniformUtilities[0]) <= 1e-12);
    assert.ok(Math.abs(evaluation.bestResponseValues[0] - oracle.bestResponseValues[0]) <= 1e-12);
    assert.ok(Math.abs(evaluation.bestResponseValues[1] - oracle.bestResponseValues[1]) <= 1e-12);
    assert.ok(Math.abs(evaluation.nashConv - oracle.nashConv) <= 1e-12);
  }
});

test("Phase 6.12 metamorphic action, chance and state transformations preserve mathematics", () => {
  const base = new AsymmetricChanceProvider();
  const expected = uniformEvaluation(base).evaluation;
  for (const provider of [renameProviderActions(base), reverseProviderActions(base), permuteProviderStateKeys(base)]) {
    const actual = uniformEvaluation(provider).evaluation;
    assert.ok(Math.abs(actual.utilities[0] - expected.utilities[0]) <= 1e-12);
    assert.ok(Math.abs(actual.nashConv - expected.nashConv) <= 1e-12);
  }
});

test("Phase 6.12 utility scaling and player permutation obey metamorphic laws", () => {
  const base = new AsymmetricChanceProvider();
  const expected = uniformEvaluation(base).evaluation;
  const scaled = uniformEvaluation(scaleProviderUtilities(base, 3)).evaluation;
  const swapped = uniformEvaluation(permuteProviderPlayers(base)).evaluation;
  assert.ok(Math.abs(scaled.utilities[0] - expected.utilities[0] * 3) <= 1e-12);
  assert.ok(Math.abs(scaled.nashConv - expected.nashConv * 3) <= 1e-12);
  assert.ok(Math.abs(swapped.utilities[0] + expected.utilities[0]) <= 1e-12);
  assert.ok(Math.abs(swapped.bestResponseValues[0] - expected.bestResponseValues[1]) <= 1e-12);
});

test("Phase 6.12 Checkpoint V5 resumes a generic cached topology deterministically", () => {
  const compilation = compileGenericGame(new VariableDepthHiddenInformationProvider());
  const cacheIdentity = identity(compilation);
  const cached = deserializeStructuralCacheV2(serializeStructuralCacheV2(compilation.tree, cacheIdentity).buffer, cacheIdentity).tree;
  const provider = new CompiledTreeProvider(cached);
  const configuration = compactConfiguration("dcfr");
  const interrupted = new CompactCfrSolver(provider, cached, configuration);
  interrupted.initialize();
  for (let index = 0; index < 3; index += 1) interrupted.iterate();
  const checkpoint = deserializeBinaryCheckpointV5(serializeBinaryCheckpointV5(interrupted).buffer);
  const resumed = new CompactCfrSolver(provider, cached, configuration);
  restoreBinaryCheckpointV5(resumed, checkpoint);
  for (let index = 0; index < 2; index += 1) resumed.iterate();
  const continuous = new CompactCfrSolver(provider, cached, configuration);
  continuous.initialize();
  for (let index = 0; index < 5; index += 1) continuous.iterate();
  assert.equal(resumed.stateHash, continuous.stateHash);
  assert.equal(resumed.iteration, continuous.iteration);
});

test("Phase 6.12 generic compiler runs under isolated watchdog and authorized node budget", async () => {
  const result = await runIsolatedExperiment({
    experimentId: "phase612-isolated-test", kind: "generic-compiler-profile", iterations: 0, evaluate: false, checkpoint: false,
    tier: "tier1", explicitLargeScaleAuthorization: false,
    genericFamily: "irregular-branching", genericScale: 3, genericGrowthPolicy: "segmented", genericInitialCapacity: 16, chunkSize: 64,
    preflight: { decision: "ALLOW", tier: "tier1", reasons: [], estimate: { nodes: 10_000 } },
    limits: { maximumRssBytes: 512 * 1024 * 1024, maximumRuntimeMs: 15_000, maximumIdleMs: 5_000, maximumIterations: 1, sampleIntervalMs: 100 },
  });
  assert.equal(result.terminationReason, "completed");
  assert.equal(result.result?.growthPolicy, "segmented");
  assert.ok(result.peakRssObservedBytes > 0);
});


test("Phase 6.12 isolated generic compiler aborts safely at the authorized structural limit", async () => {
  const result = await runIsolatedExperiment({
    experimentId: "phase612-isolated-abort-test", kind: "generic-compiler-profile", iterations: 0, evaluate: false, checkpoint: false,
    tier: "tier1", explicitLargeScaleAuthorization: false,
    genericFamily: "irregular-branching", genericScale: 6, genericGrowthPolicy: "segmented", genericInitialCapacity: 16, chunkSize: 64,
    preflight: { decision: "ALLOW", tier: "tier1", reasons: ["deliberately-small-test-budget"], estimate: { nodes: 100 } },
    limits: { maximumRssBytes: 512 * 1024 * 1024, maximumRuntimeMs: 15_000, maximumIdleMs: 5_000, maximumIterations: 1, sampleIntervalMs: 100 },
  });
  assert.equal(result.terminationReason, "structural-limit");
  assert.match(result.error, /STRUCTURAL_LIMIT/);
});
