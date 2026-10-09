import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { CompactCfrSolver } from "../solver/research/compact/compact-cfr.ts";
import { compileCompactGame } from "../solver/research/compact/compact-tree.ts";
import { SyntheticCompactProvider } from "../solver/research/compact/synthetic-compact-provider.ts";
import { SCALE_CONFIGURATIONS } from "../solver/research/scalability/experiment-runner.ts";
import { runIsolatedExperiment } from "../solver/research/resource-safe/isolated-runner.ts";
import { preflightV3 } from "../solver/research/resource-safe/resource-policy-v3.ts";
import { deserializeBinaryCheckpointV5, restoreBinaryCheckpointV5, serializeBinaryCheckpointV5 } from "../solver/research/resource-safe/binary-checkpoint-v5.ts";
import { IncrementalSyntheticCompiler, compileSyntheticGameV2, structuralHashCompactTree } from "../solver/research/fast-compiler/compiler-v2.ts";
import { loadOrCompileStructuralTopology } from "../solver/research/fast-compiler/cache-coordinator.ts";
import { compareCompactTrees, decodeRustTopology, runRustStructuralCompiler } from "../solver/research/fast-compiler/rust-interop.ts";
import {
  createStructuralCacheIdentity,
  deserializeStructuralCache,
  loadStructuralCache,
  recoverStructuralCache,
  serializeStructuralCache,
  structuralCacheKey,
  validateCompactTreeInvariants,
  writeStructuralCacheAtomic,
} from "../solver/research/fast-compiler/structural-cache-v1.ts";

const s0 = SCALE_CONFIGURATIONS[0].configuration;
const s1 = SCALE_CONFIGURATIONS[1].configuration;
const solverConfiguration = { algorithm: "dcfr", seed: 611, exactMetrics: false, engine: "indexed-tree", dcfr: { alpha: 2, beta: 0, gamma: 3 } };
const arrays = ["kind", "actor", "firstChild", "childCount", "informationSet", "edgeProbability", "terminalP0", "informationSetActionOffset", "informationSetActionCount"];

function compareTrees(left, right) {
  assert.equal(left.gameHash, right.gameHash);
  assert.deepEqual(left.levels, right.levels);
  assert.deepEqual(left.validation, right.validation);
  for (const name of arrays) assert.deepEqual(left[name], right[name], name);
  assert.equal(structuralHashCompactTree(left), structuralHashCompactTree(right));
}

test("Phase 6.11 Compiler V2 is structurally identical to the TypeScript baseline", () => {
  for (const configuration of [s0, s1]) {
    const baseline = compileCompactGame(new SyntheticCompactProvider(configuration)).tree;
    const optimized = compileSyntheticGameV2(configuration, { chunkSize: 4096 });
    compareTrees(optimized.tree, baseline);
    assert.equal(optimized.profile.chunks >= 1, true);
  }
});

test("Phase 6.11 Compiler V2 preserves solver numeric results", () => {
  const provider = new SyntheticCompactProvider(s1);
  const baseline = compileCompactGame(provider).tree;
  const optimized = compileSyntheticGameV2(s1).tree;
  const left = new CompactCfrSolver(provider, baseline, solverConfiguration);
  const right = new CompactCfrSolver(provider, optimized, solverConfiguration);
  left.solve({ maxIterations: 8, collectExactMetrics: false });
  right.solve({ maxIterations: 8, collectExactMetrics: false });
  assert.equal(right.stateHash, left.stateHash);
  assert.deepEqual(right.averageStrategyArray(), left.averageStrategyArray());
});

test("Phase 6.11 incremental compilation exposes honest partial state and deterministic continuation", () => {
  const incremental = new IncrementalSyntheticCompiler(s1, { chunkSize: 17 });
  const first = incremental.processNextChunk();
  assert.equal(first.status, "partial");
  assert.equal(first.processedNodes, 17);
  assert.throws(() => incremental.finish(), /Cannot finalize partial/);
  while (incremental.progress().status === "partial") incremental.processNextChunk();
  compareTrees(incremental.finish().tree, compileSyntheticGameV2(s1, { chunkSize: 65_536 }).tree);
});

test("Phase 6.11 supported chunk sizes compile identical topology", () => {
  const hashes = [4096, 16_384, 65_536, 262_144].map((chunkSize) => compileSyntheticGameV2(s1, { chunkSize }).structuralHash);
  assert.equal(new Set(hashes).size, 1);
});

test("Phase 6.11 cancellation and structural budgets fail closed and release buffers", () => {
  const controller = new AbortController();
  const compiler = new IncrementalSyntheticCompiler(s1, { chunkSize: 10, signal: controller.signal });
  compiler.processNextChunk();
  controller.abort();
  assert.throws(() => compiler.processNextChunk(), /cancelled/);
  const discarded = compiler.cancelAndRelease();
  assert.ok(discarded.releasedBytes > 0);
  assert.equal(compiler.kind.byteLength, 0);
  assert.equal(compiler.progress().status, "cancelled");
  assert.throws(() => new IncrementalSyntheticCompiler(s1, { maximumNodes: 1 }), /Structural budget/);
  const failed = new IncrementalSyntheticCompiler(s0);
  assert.throws(() => failed.processNextChunk(0), /positive integer/);
  assert.equal(failed.progress().status, "failed");
});

test("Phase 6.11 Structural Cache V1 round-trips every typed array", () => {
  const compiled = compileSyntheticGameV2(s1);
  const identity = createStructuralCacheIdentity(s1);
  const serialized = serializeStructuralCache(compiled.tree, identity, "test");
  const decoded = deserializeStructuralCache(serialized.buffer, identity);
  compareTrees(decoded.tree, compiled.tree);
  assert.equal(decoded.header.identityHash, structuralCacheKey(identity));
  assert.equal(decoded.header.endianness, "little");
  assert.equal(decoded.header.nodeCount, compiled.tree.kind.length);
  assert.equal(validateCompactTreeInvariants(decoded.tree).length, 0);
});

test("Phase 6.11 Structural Cache V1 rejects corruption, truncation and version mismatch", () => {
  const compiled = compileSyntheticGameV2(s0);
  const identity = createStructuralCacheIdentity(s0);
  const serialized = serializeStructuralCache(compiled.tree, identity, "test").buffer;
  assert.throws(() => deserializeStructuralCache(serialized.subarray(0, 40), identity), /truncated/);
  const corrupt = Buffer.from(serialized);
  corrupt[corrupt.length - 1] ^= 0xff;
  assert.throws(() => deserializeStructuralCache(corrupt, identity), /checksum mismatch/);
  const version = Buffer.from(serialized);
  version.writeUInt32LE(99, 8);
  assert.throws(() => deserializeStructuralCache(version, identity), /version mismatch/);
});

test("Phase 6.11 Structural Cache V1 invalidates changed game identity", async () => {
  const compiled = compileSyntheticGameV2(s0);
  const identity = createStructuralCacheIdentity(s0);
  const changed = createStructuralCacheIdentity({ ...s0, seed: s0.seed + 1 });
  assert.throws(() => deserializeStructuralCache(serializeStructuralCache(compiled.tree, identity).buffer, changed), /identity mismatch/);
  const directory = await mkdtemp(join(tmpdir(), "phase611-cache-miss-"));
  try {
    const path = join(directory, "tree.bin");
    await writeFile(path, serializeStructuralCache(compiled.tree, identity).buffer);
    const miss = await loadStructuralCache(path, changed);
    assert.equal(miss.hit, false);
    assert.equal(miss.reason, "identity-mismatch");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Phase 6.11 atomic cache write produces a reusable immutable cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase611-cache-atomic-"));
  try {
    const path = join(directory, "tree.bin");
    const compiled = compileSyntheticGameV2(s1);
    const identity = createStructuralCacheIdentity(s1);
    const first = await writeStructuralCacheAtomic(path, compiled.tree, identity);
    const second = await writeStructuralCacheAtomic(path, compiled.tree, identity);
    assert.equal(first.written, true);
    assert.equal(second.written, false);
    const loaded = await loadStructuralCache(path, identity);
    assert.equal(loaded.hit, true, loaded.error);
    compareTrees(loaded.tree, compiled.tree);
    assert.equal((await readFile(path)).length, first.fileBytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Phase 6.11 cached topology and checkpoint V5 resume together exactly", () => {
  const compiled = compileSyntheticGameV2(s1);
  const identity = createStructuralCacheIdentity(s1);
  const cachedTree = deserializeStructuralCache(serializeStructuralCache(compiled.tree, identity).buffer, identity).tree;
  const provider = new SyntheticCompactProvider(s1);
  const interrupted = new CompactCfrSolver(provider, compiled.tree, solverConfiguration);
  interrupted.solve({ maxIterations: 5, collectExactMetrics: false });
  const checkpoint = deserializeBinaryCheckpointV5(serializeBinaryCheckpointV5(interrupted).buffer);
  const resumed = new CompactCfrSolver(provider, cachedTree, solverConfiguration);
  restoreBinaryCheckpointV5(resumed, checkpoint);
  resumed.solve({ maxIterations: 11, collectExactMetrics: false });
  const continuous = new CompactCfrSolver(provider, compiled.tree, solverConfiguration);
  continuous.solve({ maxIterations: 11, collectExactMetrics: false });
  assert.equal(resumed.stateHash, continuous.stateHash);
});

test("Phase 6.11 metamorphic id change changes identity but preserves numeric topology arrays", () => {
  const changed = { ...s0, id: `${s0.id}-metamorphic` };
  const left = compileSyntheticGameV2(s0).tree;
  const right = compileSyntheticGameV2(changed).tree;
  assert.notEqual(left.gameHash, right.gameHash);
  for (const name of arrays) assert.deepEqual(left[name], right[name], name);
  assert.notEqual(structuralCacheKey(createStructuralCacheIdentity(s0)), structuralCacheKey(createStructuralCacheIdentity(changed)));
});
test("Phase 6.11 Rust compiler matches TypeScript topology across representative scales", async () => {
  const executable = resolve("solver/native/phase611-compiler/target/release/preflop-lab-structural-compiler.exe");
  const directory = await mkdtemp(join(tmpdir(), "phase611-rust-equivalence-"));
  try {
    for (const configuration of [s0, s1]) {
      const output = join(directory, `${configuration.id}.bin`);
      const native = await runRustStructuralCompiler({ executable, output, configuration });
      const typescript = compileSyntheticGameV2(configuration).tree;
      const comparison = compareCompactTrees(typescript, native.tree);
      assert.equal(comparison.equivalent, true, JSON.stringify(comparison));
      assert.ok(comparison.maximumUtilityError <= 1e-12);
      assert.ok(native.processMs > 0);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Phase 6.11 Rust binary rejects checksum corruption and wrong configuration", async () => {
  const executable = resolve("solver/native/phase611-compiler/target/release/preflop-lab-structural-compiler.exe");
  const directory = await mkdtemp(join(tmpdir(), "phase611-rust-corrupt-"));
  try {
    const output = join(directory, "tree.bin");
    await runRustStructuralCompiler({ executable, output, configuration: s0 });
    const bytes = await readFile(output);
    const corrupt = Buffer.from(bytes);
    corrupt[corrupt.length - 1] ^= 0xff;
    assert.throws(() => decodeRustTopology(corrupt, s0), /checksum mismatch/);
    assert.throws(() => decodeRustTopology(bytes, { ...s0, seed: s0.seed + 1 }), /configuration identity mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Phase 6.11 Rust compiler fails closed on structural overflow", async () => {
  const executable = resolve("solver/native/phase611-compiler/target/release/preflop-lab-structural-compiler.exe");
  const directory = await mkdtemp(join(tmpdir(), "phase611-rust-overflow-"));
  try {
    await assert.rejects(
      runRustStructuralCompiler({ executable, output: join(directory, "overflow.bin"), configuration: { ...s0, stages: 31 } }),
      /native-compiler-error/,
    );
    const recovered = await runRustStructuralCompiler({ executable, output: join(directory, "recovered.bin"), configuration: s0 });
    assert.equal(recovered.tree.validation.valid, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("Phase 6.11 structural cache interruption cleans temporary state and recovers valid target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase611-cache-recovery-"));
  try {
    const path = join(directory, "tree.bin");
    const compiled = compileSyntheticGameV2(s0);
    const identity = createStructuralCacheIdentity(s0);
    await assert.rejects(
      writeStructuralCacheAtomic(path, compiled.tree, identity, "test", { simulateFailureAfterSync: true }),
      /Simulated structural cache interruption/,
    );
    const emptyRecovery = await recoverStructuralCache(path, identity);
    assert.equal(emptyRecovery.recovered, false);
    await writeStructuralCacheAtomic(path, compiled.tree, identity, "test");
    const recovered = await recoverStructuralCache(path, identity);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.load.header.endianness, "little");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("Phase 6.11 exact preallocation matches authorized node and registry capacities", () => {
  const compiler = new IncrementalSyntheticCompiler(s1, { maximumNodes: new SyntheticCompactProvider(s1).nodeCount });
  assert.equal(compiler.kind.length, compiler.provider.nodeCount);
  assert.equal(compiler.parentSeen.length, compiler.provider.nodeCount);
  assert.equal(compiler.informationSetActionCount.length, compiler.provider.informationSetCount);
  assert.equal(compiler.informationSetActionOffset.length, compiler.provider.informationSetCount + 1);
  compiler.cancelAndRelease();
});

test("Phase 6.11 isolated compiler profile enforces Resource Policy V3 authorization", async () => {
  const limits = { maximumRssBytes: 256 * 1024 * 1024, maximumRuntimeMs: 10_000, maximumIdleMs: 3_000, maximumIterations: 2, sampleIntervalMs: 100 };
  const base = {
    experimentId: "phase611-isolated-test",
    kind: "compiler-profile",
    configuration: s0,
    solverConfiguration,
    iterations: 1,
    evaluate: true,
    checkpoint: false,
    tier: "tier0",
    explicitLargeScaleAuthorization: false,
    limits,
    compilerMode: "typescript-v2",
    chunkSize: 4096,
  };
  const denied = await runIsolatedExperiment(base);
  assert.equal(denied.terminationReason, "structural-limit");
  const allowed = await runIsolatedExperiment({
    ...base,
    experimentId: "phase611-isolated-allowed",
    preflight: preflightV3({ configuration: s0, tier: "tier0", iterations: 1, explicitLargeScaleAuthorization: false }),
  });
  assert.equal(allowed.terminationReason, "completed", allowed.error ?? "");
  assert.ok(allowed.stages.some((stage) => stage.stage === "cleanup"));
});
test("Phase 6.11 cache coordinator rebuilds misses and incompatible identities without overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase611-cache-coordinator-"));
  try {
    const primary = join(directory, "primary.cache");
    const first = await loadOrCompileStructuralTopology({ path: primary, configuration: s0, maximumNodes: new SyntheticCompactProvider(s0).nodeCount });
    assert.equal(first.source, "compiled");
    assert.equal(first.missReason, "not-found");
    const hit = await loadOrCompileStructuralTopology({ path: primary, configuration: s0 });
    assert.equal(hit.source, "cache");
    const changed = { ...s0, seed: s0.seed + 1 };
    const fallback = join(directory, "changed.cache");
    const rebuilt = await loadOrCompileStructuralTopology({ path: primary, fallbackPath: fallback, configuration: changed });
    assert.equal(rebuilt.source, "compiled");
    assert.equal(rebuilt.missReason, "identity-mismatch");
    const originalStillValid = await loadStructuralCache(primary, createStructuralCacheIdentity(s0));
    assert.equal(originalStillValid.hit, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});