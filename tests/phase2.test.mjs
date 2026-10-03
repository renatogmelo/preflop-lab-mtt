import assert from "node:assert/strict";
import test from "node:test";
import { HAND_CLASSES, cardsAreUnique, dealTable } from "../app/core/hands.ts";
import { compareGolden, createGoldenNode, verifiedDatasetsRequireGolden } from "../app/core/golden.ts";
import {
  AUTO_DATASET_ID,
  MODELED_DATASET_ID,
  StrategyRepository,
  createCuratedDataset,
  defaultQuery,
  strategyRepository,
  validateDataset,
} from "../app/core/strategy-data.ts";

function curatedDraft(repository = new StrategyRepository()) {
  const query = defaultQuery({ datasetId: MODELED_DATASET_ID, stack: 40, hero: "BTN", scenario: "rfi" });
  const modeled = repository.lookup(query);
  assert.equal(modeled.status, "available");
  const strategy = structuredClone(modeled.node.strategyByHand);
  return createCuratedDataset(query, strategy, { version: "1.0.0", notes: "Reviewed fixture for infrastructure tests.", status: "draft" });
}

test("trust metadata is explicit and modeled semantics cannot claim precision or EV", () => {
  const metadata = strategyRepository.metadata(MODELED_DATASET_ID);
  assert.equal(metadata.trustLevel, "modeled");
  assert.equal(metadata.frequencyPrecision, "estimated");
  assert.equal(metadata.evAvailable, false);
  assert.equal(metadata.isExact, false);
  assert.match(metadata.methodology, /heurístico/i);
  assert.ok(metadata.license.length > 10);
});

test("resolution priority ignores drafts and promotes curated only through explicit workflow", () => {
  const repository = new StrategyRepository();
  const dataset = curatedDraft(repository);
  assert.equal(repository.install(dataset).valid, true);
  let result = repository.lookup(defaultQuery({ datasetId: AUTO_DATASET_ID, stack: 40, hero: "BTN", scenario: "rfi" }));
  assert.equal(result.status, "available");
  assert.equal(result.node.provenance.trustLevel, "modeled");
  assert.equal(repository.transition(dataset.metadata.id, "review_required"), true);
  assert.equal(repository.transition(dataset.metadata.id, "reviewed"), true);
  assert.equal(repository.transition(dataset.metadata.id, "published"), true);
  result = repository.lookup(defaultQuery({ datasetId: AUTO_DATASET_ID, stack: 40, hero: "BTN", scenario: "rfi" }));
  assert.equal(result.status, "available");
  assert.equal(result.node.provenance.trustLevel, "curated");
  assert.equal(result.node.provenance.status, "published");
});

test("professional policy refuses modeled fallback instead of teaching an approximation silently", () => {
  const repository = new StrategyRepository();
  const result = repository.resolve(defaultQuery({ datasetId: AUTO_DATASET_ID }), { allowModeledFallback: false, allowExperimental: false, trustedOnly: true });
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /trusted datasets/i);
});

test("experimental datasets never enter default resolution", () => {
  const repository = new StrategyRepository();
  const dataset = curatedDraft(repository);
  dataset.metadata.id = "experimental-fixture";
  dataset.metadata.trustLevel = "experimental";
  dataset.metadata.sourceType = "imported";
  dataset.metadata.status = "published";
  dataset.nodes.forEach((node) => {
    node.id = node.id.replace("preflop-lab-reference", "experimental-fixture");
    node.datasetId = dataset.metadata.id;
    node.query.datasetId = dataset.metadata.id;
    node.provenance = { ...node.provenance, datasetId: dataset.metadata.id, trustLevel: "experimental", sourceType: "imported", status: "published" };
  });
  assert.equal(repository.install(dataset).valid, true);
  const normal = repository.resolve(defaultQuery({ datasetId: AUTO_DATASET_ID }));
  assert.equal(normal.status, "available");
  assert.equal(normal.node.provenance.trustLevel, "modeled");
});

test("coverage catalog reports auditable real counts", () => {
  const metrics = new StrategyRepository().coverageMetrics();
  assert.deepEqual(metrics, {
    totalCombinations: 252,
    supportedNodes: 217,
    verifiedNodes: 0,
    curatedNodes: 0,
    modeledNodes: 217,
    experimentalNodes: 0,
    unavailableCombinations: 35,
  });
  const trusted = new StrategyRepository().coverageMetrics({ allowModeledFallback: false, allowExperimental: false, trustedOnly: true });
  assert.equal(trusted.supportedNodes, 0);
  assert.equal(trusted.unavailableCombinations, 252);
});

test("every supported catalog node passes 169-hand and frequency invariants", () => {
  const repository = new StrategyRepository();
  for (const entry of repository.coverage()) {
    if (entry.status === "unavailable") continue;
    const inspected = repository.inspect(entry.query);
    assert.equal(inspected.lookup.status, "available");
    assert.equal(inspected.validation.valid, true, inspected.validation.issues.map((item) => item.message).join("; "));
    assert.equal(Object.keys(inspected.lookup.node.strategyByHand).length, 169);
  }
});

test("property sweep keeps cards unique and strategies normalized over thousands of cases", () => {
  const repository = new StrategyRepository();
  const available = repository.coverage().filter((entry) => entry.status === "available");
  for (let sample = 0; sample < 2500; sample += 1) {
    assert.equal(cardsAreUnique(dealTable(() => (sample * 9301 % 49297) / 49297)), true);
    const entry = available[sample % available.length];
    const result = repository.lookup(entry.query);
    assert.equal(result.status, "available");
    const hand = HAND_CLASSES[(sample * 37) % HAND_CLASSES.length];
    const actions = result.node.strategyByHand[hand];
    assert.ok(actions.every((item) => item.frequency >= 0 && item.frequency <= 100));
    assert.ok(Math.abs(actions.reduce((sum, item) => sum + item.frequency, 0) - 100) < .01);
    assert.ok(actions.every((item) => item.ev === null));
  }
});

test("dataset validation enforces semver, trust, workflow and provenance", () => {
  const dataset = curatedDraft();
  dataset.metadata.version = "one";
  dataset.nodes[0].provenance.datasetVersion = "different";
  const report = validateDataset(dataset);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((item) => item.code === "semver"));
  assert.ok(report.issues.some((item) => item.code === "provenance_mismatch"));
});

test("golden infrastructure detects unexpected strategic changes", () => {
  const dataset = curatedDraft();
  const golden = createGoldenNode(dataset, dataset.nodes[0].id, ["AA", "A5s", "72o"]);
  assert.equal(compareGolden(dataset, golden).pass, true);
  dataset.nodes[0].strategyByHand.A5s[0].frequency += 1;
  assert.equal(compareGolden(dataset, golden).pass, false);
  assert.deepEqual(verifiedDatasetsRequireGolden([dataset], new Set()), []);
  dataset.metadata.trustLevel = "verified";
  assert.deepEqual(verifiedDatasetsRequireGolden([dataset], new Set()), [dataset.metadata.id]);
});

test("lookup, coverage and matrix access stay within interactive budgets", () => {
  const repository = new StrategyRepository();
  const start = performance.now();
  for (let index = 0; index < 1000; index += 1) repository.lookup(defaultQuery({ stack: index % 2 ? 40 : 20, hero: "BTN", scenario: "rfi" }));
  const lookupMs = performance.now() - start;
  const coverageStart = performance.now();
  repository.coverage();
  const coverageMs = performance.now() - coverageStart;
  assert.ok(lookupMs < 1500, `1000 lookups took ${lookupMs.toFixed(1)}ms`);
  assert.ok(coverageMs < 1500, `coverage took ${coverageMs.toFixed(1)}ms`);
});
