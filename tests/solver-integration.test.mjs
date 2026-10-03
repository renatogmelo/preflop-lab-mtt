import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_DATASET_ID,
  SOLVER_EXPERIMENTAL_DATASET,
  StrategyRepository,
} from "../app/core/strategy-data.ts";

test("StrategyRepository installs but never auto-promotes the solver POC", () => {
  const repository = new StrategyRepository();
  const metadata = repository.metadata(SOLVER_EXPERIMENTAL_DATASET.metadata.id);
  assert.equal(metadata?.trustLevel, "experimental");
  const exact = repository.lookup(SOLVER_EXPERIMENTAL_DATASET.nodes[0].query);
  assert.equal(exact.status, "available");
  const autoQuery = { ...SOLVER_EXPERIMENTAL_DATASET.nodes[0].query, datasetId: AUTO_DATASET_ID };
  const excluded = repository.resolve(autoQuery);
  assert.equal(excluded.status, "unavailable");
  const explicit = repository.resolve(autoQuery, { allowModeledFallback: true, allowExperimental: true });
  assert.equal(explicit.status, "available");
  assert.equal(explicit.node.provenance.trustLevel, "experimental");
});
