import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("Phase 4 golden solver artifact preserves structural and convergence baselines", async () => {
  const golden = await readJson("./golden/phase4-v0.2.0.json");
  const artifact = await readJson("../solver/artifacts/phase4-validation-v0.2.0.json");
  assert.equal(artifact.leduc.tree.informationSets, golden.leduc.informationSets);
  assert.equal(artifact.leduc.tree.nodes, golden.leduc.nodes);
  assert.equal(artifact.leduc.uniformPolicyOracle.nashConv, golden.leduc.uniformNashConv);
  artifact.leduc.algorithms.forEach((entry) => {
    assert.ok(Math.abs(entry.utilities[0] - golden.leduc.expectedPlayerZeroValue) <= golden.leduc.valueTolerance);
    assert.ok(entry.metrics.exploitability <= golden.leduc.maximumExploitabilityAt2000);
  });
  assert.equal(artifact.holdemPreflopV2.estimate.nodesPerDeal, golden.holdemPreflopV2.nodesPerDeal);
  assert.equal(artifact.holdemPreflopV2.estimate.decisionNodesPerDeal, golden.holdemPreflopV2.decisionNodesPerDeal);
  assert.equal(artifact.holdemPreflopV2.estimate.terminalNodesPerDeal, golden.holdemPreflopV2.terminalNodesPerDeal);
  assert.equal(artifact.holdemPreflopV2.estimate.estimatedInfosets, golden.holdemPreflopV2.estimatedInfosets);
  assert.equal(artifact.continuation.tree.nodes, golden.postflopSubgame.nodes);
  assert.equal(artifact.continuation.tree.informationSets, golden.postflopSubgame.informationSets);
  assert.equal(artifact.continuation.tree.chanceNodes, golden.postflopSubgame.chanceNodes);
  assert.ok(artifact.continuation.convergence.exploitability <= golden.postflopSubgame.maximumExploitabilityAt200);
});
