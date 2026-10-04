import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test("Phase 6.5 golden preserves the exact 46-deal oracle and deterministic provider comparison", async () => {
  const golden = await readJson("./golden/phase6-5-v0.5.0.json");
  const artifact = await readJson("../solver/artifacts/phase6-5-deterministic-fixed-point-v0.5.0.json");
  assert.equal(artifact.trust, "Experimental");
  assert.equal(artifact.verifiedDatasets, 0);
  assert.equal(artifact.referenceGame.hash, golden.referenceGameHash);
  assert.equal(artifact.referenceGame.compatiblePrivateDeals, 46);
  assert.equal(artifact.exactPreflop.providers.solved.chanceOutcomes, 46);
  assert.equal(artifact.exactPreflop.providers.solved.strategyHash, golden.exactOracle.strategyHash);
  close(artifact.exactPreflop.reproducibility.repeatedExactDistance.maxAbsoluteDelta, 0);
  close(artifact.exactPreflop.reproducibility.orderInvariantDistance.maxAbsoluteDelta, 0);
  close(artifact.exactPreflop.officialSolvedSeedDistance, 0);
  close(artifact.providerComparison.exactDistances.equityVsSolved.weightedMeanAbsoluteDelta, golden.deterministicProviderComparison.equityVsSolved.weightedMeanAbsoluteDelta);
});

test("Phase 6.5 golden records fixed schedule, deterministic resume and failed Gate D honestly", async () => {
  const golden = await readJson("./golden/phase6-5-v0.5.0.json");
  const artifact = await readJson("../solver/artifacts/phase6-5-deterministic-fixed-point-v0.5.0.json");
  const manifest = await readJson("../solver/experiments/phase6-5-manifest.json");
  const confirm = artifact.coupling.confirmatory;
  const final = confirm.outerMetrics.at(-1);

  assert.equal(artifact.sampling.winner, "quasi-deterministic");
  assert.equal(golden.fixedSampleSchedule.coverage.observedDeals, 46);
  assert.equal(artifact.bucketAudit.stableUnderReversePermutation, true);
  assert.equal(artifact.coupling.bestAlpha, 0.05);
  assert.equal(confirm.iterations, 100);
  assert.equal(confirm.converged, false);
  assert.equal(final.cycleDetected, false);
  assert.equal(artifact.coupling.checkpointResume.preflopStrategyDistance.maxAbsoluteDelta, 0);
  assert.equal(artifact.coupling.checkpointResume.dampedValueHashEqual, true);
  assert.equal(artifact.coupling.checkpointResume.metricTrajectoryHashEqual, true);
  assert.deepEqual(artifact.gates, golden.gateMatrix);
  assert.deepEqual(artifact.gates, manifest.finalGates);
  assert.deepEqual({ A: artifact.gates.A, B: artifact.gates.B, C: artifact.gates.C, D: artifact.gates.D }, { A: true, B: true, C: true, D: false });
  assert.equal(artifact.releasePhase7, false);
  assert.equal(manifest.runs.find((run) => run.id === "coupling-confirmatory").status, "failed-gate");
});

test("Phase 6.5 keeps the Phase 6 evidence byte-identical", async () => {
  const phase6 = await readFile(new URL("../solver/artifacts/phase6-convergence-stability-v0.4.0.json", import.meta.url));
  assert.equal(createHash("sha256").update(phase6).digest("hex"), "9238badd700b68cffb55f1e85ef1f804183196cb111456f5ee2a4d44da60b0a7");
});