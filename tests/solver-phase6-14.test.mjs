import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CompactCfrSolver } from "../solver/research/compact/compact-cfr.ts";
import { compileSyntheticGameV2 } from "../solver/research/fast-compiler/compiler-v2.ts";
import { createStructuralCacheIdentity, deserializeStructuralCache, serializeStructuralCache } from "../solver/research/fast-compiler/structural-cache-v1.ts";
import { CompiledTreeProvider } from "../solver/research/generic/compiler-v3.ts";
import { createStructuralCacheIdentityV2, deserializeStructuralCacheV2, serializeStructuralCacheV2 } from "../solver/research/generic/structural-cache-v2.ts";
import { deserializeBinaryCheckpointV5, restoreBinaryCheckpointV5, serializeBinaryCheckpointV5 } from "../solver/research/resource-safe/binary-checkpoint-v5.ts";
import { SCALE_CONFIGURATIONS } from "../solver/research/scalability/experiment-runner.ts";
import { SyntheticCompactProvider } from "../solver/research/compact/synthetic-compact-provider.ts";
import { detectPlateau, fitEmpiricalRate, numericalDiagnostics, regretStatistics } from "../solver/research/convergence/diagnostics.ts";
import { DEFAULT_EVALUATION_SCHEDULE, runConvergenceExperiment, validateExperimentConfiguration } from "../solver/research/convergence/experiment-framework.ts";
import { phase614ExperimentMatrix } from "../solver/research/convergence/phase6-14-runner.ts";
import { ConvergenceExperimentScheduler } from "../solver/research/convergence/scheduler.ts";
import { CONVERGENCE_EXPERIMENT_SCHEMA } from "../solver/research/convergence/types.ts";

const resourceBudget = { maximumNodes: 100_000, maximumRuntimeMs: 5_000, maximumRssBytes: 512 * 1024 * 1024, maximumWorkUnits: 100_000_000, maximumPurePolicies: 100_000 };
const configuration = (overrides = {}) => ({
  schema: CONVERGENCE_EXPERIMENT_SCHEMA,
  experimentId: "phase614-test",
  game: { family: "hidden-information" },
  algorithm: "dcfr",
  solverConfiguration: { algorithm: "dcfr", seed: 1, exactMetrics: true, engine: "indexed-tree" },
  seed: 61400,
  comparisonMode: "iteration-matched",
  iterationBudget: 100,
  evaluationSchedule: [1, 2, 5, 10, 20, 50, 100],
  checkpointSchedule: [],
  initialState: "zero",
  utilityScale: 1,
  resourceBudget,
  commit: "e5cc8e22126cfa2707fbdc8918582931a91f1b05",
  ...overrides,
});

test("Phase 6.14 experiment configuration is versioned, serializable and validated", () => {
  const value = configuration();
  assert.equal(validateExperimentConfiguration(JSON.parse(JSON.stringify(value))), true);
  assert.throws(() => validateExperimentConfiguration({ ...value, iterationBudget: 0 }), /Iteration budget/);
  assert.throws(() => validateExperimentConfiguration({ ...value, evaluationSchedule: [2, 1] }), /schedule/);
});

test("Phase 6.14 fixed generation seeds produce stable matrix configurations", () => {
  const left = phase614ExperimentMatrix();
  const right = phase614ExperimentMatrix();
  assert.deepEqual(left, right);
  assert.deepEqual([...new Set(left.filter((entry) => entry.game.family === "controlled-random").map((entry) => entry.seed))], [61400, 61401, 61402, 61403, 61404]);
});

test("Phase 6.14 scheduler controls concurrency and records deterministic manifest order", async () => {
  const scheduler = new ConvergenceExperimentScheduler(2);
  let active = 0;
  let maximumActive = 0;
  const configs = ["c", "a", "b"].map((id) => configuration({ experimentId: id, iterationBudget: 1, evaluationSchedule: [1] }));
  const manifest = await scheduler.run(configs, async (config) => {
    active += 1; maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return { experimentId: config.experimentId, status: "completed" };
  });
  assert.ok(maximumActive <= 2);
  assert.deepEqual(manifest.results.map((entry) => entry.experimentId), ["a", "b", "c"]);
});

test("Phase 6.14 scheduler cancellation prevents queued execution", async () => {
  const controller = new AbortController();
  controller.abort();
  const manifest = await new ConvergenceExperimentScheduler(1).run([configuration(), configuration({ experimentId: "second" })], async () => { throw new Error("must not run"); }, controller.signal);
  assert.equal(manifest.cancelled, 2);
  assert.equal(manifest.completed, 0);
});

test("Phase 6.14 convergence series follows the declared logarithmic schedule", async () => {
  const result = await runConvergenceExperiment(configuration());
  assert.deepEqual(result.series.map((point) => point.iteration), [0, 1, 2, 5, 10, 20, 50, 100]);
  assert.equal(result.stopReason, "iteration-budget");
});

test("Phase 6.14 iteration-matched comparison gives all algorithms equal budgets", async () => {
  const results = [];
  for (const algorithm of ["vanilla-cfr", "cfr-plus", "dcfr"]) results.push(await runConvergenceExperiment(configuration({
    experimentId: `iteration-${algorithm}`, algorithm, solverConfiguration: { algorithm, seed: 1, exactMetrics: true, engine: "indexed-tree" }, iterationBudget: 200, evaluationSchedule: [1, 10, 100, 200],
  })));
  assert.deepEqual(results.map((entry) => entry.iterations), [200, 200, 200]);
});

test("Phase 6.14 time-matched comparison stops by the predeclared wall-clock budget", async () => {
  const result = await runConvergenceExperiment(configuration({ comparisonMode: "time-matched", timeBudgetMs: 2, iterationBudget: 1_000_000, evaluationSchedule: [1], resourceBudget: { ...resourceBudget, maximumWorkUnits: 100_000_000_000 } }));
  assert.equal(result.stopReason, "runtime-budget");
  assert.ok(result.iterations < 1_000_000);
});

test("Phase 6.14 average and current strategies stay normalized", async () => {
  const result = await runConvergenceExperiment(configuration());
  for (const point of result.series) {
    assert.ok(point.numerical.averageNormalizationError <= 1e-12);
    assert.ok(point.numerical.currentNormalizationError <= 1e-12);
  }
});

test("Phase 6.14 regret statistics distinguish positive, negative and normalized mass", () => {
  const stats = regretStatistics(new Float64Array([2, -3, 1]), 2, 1);
  assert.equal(stats.positiveMass, 3);
  assert.equal(stats.negativeMass, 3);
  assert.equal(stats.maximumAbsolute, 3);
  assert.equal(stats.normalizedPositiveMass, 1.5);
});

test("Phase 6.14 utility scaling preserves normalized diagnostics without non-finite values", async () => {
  for (const utilityScale of [1e-6, 1, 1e6]) {
    const result = await runConvergenceExperiment(configuration({ experimentId: `scale-${utilityScale}`, utilityScale, iterationBudget: 50, evaluationSchedule: [1, 10, 50] }));
    assert.equal(result.series.every((point) => point.numerical.anomalies.length === 0), true);
    assert.equal(Number.isFinite(result.series.at(-1).regret.normalizedMaximumAbsolute), true);
  }
});

test("Phase 6.14 chance stress covers zero, near-zero, uniform and near-one probabilities", async () => {
  for (const probability of [0, 1e-12, 0.5, 1 - 1e-12, 1]) {
    const result = await runConvergenceExperiment(configuration({ experimentId: `chance-${probability}`, game: { family: "chance-stress", probability }, algorithm: "cfr-plus", solverConfiguration: { algorithm: "cfr-plus", seed: 1, exactMetrics: true, engine: "indexed-tree" }, iterationBudget: 50, evaluationSchedule: [1, 10, 50] }));
    assert.equal(result.status, "completed");
    assert.equal(result.series.every((point) => point.numerical.anomalies.length === 0), true);
  }
});

test("Phase 6.14 zero-reach chance branches remain explicit and stable", async () => {
  const result = await runConvergenceExperiment(configuration({ game: { family: "chance-stress", probability: 0 }, iterationBudget: 20, evaluationSchedule: [1, 20] }));
  assert.equal(result.series.at(-1).numerical.finiteUtilities, true);
  assert.ok(result.series.at(-1).numerical.minimumNonZeroReachProxy > 0);
});

test("Phase 6.14 multiple Checkpoint V5 resumes complete and record successive hashes", async () => {
  const result = await runConvergenceExperiment(configuration({ iterationBudget: 100, checkpointSchedule: [10, 20, 50], evaluationSchedule: [1, 10, 20, 50, 100] }));
  assert.equal(result.checkpointHashes.length, 3);
  assert.equal(new Set(result.checkpointHashes).size, 3);
  assert.equal(result.iterations, 100);
});

test("Phase 6.14 continuous and multiple-resume execution are bit exact", async () => {
  const continuous = await runConvergenceExperiment(configuration({ experimentId: "continuous", iterationBudget: 200, evaluationSchedule: [200] }));
  const resumed = await runConvergenceExperiment(configuration({ experimentId: "resumed", iterationBudget: 200, evaluationSchedule: [200], checkpointSchedule: [10, 50, 100] }));
  assert.equal(resumed.finalStateHash, continuous.finalStateHash);
});

test("Phase 6.14 Checkpoint V5 restores over Structural Cache V1 and V2 topologies", () => {
  const gameConfiguration = SCALE_CONFIGURATIONS.find((entry) => entry.level === "S0").configuration;
  const compilation = compileSyntheticGameV2(gameConfiguration);
  const provider = new SyntheticCompactProvider(gameConfiguration);
  const config = { algorithm: "dcfr", seed: 1, exactMetrics: true, engine: "indexed-tree" };
  const solver = new CompactCfrSolver(provider, compilation.tree, config);
  solver.initialize();
  for (let index = 0; index < 4; index += 1) solver.iterate();
  const checkpoint = deserializeBinaryCheckpointV5(serializeBinaryCheckpointV5(solver).buffer);
  const identityV1 = createStructuralCacheIdentity(gameConfiguration);
  const v1 = deserializeStructuralCache(serializeStructuralCache(compilation.tree, identityV1).buffer, identityV1).tree;
  const identityV2 = createStructuralCacheIdentityV2({ gameId: compilation.tree.gameId, gameHash: compilation.tree.gameHash, compilerVersion: "test", configurationHash: "phase614", actionOrdering: "stable-contiguous-numeric-v1", utilityModel: "synthetic-zero-sum-terminal-p0-v0.9.0" });
  const v2 = deserializeStructuralCacheV2(serializeStructuralCacheV2(compilation.tree, identityV2).buffer, identityV2).tree;
  for (const tree of [v1, v2]) {
    const restored = new CompactCfrSolver(new CompiledTreeProvider(tree), tree, config);
    restoreBinaryCheckpointV5(restored, checkpoint);
    assert.equal(restored.stateHash, solver.stateHash);
  }
});

test("Phase 6.14 independent EV, BR and NashConv agree at every eligible checkpoint", async () => {
  const result = await runConvergenceExperiment(configuration({ iterationBudget: 200, evaluationSchedule: [1, 10, 100, 200] }));
  assert.equal(result.series.every((point) => point.independentDelta !== null && point.independentDelta <= 1e-12), true);
  assert.equal(result.series.every((point) => point.nashConv >= -1e-12 && point.exploitability === point.nashConv / 2), true);
});

test("Phase 6.14 plateau detection separates improvement, plateau, oscillation and divergence", () => {
  assert.equal(detectPlateau([1, 0.8, 0.6, 0.4]).classification, "improving");
  assert.equal(detectPlateau([1, 1, 1, 1]).classification, "plateau");
  assert.equal(detectPlateau([1, 0.9, 1, 0.9]).classification, "oscillation");
  assert.equal(detectPlateau([1, 1.1, 1.2, 1.3]).classification, "divergence");
});

test("Phase 6.14 empirical rate fit reports method, quality and limitation", () => {
  const fit = fitEmpiricalRate([1, 10, 100, 1000].map((iteration) => ({ iteration, nashConv: 1 / Math.sqrt(iteration) })));
  assert.ok(Math.abs(fit.slope + 0.5) < 1e-12);
  assert.ok(fit.rSquared > 0.999999);
  assert.match(fit.limitation, /not a theorem/);
});

test("Phase 6.14 numerical anomaly detection fails closed", () => {
  const tree = { informationSetActionCount: new Uint16Array([2]), informationSetActionOffset: new Uint32Array([0, 2]) };
  const diagnostics = numericalDiagnostics(tree, new Float64Array([Number.NaN, 0]), new Float64Array([0, 0]), new Float64Array([0.5, 0.5]), new Float64Array([0.5, 0.5]), [0, 0]);
  assert.equal(diagnostics.finiteRegrets, false);
  assert.ok(diagnostics.anomalies.includes("non-finite-regret"));
});

test("Phase 6.14 work budget terminates before traversal", async () => {
  const result = await runConvergenceExperiment(configuration({ resourceBudget: { ...resourceBudget, maximumWorkUnits: 1 } }));
  assert.equal(result.status, "budget-limited");
  assert.equal(result.stopReason, "work-budget");
  assert.equal(result.iterations, 0);
});

test("Phase 6.14 evaluation schedule includes all mandatory checkpoints", () => {
  for (const required of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000]) assert.ok(DEFAULT_EVALUATION_SCHEDULE.includes(required));
});

test("Phase 6.14 main artifact has integrity, gates and reproduction commands", async () => {
  const artifact = JSON.parse(await readFile(new URL("../solver/artifacts/phase6-14-convergence-v0.14.0.json", import.meta.url), "utf8"));
  assert.equal(artifact.version, "0.14.0");
  assert.equal(typeof artifact.artifactHash, "string");
  assert.deepEqual(Object.keys(artifact.gates), ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"]);
  assert.ok(artifact.reproduction.some((command) => command.includes("solver:phase6-14")));
  assert.equal(artifact.gateD, "FAIL");
  assert.equal(artifact.verifiedDatasets, 0);
});
