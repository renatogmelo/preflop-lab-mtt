import assert from "node:assert/strict";
import test from "node:test";
import { MODELED_DATASET_ID, StrategyRepository, createCuratedDataset, defaultQuery } from "../app/core/strategy-data.ts";

test("curated publication cannot bypass review workflow", () => {
  const repository = new StrategyRepository();
  const modeled = repository.lookup(defaultQuery({ datasetId: MODELED_DATASET_ID, stack: 40, hero: "BTN", scenario: "rfi" }));
  assert.equal(modeled.status, "available");
  const published = createCuratedDataset(modeled.node.query, structuredClone(modeled.node.strategyByHand), { version: "1.0.0", notes: "Attempted bypass", status: "published" });
  const report = repository.install(published);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((item) => item.code === "workflow_bypass"));
});
