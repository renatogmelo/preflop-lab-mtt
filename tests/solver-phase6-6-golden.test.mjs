import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifact = JSON.parse(await readFile(new URL("../solver/artifacts/phase6-6-continuation-operator-v0.6.0.json", import.meta.url), "utf8"));
const golden = JSON.parse(await readFile(new URL("./golden/phase6-6-v0.6.0.json", import.meta.url), "utf8"));

test("Phase 6.6 golden sensitivity matrix preserves every predeclared budget and epsilon", () => {
  assert.equal(golden.sensitivityMatrix.length, 28);
  assert.deepEqual([...new Set(golden.sensitivityMatrix.map((entry) => entry.iterations))], [50, 100, 250, 500, 1000, 2500, 5000]);
  assert.deepEqual([...new Set(golden.sensitivityMatrix.map((entry) => entry.epsilon))], [0.0001, 0.001, 0.01, 0.05]);
  assert.ok(golden.sensitivityMatrix.every((entry) => Number.isFinite(entry.maxDerivative) && Number.isFinite(entry.weightedDerivative)));
});

test("Phase 6.6 golden exact microgame and R/E/X comparison are pinned", () => {
  assert.equal(golden.exactMicrogame.tree.nodes, 71_833);
  assert.equal(golden.exactMicrogame.tree.informationSets, 17_424);
  assert.equal(golden.exactMicrogame.strategyHash, artifact.abstractionLaboratory.models.X.solve.strategyHash);
  assert.deepEqual(golden.fixedQualityComparison, artifact.abstractionLaboratory.fixedQualityComparison.comparison);
});

test("Phase 6.6 golden trajectories retain baseline, best run and honest gate matrix", () => {
  assert.ok(golden.baselineCouplingTrajectory.length > 0);
  assert.ok(golden.bestTrajectory.length > 0);
  assert.deepEqual(golden.gateMatrix, { A: true, B: true, C: true, D: false });
  assert.equal(artifact.gates.D.rawResidualRequired, true);
});

test("Phase 6.6 integrity finalization pins resume, safeguard and tiny-alpha evidence", () => {
  assert.equal(golden.checkpointResume.identical, true);
  assert.deepEqual(golden.checkpointResume.excludedNondeterministicFields, ["metrics[].runtimeMs"]);
  assert.equal(golden.andersonSafeguard.fallbackRestoredOnRejection, true);
  assert.equal(golden.andersonSafeguard.rejectedSteps, 2);
  assert.equal(golden.tinyAlpha.prevented, true);
  assert.ok(golden.tinyAlpha.final.dampedContinuationDelta <= 0.02);
  assert.ok(golden.tinyAlpha.final.rawContinuationResidual.normalizedL2 > 0.02);
});

test("Phase 6.6 provenance and policy remain Experimental with Verified zero", () => {
  assert.equal(artifact.trust, "Experimental");
  assert.equal(artifact.verifiedDatasets, 0);
  assert.equal(artifact.release.verifiedDatasets, 0);
  assert.equal(artifact.release.phase7Recommended, false);
  assert.equal(golden.referenceGameHash, artifact.referenceGame.hash);
});
