import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashValue } from "../solver/core/stable.ts";
import { serializeBinaryCheckpointV5 } from "../solver/research/resource-safe/binary-checkpoint-v5.ts";
import { preflightV3 } from "../solver/research/resource-safe/resource-policy-v3.ts";
import { compileSyntheticGameV2 } from "../solver/research/fast-compiler/compiler-v2.ts";
import { createStructuralCacheIdentity, serializeStructuralCache } from "../solver/research/fast-compiler/structural-cache-v1.ts";
import { compileGenericGame } from "../solver/research/generic/compiler-v3.ts";
import { AsymmetricChanceProvider } from "../solver/research/generic/synthetic-families.ts";
import { createStructuralCacheIdentityV2, deserializeStructuralCacheV2, serializeStructuralCacheV2 } from "../solver/research/generic/structural-cache-v2.ts";
import { sealReliabilityArtifact, verifyReliabilityArtifact } from "../solver/research/reliability/artifact-writer.ts";
import { runConcurrentWriterProbe } from "../solver/research/reliability/concurrency-probe.ts";
import { runFaultChildV2 } from "../solver/research/reliability/crash-injection-v2.ts";
import { commitCheckpointGeneration } from "../solver/research/reliability/durable-checkpoint.ts";
import { ReliabilityError } from "../solver/research/reliability/errors.ts";
import { decodeCacheReliably, decodeCheckpointReliably, restoreCheckpointReliably } from "../solver/research/reliability/integrity.ts";
import { acquireWriterLease, createRunManifest, moveRunState, persistRunManifest, readRunManifest, updateRunManifest } from "../solver/research/reliability/manifest.ts";
import { recoverRunSafely } from "../solver/research/reliability/recovery-safe.ts";
import { RecoveryScheduler, discoverRuns } from "../solver/research/reliability/recovery-scheduler.ts";
import { buildReleaseReadinessMatrix, RELEASE_READINESS_CATEGORIES } from "../solver/research/reliability/release-readiness.ts";
import { runCrossProcessReproducibility } from "../solver/research/reliability/repro-runner.ts";
import { initializeReliabilityRun, createReliabilitySolver } from "../solver/research/reliability/runtime.ts";
import { IRREGULAR_SCALE_MATRIX } from "../solver/research/reliability/scale-runner.ts";
import { SharedViewLeaseRegistry } from "../solver/research/reliability/shared-view-leases.ts";
import { canTransition, transitionRun } from "../solver/research/reliability/state-machine.ts";
import { SCALE_CONFIGURATIONS } from "../solver/research/scalability/experiment-runner.ts";

const baseline = "c53579bd7b8d68d6bf7b48f4c68292b70099d1a2";
const temporary = async (prefix, body) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try { return await body(directory); } finally { await rm(directory, { recursive: true, force: true }); }
};
const iterateTo = (solver, target) => { while (solver.iteration < target) solver.iterate(); return solver; };
const setupCheckpointedRun = (directory, id = "run") => initializeReliabilityRun({ runDirectory: directory, runId: id, experimentId: id, commitSha: baseline, algorithm: "dcfr", iterationTarget: 6 });

test("Phase 6.15 state machine accepts declared transitions and rejects impossible ones", () => {
  assert.equal(canTransition("CREATED", "PREFLIGHT"), true);
  assert.equal(canTransition("COMPLETED", "RUNNING"), false);
  assert.throws(() => transitionRun("r", "CREATED", "COMPLETED", [], "invalid"), (error) => error instanceof ReliabilityError && error.code === "INVALID_TRANSITION");
});

test("Phase 6.15 manifest persistence is checksummed, atomic and rejects corruption", async () => temporary("phase615-manifest-", async (directory) => {
  const run = await setupCheckpointedRun(directory, "manifest-run");
  const path = join(directory, "manifest.json");
  const loaded = await readRunManifest(path);
  assert.equal(loaded.status, "RUNNING");
  assert.equal(loaded.contentChecksum, hashValue(Object.fromEntries(Object.entries(loaded).filter(([key]) => key !== "contentChecksum"))));
  const corrupted = { ...loaded, iterationTarget: 999 };
  await writeFile(path, JSON.stringify(corrupted));
  await assert.rejects(readRunManifest(path), (error) => error.code === "MANIFEST_INVALID");
  assert.equal(run.manifest.runId, "manifest-run");
}));

test("Phase 6.15 atomic checkpoint commit validates a complete V5 before manifest promotion", async () => temporary("phase615-atomic-", async (directory) => {
  const { solver } = await setupCheckpointedRun(directory, "atomic-run");
  iterateTo(solver, 2);
  const committed = await commitCheckpointGeneration(directory, solver);
  assert.equal(committed.record.iteration, 2);
  assert.equal((await readRunManifest(join(directory, "manifest.json"))).lastCommittedIteration, 2);
  assert.equal(decodeCheckpointReliably(await readFile(join(directory, committed.record.file))).semanticStateHash, committed.record.semanticStateHash);
}));

test("Phase 6.15 checkpoint generations retain current and previous valid states", async () => temporary("phase615-generations-", async (directory) => {
  const { solver } = await setupCheckpointedRun(directory, "generation-run");
  iterateTo(solver, 2); await commitCheckpointGeneration(directory, solver);
  iterateTo(solver, 4); await commitCheckpointGeneration(directory, solver);
  const manifest = await readRunManifest(join(directory, "manifest.json"));
  assert.deepEqual(manifest.checkpointGenerations.map((entry) => entry.iteration), [2, 4]);
}));

test("Phase 6.15 recovery falls back from corrupted latest generation and remains bit exact", async () => temporary("phase615-fallback-", async (directory) => {
  const { solver } = await setupCheckpointedRun(directory, "fallback-run");
  iterateTo(solver, 2); await commitCheckpointGeneration(directory, solver);
  iterateTo(solver, 4); const latest = await commitCheckpointGeneration(directory, solver);
  const bytes = await readFile(join(directory, latest.record.file)); bytes[bytes.length - 1] ^= 1; await writeFile(join(directory, latest.record.file), bytes);
  const resumed = createReliabilitySolver("dcfr").solver;
  const recovered = await recoverRunSafely(directory, resumed);
  assert.equal(recovered.fallbackUsed, true);
  assert.equal(resumed.iteration, 2);
  iterateTo(resumed, 6);
  const continuous = createReliabilitySolver("dcfr").solver; continuous.initialize(); iterateTo(continuous, 6);
  assert.equal(resumed.stateHash, continuous.stateHash);
}));

test("Phase 6.15 corruption matrix rejects magic, version, checksum, truncation and trailing bytes structurally", () => {
  const solver = createReliabilitySolver("dcfr").solver; solver.initialize(); iterateTo(solver, 2);
  const valid = serializeBinaryCheckpointV5(solver).buffer;
  const cases = [];
  const magic = Buffer.from(valid); magic[0] ^= 1; cases.push(magic);
  const version = Buffer.from(valid); version.writeUInt16LE(99, 8); cases.push(version);
  const checksum = Buffer.from(valid); checksum[checksum.length - 1] ^= 1; cases.push(checksum);
  cases.push(valid.subarray(0, valid.length - 1));
  cases.push(Buffer.concat([valid, Buffer.from([0])]));
  for (const value of cases) assert.throws(() => decodeCheckpointReliably(value), (error) => error instanceof ReliabilityError && ["CHECKPOINT_CORRUPTED", "CHECKPOINT_INCOMPATIBLE"].includes(error.code));
});

test("Phase 6.15 incompatible algorithm checkpoint is rejected without mutating target state", () => {
  const source = createReliabilitySolver("cfr-plus").solver; source.initialize(); iterateTo(source, 2);
  const target = createReliabilitySolver("dcfr").solver; target.initialize();
  const before = target.stateHash;
  assert.throws(() => restoreCheckpointReliably(target, serializeBinaryCheckpointV5(source).buffer), (error) => error.code === "CHECKPOINT_INCOMPATIBLE");
  assert.equal(target.stateHash, before);
});

test("Phase 6.15 real abrupt crash after temp write recovers previous generation bit exactly", async () => temporary("phase615-crash-", async (directory) => {
  const { solver } = await setupCheckpointedRun(directory, "crash-run"); iterateTo(solver, 2); await commitCheckpointGeneration(directory, solver);
  const crash = await runFaultChildV2({ runDirectory: directory, algorithm: "dcfr", checkpointIteration: 4, faultPoint: "after-temp-write" });
  assert.notEqual(crash.exitCode, 0);
  const resumed = createReliabilitySolver("dcfr").solver;
  const recovery = await recoverRunSafely(directory, resumed);
  assert.equal(recovery.staleLock.recovered, true);
  iterateTo(resumed, 6);
  const continuous = createReliabilitySolver("dcfr").solver; continuous.initialize(); iterateTo(continuous, 6);
  assert.equal(resumed.stateHash, continuous.stateHash);
}));

test("Phase 6.15 watchdog performs real child termination and leaves recoverable state", async () => temporary("phase615-watchdog-", async (directory) => {
  const { solver } = await setupCheckpointedRun(directory, "watchdog-run"); iterateTo(solver, 2); await commitCheckpointGeneration(directory, solver);
  const result = await runFaultChildV2({ runDirectory: directory, algorithm: "dcfr", checkpointIteration: 3, faultPoint: "watchdog-timeout", watchdogMs: 600 });
  assert.equal(result.watchdogTriggered, true);
  const resumed = createReliabilitySolver("dcfr").solver; await recoverRunSafely(directory, resumed);
  assert.equal(resumed.iteration, 2);
}));

test("Phase 6.15 external forced termination is distinguished from controlled cancellation", async () => temporary("phase615-external-", async (directory) => {
  const { solver } = await setupCheckpointedRun(directory, "external-run"); iterateTo(solver, 2); await commitCheckpointGeneration(directory, solver);
  const result = await runFaultChildV2({ runDirectory: directory, algorithm: "dcfr", checkpointIteration: 3, faultPoint: "external-kill" });
  assert.equal(result.externallyTerminated, true);
  assert.equal(result.watchdogTriggered, false);
}));

test("Phase 6.15 scheduler discovers recoverable runs and reports terminal runs", async () => temporary("phase615-scheduler-", async (root) => {
  await setupCheckpointedRun(join(root, "recoverable"), "recoverable");
  const terminal = await setupCheckpointedRun(join(root, "terminal"), "terminal");
  let manifest = moveRunState(terminal.manifest, "COMPLETED", "finished"); await persistRunManifest(join(root, "terminal", "manifest.json"), manifest);
  const discovered = await discoverRuns(root);
  assert.equal(discovered.runs.find((run) => run.manifest.runId === "recoverable").eligible, true);
  assert.equal(discovered.runs.find((run) => run.manifest.runId === "terminal").eligible, false);
  const result = await new RecoveryScheduler().resume(root, async () => ({ status: "resumed", details: "test" }));
  assert.equal(result.results.find((entry) => entry.runId === "recoverable").status, "resumed");
}));

test("Phase 6.15 duplicate scheduler ownership is prevented by an OS-visible lock", async () => temporary("phase615-duplicate-", async (directory) => {
  const target = join(directory, "run");
  const first = await acquireWriterLease(target, "first");
  await assert.rejects(acquireWriterLease(target, "second"), (error) => error.code === "CONCURRENT_WRITER");
  await first.release();
}));

test("Phase 6.15 concurrent real processes detect writer conflict", async () => temporary("phase615-process-lock-", async (directory) => {
  const result = await runConcurrentWriterProbe(join(directory, "checkpoint"));
  assert.equal(result.conflictDetected, true);
}));

test("Phase 6.15 Structural Cache V1 and V2 remain readable under explicit identities", () => {
  const configuration = SCALE_CONFIGURATIONS.find((entry) => entry.level === "S0").configuration;
  const compiled = compileSyntheticGameV2(configuration);
  const v1Identity = createStructuralCacheIdentity(configuration);
  const v1 = serializeStructuralCache(compiled.tree, v1Identity).buffer;
  const v2Identity = createStructuralCacheIdentityV2({ gameId: compiled.tree.gameId, gameHash: compiled.tree.gameHash, compilerVersion: "test", configurationHash: "test", actionOrdering: "stable", utilityModel: "zero-sum" });
  const compatible = deserializeStructuralCacheV2(v1, v2Identity, { expectedV1Identity: v1Identity });
  assert.equal(compatible.format, "v1-compatibility");
  const v2 = serializeStructuralCacheV2(compiled.tree, v2Identity).buffer;
  assert.equal(decodeCacheReliably(v2, v2Identity).format, "v2");
});

test("Phase 6.15 corrupted and incompatible caches produce structured errors", () => {
  const compilation = compileGenericGame(new AsymmetricChanceProvider());
  const identity = createStructuralCacheIdentityV2({ gameId: compilation.tree.gameId, gameHash: compilation.tree.gameHash, compilerVersion: compilation.compilerVersion, configurationHash: "a", actionOrdering: "provider", utilityModel: "zero-sum" });
  const bytes = serializeStructuralCacheV2(compilation.tree, identity).buffer;
  const corrupted = Buffer.from(bytes); corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => decodeCacheReliably(corrupted, identity), (error) => error.code === "CACHE_CORRUPTED");
  assert.throws(() => decodeCacheReliably(bytes, { ...identity, configurationHash: "b" }), (error) => error.code === "CACHE_INCOMPATIBLE");
});

test("Phase 6.15 shared-view registry enforces ownership, generation and invalidation", () => {
  const compilation = compileGenericGame(new AsymmetricChanceProvider());
  const identity = createStructuralCacheIdentityV2({ gameId: compilation.tree.gameId, gameHash: compilation.tree.gameHash, compilerVersion: compilation.compilerVersion, configurationHash: "lease", actionOrdering: "provider", utilityModel: "zero-sum" });
  const loaded = deserializeStructuralCacheV2(serializeStructuralCacheV2(compilation.tree, identity).buffer, identity, { mode: "shared-view" });
  const registry = new SharedViewLeaseRegistry();
  const managed = registry.register(loaded.lease, { owner: "run", generation: 1, cacheIdentity: identity.configurationHash });
  assert.equal(registry.assertUsable(managed.leaseId, { owner: "run", generation: 1, cacheIdentity: identity.configurationHash }), true);
  assert.throws(() => registry.assertUsable(managed.leaseId, { owner: "other", generation: 1, cacheIdentity: identity.configurationHash }), (error) => error.code === "CACHE_INCOMPATIBLE");
  assert.equal(registry.invalidateOlder(identity.configurationHash, 2), 1);
  assert.throws(() => registry.assertUsable(managed.leaseId, { owner: "run", generation: 1, cacheIdentity: identity.configurationHash }), (error) => error.code === "CACHE_INCOMPATIBLE");
});

test("Phase 6.15 Resource Policy V3 denies memory and node budgets without weakening limits", () => {
  const configuration = { id: "too-large", players: 2, privateStates: 4, publicSignals: 3, stages: 6, actionsPerDecision: 3, seed: 615, zeroSum: true, perfectRecall: true, dependencyComplexity: "history-coupled" };
  const result = preflightV3({ configuration, tier: "tier0", iterations: 1, explicitLargeScaleAuthorization: false });
  assert.equal(result.decision, "DENY");
  assert.ok(result.reasons.includes("tier0-node-budget") || result.reasons.includes("estimated-memory-budget"));
});

test("Phase 6.15 Resource Policy V3 enforces runtime and iteration budgets", () => {
  const configuration = { id: "runtime", players: 2, privateStates: 2, publicSignals: 2, stages: 3, actionsPerDecision: 2, seed: 615, zeroSum: true, perfectRecall: true, dependencyComplexity: "history-coupled" };
  const result = preflightV3({ configuration, tier: "tier0", iterations: 21, explicitLargeScaleAuthorization: false });
  assert.equal(result.decision, "DENY");
  assert.ok(result.reasons.includes("tier0-iteration-budget"));
});

test("Phase 6.15 irregular scale matrix covers ~40k through ~1m with 1m denied by preflight", () => {
  assert.deepEqual(IRREGULAR_SCALE_MATRIX.map((entry) => entry.label), ["~40k", "~100k", "~250k", "~500k", "~1m"]);
  assert.equal(IRREGULAR_SCALE_MATRIX.at(-1).preflight, "DENY");
  assert.ok(IRREGULAR_SCALE_MATRIX.slice(0, 4).every((entry) => entry.preflight === "ALLOW"));
});

test("Phase 6.15 deterministic resume preserves regrets, sums, average strategy and state hash", async () => temporary("phase615-deterministic-", async (directory) => {
  const { solver } = await setupCheckpointedRun(directory, "deterministic-run"); iterateTo(solver, 3); await commitCheckpointGeneration(directory, solver);
  const resumed = createReliabilitySolver("dcfr").solver; await recoverRunSafely(directory, resumed); iterateTo(resumed, 6);
  const continuous = createReliabilitySolver("dcfr").solver; continuous.initialize(); iterateTo(continuous, 6);
  assert.deepEqual(Array.from(resumed.regrets), Array.from(continuous.regrets));
  assert.deepEqual(Array.from(resumed.strategySums), Array.from(continuous.strategySums));
  assert.deepEqual(Array.from(resumed.averageStrategyArray()), Array.from(continuous.averageStrategyArray()));
  assert.equal(resumed.stateHash, continuous.stateHash);
}));

test("Phase 6.15 fresh processes reproduce configuration, topology, numeric state, EV and NashConv bit exactly", async () => {
  const result = await runCrossProcessReproducibility("dcfr", 20);
  assert.equal(result.bitExact, true);
});

test("Phase 6.15 artifact checksum detects mutation and forbids hidden unexpected failures", () => {
  const artifact = sealReliabilityArtifact({ runIdentity: "r", configurationIdentity: "c", createdAt: "2026-10-10T00:00:00.000Z", completionStatus: "complete", failureDetails: [], result: "PASS" });
  assert.equal(verifyReliabilityArtifact(artifact), true);
  assert.throws(() => verifyReliabilityArtifact({ ...artifact, result: "MUTATED" }), (error) => error.code === "ARTIFACT_INCOMPLETE");
  assert.throws(() => sealReliabilityArtifact({ runIdentity: "r", configurationIdentity: "c", createdAt: "x", completionStatus: "complete", failureDetails: [{ unexpected: true }] }));
});

test("Phase 6.15 structured errors serialize code, message and non-sensitive context", () => {
  const error = new ReliabilityError("RESOURCE_LIMIT", "budget exceeded", { budget: 10 });
  assert.deepEqual(error.toJSON(), { name: "ReliabilityError", code: "RESOURCE_LIMIT", message: "budget exceeded", context: { budget: 10 } });
});

test("Phase 6.15 critical manifest updates are idempotent when updater is idempotent", () => {
  let manifest = createRunManifest({ runId: "idempotent", experimentId: "e", commitSha: baseline, algorithm: "dcfr", algorithmVersion: "v", algorithmParameters: {}, providerIdentity: "p", structuralHash: "s", cacheVersion: "v2", checkpointVersion: 5, iterationTarget: 10, resourceBudgets: {}, environment: {} }, "2026-10-10T00:00:00.000Z");
  manifest = updateRunManifest(manifest, (draft) => { if (!draft.failureHistory.some((entry) => entry.code === "X")) draft.failureHistory.push({ code: "X", at: "x", message: "x", recoverable: true, context: {} }); }, "2026-10-10T00:00:01.000Z");
  manifest = updateRunManifest(manifest, (draft) => { if (!draft.failureHistory.some((entry) => entry.code === "X")) draft.failureHistory.push({ code: "X", at: "x", message: "x", recoverable: true, context: {} }); }, "2026-10-10T00:00:02.000Z");
  assert.equal(manifest.failureHistory.length, 1);
});

test("Phase 6.15 release readiness matrix never turns missing evidence into PASS", () => {
  const result = buildReleaseReadinessMatrix([{ category: "mathematical-correctness", status: "PASS", evidence: ["phase6.13"], limitation: null }]);
  assert.equal(result.matrix.length, RELEASE_READINESS_CATEGORIES.length);
  assert.equal(result.matrix.find((entry) => entry.category === "crash-recovery").status, "NOT TESTED");
  assert.equal(result.readyForSyntheticScope, false);
  assert.equal(result.broaderScopeCertified, false);
});
