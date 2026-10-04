import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("Phase 5 golden artifact detects regression without claiming poker truth", async () => {
  const golden = await readJson("./golden/phase5-v0.3.0.json");
  const artifact = await readJson("../solver/artifacts/phase5-strategic-coupling-v0.3.0.json");
  assert.equal(artifact.trust, "Experimental");
  assert.equal(artifact.gameDefinition.privateDeals, golden.privateDeals);
  assert.equal(artifact.rangePostflop.tree.nodes, golden.rangeSubgame.nodes);
  assert.equal(artifact.rangePostflop.tree.informationSets, golden.rangeSubgame.informationSets);
  assert.equal(artifact.rangePostflop.tree.chanceNodes, golden.rangeSubgame.chanceNodes);
  assert.ok(artifact.rangePostflop.convergence.exploitability <= golden.rangeSubgame.maximumExploitabilityAt20);
  const distance = artifact.continuationComparison.strategyDistances.equityVsSolved.weightedMeanAbsoluteDelta;
  assert.ok(distance >= golden.comparison.minimumEquityVsSolvedWeightedDistance);
  assert.ok(distance <= golden.comparison.maximumEquityVsSolvedWeightedDistance);
  assert.ok(artifact.continuationComparison.strategyDistances.proxyVsSolved.weightedMeanAbsoluteDelta >= golden.comparison.minimumProxyVsSolvedWeightedDistance);
  assert.ok(artifact.sampledVsEnumerated.sampledTraversal.at(-1).distanceToEnumerated.weightedMeanAbsoluteDelta <= golden.sampledVsEnumerated.maximumFinalWeightedDistanceAt4000);
  assert.equal(artifact.coupling.outerMetrics.length, golden.coupling.outerIterations);
  assert.equal(artifact.coupling.converged, golden.coupling.expectedConverged);
});