import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const close = (actual, expected, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test("Phase 6 golden artifact preserves the frozen game and deterministic strategic result", async () => {
  const golden = await readJson("./golden/phase6-v0.4.0.json");
  const artifact = await readJson("../solver/artifacts/phase6-convergence-stability-v0.4.0.json");
  const final = artifact.innerSolver.finalConvergence.history.at(-1);

  assert.equal(artifact.trust, golden.trust);
  assert.equal(artifact.verifiedDatasets, 0);
  assert.equal(artifact.sourceCommit, golden.sourceCommit);
  assert.equal(artifact.referenceGame.id, golden.reference.id);
  assert.equal(artifact.referenceGame.hash, golden.reference.hash);
  assert.equal(artifact.referenceGame.compatiblePrivateDeals, golden.reference.compatiblePrivateDeals);
  assert.equal(artifact.innerSolver.finalConvergence.tree.nodes, golden.reference.nodes);
  assert.equal(artifact.innerSolver.finalConvergence.tree.informationSets, golden.reference.informationSets);
  assert.equal(artifact.innerSolver.selectedCandidateAt2500, golden.inner.selectedCandidate);
  assert.equal(final.iterations, golden.inner.iterations);
  close(final.exploitability, golden.inner.exploitability);
  close(final.nashConv, golden.inner.nashConv);
  close(final.strategyDelta.reachWeightedStrategyDelta, golden.inner.reachWeightedStrategyDelta);
  close(final.strategyDelta.maxStrategyDelta, golden.inner.rawMaximumStrategyDelta);
  assert.equal(final.strategyHash, golden.inner.strategyHash);
});

test("Phase 6 golden records seed instability, provider separation and failed coupling honestly", async () => {
  const golden = await readJson("./golden/phase6-v0.4.0.json");
  const artifact = await readJson("../solver/artifacts/phase6-convergence-stability-v0.4.0.json");
  const seed = artifact.seedAndProviderStudy.seedStability;
  const best = artifact.coupling.bestObserved;
  const last = best.outerMetrics.at(-1);

  close(seed.proxy.strategyDistance.statistics.mean, golden.seedStabilityMean.proxy);
  close(seed.equity.strategyDistance.statistics.mean, golden.seedStabilityMean.equity);
  close(seed.solved.strategyDistance.statistics.mean, golden.seedStabilityMean.solved);
  close(artifact.seedAndProviderStudy.providerDistances.equityVsSolved.weightedMeanAbsoluteDelta, golden.provider.equityVsSolvedDistance);
  close(artifact.seedAndProviderStudy.providerSeparationRatio.value, golden.provider.separationRatio);
  assert.equal(best.dampingAlpha, golden.coupling.bestAlpha);
  assert.equal(best.converged, golden.coupling.converged);
  assert.equal(best.outerMetrics.length, golden.coupling.outerIterations);
  close(last.preflopStrategyDelta, golden.coupling.preflopStrategyDelta);
  close(last.conditionalRangeDelta, golden.coupling.conditionalRangeDelta);
  close(last.continuationUtilityDelta, golden.coupling.continuationUtilityDelta);
  close(last.postflopStrategyDelta, golden.coupling.postflopStrategyDelta);
  assert.deepEqual(artifact.stopGatePhase7, golden.stopGatePhase7);
});

test("Phase 6 manifest includes failed attempts and the Phase 5 artifact remains byte-identical", async () => {
  const golden = await readJson("./golden/phase6-v0.4.0.json");
  const manifest = await readJson("../solver/experiments/phase6-manifest.json");
  const phase5 = await readFile(new URL("../solver/artifacts/phase5-strategic-coupling-v0.3.0.json", import.meta.url));
  const failed = manifest.experiments.filter((entry) => entry.status === "failed").map((entry) => entry.id).sort();
  const completed = new Set(manifest.experiments.filter((entry) => entry.status === "completed").map((entry) => entry.id));

  assert.deepEqual(failed, ["phase6-run-001-invalid-quantization-fixture", "phase6-run-002-global-performance-object"]);
  for (const id of ["algorithm-vanilla", "algorithm-cfrPlus", "algorithm-dcfr", "selected-5000", "provider-solved-five-seeds", "coupling-alpha-0.25", "performance-profile"]) {
    assert.ok(completed.has(id), `missing experiment ${id}`);
  }
  assert.equal(createHash("sha256").update(phase5).digest("hex"), golden.phase5Artifact.sha256);
});