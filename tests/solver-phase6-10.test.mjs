import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashValue } from "../solver/core/stable.ts";
import { COMPACT_CFR_VERSION, CompactCfrSolver } from "../solver/research/compact/compact-cfr.ts";
import { compileCompactGame } from "../solver/research/compact/compact-tree.ts";
import { SyntheticCompactProvider } from "../solver/research/compact/synthetic-compact-provider.ts";
import { SCALE_CONFIGURATIONS } from "../solver/research/scalability/experiment-runner.ts";
import {
  BINARY_CHECKPOINT_VERSION,
  deserializeBinaryCheckpointV5,
  recoverAtomicCheckpoint,
  restoreBinaryCheckpointV5,
  serializeBinaryCheckpointV5,
  writeBinaryCheckpointAtomic,
} from "../solver/research/resource-safe/binary-checkpoint-v5.ts";
import { runIsolatedExperiment } from "../solver/research/resource-safe/isolated-runner.ts";
import {
  calibrateResourcePolicy,
  estimateResourcesV3,
  preflightV3,
} from "../solver/research/resource-safe/resource-policy-v3.ts";
import { extractCompleteSubtree, validateExtractedSubtree } from "../solver/research/resource-safe/subtree-validation.ts";

const s0 = SCALE_CONFIGURATIONS[0].configuration;
const s5 = SCALE_CONFIGURATIONS[5].configuration;
const solverConfiguration = { algorithm: "dcfr", seed: 610, exactMetrics: false, engine: "indexed-tree", dcfr: { alpha: 2, beta: 0, gamma: 3 } };

function fixture(configuration = s0) {
  const provider = new SyntheticCompactProvider(configuration);
  const tree = compileCompactGame(provider).tree;
  return { provider, tree, solver: new CompactCfrSolver(provider, tree, solverConfiguration) };
}

function limits(overrides = {}) {
  return {
    maximumRssBytes: 256 * 1024 * 1024,
    maximumRuntimeMs: 10_000,
    maximumIdleMs: 2_000,
    maximumIterations: 20,
    sampleIntervalMs: 100,
    ...overrides,
  };
}

function profileRequest(id) {
  return {
    experimentId: id,
    kind: "profile",
    configuration: s0,
    solverConfiguration,
    iterations: 2,
    evaluate: true,
    checkpoint: true,
    tier: "tier0",
    explicitLargeScaleAuthorization: false,
    limits: limits(),
    preflight: preflightV3({ configuration: s0, tier: "tier0", iterations: 2, explicitLargeScaleAuthorization: false }),
  };
}

test("Phase 6.10 binary checkpoint V5 round-trips exact numeric state", () => {
  const { provider, tree, solver } = fixture();
  solver.solve({ maxIterations: 9, collectExactMetrics: false });
  const serialized = serializeBinaryCheckpointV5(solver);
  const decoded = deserializeBinaryCheckpointV5(serialized.buffer);
  assert.equal(decoded.version, BINARY_CHECKPOINT_VERSION);
  assert.deepEqual(Array.from(decoded.regrets), Array.from(solver.regrets));
  assert.deepEqual(Array.from(decoded.strategySums), Array.from(solver.strategySums));
  const restored = new CompactCfrSolver(provider, tree, solverConfiguration);
  restoreBinaryCheckpointV5(restored, decoded);
  assert.equal(restored.stateHash, solver.stateHash);
  assert.equal(restored.iteration, solver.iteration);
  assert.equal(restored.visitedNodes, solver.visitedNodes);
  assert.ok(serialized.bytes < Buffer.byteLength(JSON.stringify(solver.checkpoint())));
});

test("Phase 6.10 binary resume equals a continuous run", () => {
  const { provider, tree } = fixture();
  const continuous = new CompactCfrSolver(provider, tree, solverConfiguration);
  continuous.solve({ maxIterations: 20, collectExactMetrics: false });
  const interrupted = new CompactCfrSolver(provider, tree, solverConfiguration);
  interrupted.solve({ maxIterations: 7, collectExactMetrics: false });
  const decoded = deserializeBinaryCheckpointV5(serializeBinaryCheckpointV5(interrupted).buffer);
  const resumed = new CompactCfrSolver(provider, tree, solverConfiguration);
  restoreBinaryCheckpointV5(resumed, decoded);
  resumed.solve({ maxIterations: 20, collectExactMetrics: false });
  assert.equal(resumed.stateHash, continuous.stateHash);
  assert.deepEqual(Array.from(resumed.averageStrategyArray()), Array.from(continuous.averageStrategyArray()));
});

test("Phase 6.10 binary checkpoint rejects truncation, corruption, version and length mismatch", () => {
  const { solver } = fixture();
  solver.solve({ maxIterations: 2, collectExactMetrics: false });
  const serialized = serializeBinaryCheckpointV5(solver).buffer;
  assert.throws(() => deserializeBinaryCheckpointV5(serialized.subarray(0, 100)), /truncated/);
  const corrupted = Buffer.from(serialized);
  corrupted[corrupted.length - 1] ^= 0xff;
  assert.throws(() => deserializeBinaryCheckpointV5(corrupted), /checksum mismatch/);
  const version = Buffer.from(serialized);
  version.writeUInt16LE(99, 8);
  assert.throws(() => deserializeBinaryCheckpointV5(version), /Unsupported binary checkpoint version/);
  const lengths = Buffer.from(serialized);
  lengths.writeUInt32LE(lengths.readUInt32LE(32) + 1, 32);
  assert.throws(() => deserializeBinaryCheckpointV5(lengths), /array lengths/);
});

test("Phase 6.10 binary restore rejects game, algorithm and non-finite state mismatch", () => {
  const { solver } = fixture();
  solver.solve({ maxIterations: 2, collectExactMetrics: false });
  const decoded = deserializeBinaryCheckpointV5(serializeBinaryCheckpointV5(solver).buffer);
  const another = fixture({ ...s0, id: "phase610-another-game", seed: s0.seed + 1 }).solver;
  assert.throws(() => restoreBinaryCheckpointV5(another, decoded), /another game/);
  const wrongAlgorithm = fixture().solver;
  decoded.metadata.algorithm = "vanilla-cfr";
  assert.throws(() => restoreBinaryCheckpointV5(wrongAlgorithm, decoded), /algorithm mismatch/);
  decoded.metadata.algorithm = "dcfr";
  decoded.regrets[0] = Number.NaN;
  assert.throws(() => restoreBinaryCheckpointV5(fixture().solver, decoded), /NaN or Infinity/);
});

test("Phase 6.10 atomic checkpoint failure preserves the previous valid file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase610-atomic-test-"));
  const target = join(directory, "state.bin");
  try {
    const first = fixture().solver;
    first.solve({ maxIterations: 2, collectExactMetrics: false });
    const firstSerialized = serializeBinaryCheckpointV5(first);
    await writeBinaryCheckpointAtomic(target, firstSerialized);
    const second = fixture().solver;
    second.solve({ maxIterations: 3, collectExactMetrics: false });
    await assert.rejects(
      writeBinaryCheckpointAtomic(target, serializeBinaryCheckpointV5(second), { simulateFailureAt: "after-backup" }),
      /Simulated checkpoint interruption/,
    );
    const recovery = await recoverAtomicCheckpoint(target);
    assert.equal(recovery.recovered, true);
    const persisted = deserializeBinaryCheckpointV5(await readFile(target));
    assert.equal(persisted.semanticStateHash, firstSerialized.semanticStateHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Phase 6.10 Resource Policy V3 enforces tiers and explicit authorization", () => {
  assert.equal(preflightV3({ configuration: s5, tier: "tier0", iterations: 1, explicitLargeScaleAuthorization: false }).decision, "DENY");
  assert.equal(preflightV3({ configuration: s5, tier: "tier1", iterations: 1, explicitLargeScaleAuthorization: false }).decision, "REQUIRE_VALIDATION");
  assert.equal(preflightV3({ configuration: s5, tier: "tier2", iterations: 1, explicitLargeScaleAuthorization: false }).decision, "DENY");
  const estimate = estimateResourcesV3(SCALE_CONFIGURATIONS[4].configuration, 1);
  const runs = Array.from({ length: 6 }, (_, index) => ({
    scale: `cal-${index}`,
    nodes: SCALE_CONFIGURATIONS[4].configuration.stages,
    estimatedPeakBytes: estimate.estimatedPeakBytes,
    observedPeakBytes: estimate.estimatedPeakBytes * 0.9,
    baselineRssBytes: 64 * 1024 * 1024,
    runtimeMs: estimate.estimatedRuntimeMs * 0.9,
    estimatedRuntimeMs: estimate.estimatedRuntimeMs,
    completed: true,
  }));
  const calibration = calibrateResourcePolicy(runs, { isolationValidated: true, watchdogValidated: true });
  const authorized = preflightV3({ configuration: s5, tier: "tier2", iterations: 1, explicitLargeScaleAuthorization: true, calibration });
  assert.equal(authorized.decision, "ALLOW", JSON.stringify(authorized));
});

test("Phase 6.10 controlled subtree extraction matches the S5 provider oracle", () => {
  const provider = new SyntheticCompactProvider(s5);
  const root = provider.levels.find((level) => level.kind === "decision" && level.stage === s5.stages - 2).offset;
  const first = extractCompleteSubtree(provider, root, 1000);
  const second = extractCompleteSubtree(provider, root, 1000);
  const validation = validateExtractedSubtree(provider, first);
  assert.equal(validation.valid, true);
  assert.equal(validation.evError, 0);
  assert.equal(first.structuralHash, second.structuralHash);
  assert.match(validation.proofScope, /not full-game strategy equivalence/);
});

test("Phase 6.10 isolated profile completes and is reproducible", async () => {
  const first = await runIsolatedExperiment(profileRequest("phase610-profile-a"));
  const second = await runIsolatedExperiment(profileRequest("phase610-profile-b"));
  assert.equal(first.terminationReason, "completed", first.error ?? "");
  assert.equal(second.terminationReason, "completed", second.error ?? "");
  assert.notEqual(first.pid, process.pid);
  assert.equal(first.semanticResultHash, second.semanticResultHash);
  assert.ok(first.peakRssObservedBytes > 0);
  assert.ok(first.stages.some((stage) => stage.stage === "cleanup"));
});

test("Phase 6.10 watchdog terminates timeout and unresponsive children", async () => {
  const timeout = await runIsolatedExperiment({
    ...profileRequest("phase610-timeout"), kind: "timeout-fixture", configuration: undefined, solverConfiguration: undefined,
    evaluate: false, checkpoint: false, limits: limits({ maximumRuntimeMs: 500, maximumIdleMs: 2_000 }),
  });
  assert.equal(timeout.terminationReason, "timeout");
  assert.equal(timeout.watchdogTriggered, true);
  const hang = await runIsolatedExperiment({
    ...profileRequest("phase610-hang"), kind: "hang-fixture", configuration: undefined, solverConfiguration: undefined,
    evaluate: false, checkpoint: false, limits: limits({ maximumRuntimeMs: 5_000, maximumIdleMs: 400 }),
  });
  assert.equal(hang.terminationReason, "unresponsive");
});

test("Phase 6.10 runner records child crash and enforces observed RSS", async () => {
  const crash = await runIsolatedExperiment({
    ...profileRequest("phase610-crash"), kind: "crash-fixture", configuration: undefined, solverConfiguration: undefined,
    evaluate: false, checkpoint: false, limits: limits({ maximumRuntimeMs: 20_000, maximumIdleMs: 15_000 }),
  });
  assert.equal(crash.terminationReason, "child-crash");
  const memory = await runIsolatedExperiment({
    ...profileRequest("phase610-memory"), kind: "memory-fixture", configuration: undefined, solverConfiguration: undefined,
    evaluate: false, checkpoint: false, fixtureAllocationBytes: 256 * 1024 * 1024,
    limits: limits({ maximumRssBytes: 120 * 1024 * 1024, maximumRuntimeMs: 8_000 }),
  });
  assert.equal(memory.terminationReason, "memory-limit", JSON.stringify(memory));
  assert.equal(memory.watchdogTriggered, true);
});
test("Phase 6.10 preserves legacy V4 checkpoint reading across the 0.10 version bump", () => {
  const { provider, tree, solver } = fixture();
  solver.solve({ maxIterations: 4, collectExactMetrics: false });
  const legacy = solver.checkpoint();
  legacy.solverVersion = "0.9.0";
  legacy.solveId = hashValue({
    gameHash: tree.gameHash,
    configuration: solverConfiguration,
    solverVersion: legacy.solverVersion,
    compactSolverVersion: COMPACT_CFR_VERSION,
    treeVersion: tree.version,
  });
  legacy.semanticHash = hashValue({
    schemaVersion: 4,
    solveId: legacy.solveId,
    gameHash: legacy.gameHash,
    configurationHash: legacy.configurationHash,
    iteration: legacy.iteration,
    nodesVisited: legacy.nodesVisited,
    stateHash: solver.stateHash,
    convergenceHistory: legacy.convergenceHistory.map((point) => ({ ...point, elapsedMs: undefined })),
  });
  const restored = new CompactCfrSolver(provider, tree, solverConfiguration);
  restored.restore(legacy);
  assert.equal(restored.stateHash, solver.stateHash);
  assert.equal(restored.iteration, solver.iteration);
});

test("Phase 6.10 child refuses a profile without an authorized preflight", async () => {
  const request = profileRequest("phase610-structural-denial");
  delete request.preflight;
  const denied = await runIsolatedExperiment(request);
  assert.equal(denied.terminationReason, "structural-limit", denied.error ?? "");
  assert.equal(denied.result, null);
});
