import assert from "node:assert/strict";
import test from "node:test";
import {
  HAND_CLASSES,
  cardsAreUnique,
  createDeck,
  dealTable,
  handFeatures,
  handNotation,
  normalizeHand,
} from "../app/core/hands.ts";
import {
  MODELED_DATASET_ID,
  MODELED_METADATA,
  defaultQuery,
  parseDatasetJson,
  scenarioIsCompatible,
  strategyRepository,
  validateDataset,
} from "../app/core/strategy-data.ts";

test("deck has 52 unique cards and every dealt table has no collision", () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((card) => card.rank + card.suit)).size, 52);
  for (let index = 0; index < 500; index += 1) assert.equal(cardsAreUnique(dealTable()), true);
});

test("hand normalization and the 169 matrix are complete", () => {
  assert.equal(HAND_CLASSES.length, 169);
  assert.equal(new Set(HAND_CLASSES).size, 169);
  assert.equal(HAND_CLASSES.reduce((sum, hand) => sum + handFeatures(hand).combos, 0), 1326);
  assert.equal(normalizeHand("kas"), "AKs");
  assert.equal(normalizeHand("akO"), "AKo");
  assert.equal(normalizeHand("1010"), "TT");
  assert.equal(normalizeHand("AK"), null);
  assert.equal(handNotation([{ rank: "A", suit: "♠" }, { rank: "K", suit: "♠" }]), "AKs");
  assert.equal(handNotation([{ rank: "K", suit: "♥" }, { rank: "A", suit: "♠" }]), "AKo");
});

test("modeled dataset exposes provenance and never fabricates EV", () => {
  assert.equal(MODELED_METADATA.sourceType, "modeled");
  const result = strategyRepository.lookup(defaultQuery({ stack: 40, hero: "BTN", scenario: "rfi" }));
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.node.datasetId, MODELED_DATASET_ID);
  assert.equal(Object.keys(result.node.strategyByHand).length, 169);
  assert.equal(result.node.provenance.isExact, false);
  assert.equal(result.node.provenance.evAvailable, false);
  for (const actions of Object.values(result.node.strategyByHand)) {
    assert.equal(actions.reduce((sum, item) => sum + item.frequency, 0), 100);
    assert.equal(actions.every((item) => item.ev === null), true);
  }
});

test("lookup refuses unsupported sizing instead of silently falling back", () => {
  const query = defaultQuery({ stack: 40, hero: "BTN", scenario: "rfi", openSize: 2.5 });
  const result = strategyRepository.lookup(query);
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") {
    assert.match(result.reason, /sizing/i);
    assert.ok(result.alternatives.length > 0);
  }
});

test("node construction preserves pot and action history", () => {
  const open = strategyRepository.lookup(defaultQuery({ stack: 40, hero: "BTN", villain: "CO", scenario: "vs-open", openSize: 2.1 }));
  assert.equal(open.status, "available");
  if (open.status === "available") {
    assert.equal(open.node.pot, 4.6);
    assert.match(open.node.actionHistory.at(-1)?.text ?? "", /CO raise 2.1bb/);
  }
  const threeBet = strategyRepository.lookup(defaultQuery({ stack: 40, hero: "CO", villain: "BTN", scenario: "vs-3bet", openSize: 2.1, threeBetSize: 6.8 }));
  assert.equal(threeBet.status, "available");
  if (threeBet.status === "available") {
    assert.equal(threeBet.node.pot, 11.4);
    assert.match(threeBet.node.actionHistory.at(-1)?.text ?? "", /BTN 3-bet 6.8bb/);
  }
});

test("scenario compatibility rejects impossible nodes", () => {
  assert.equal(scenarioIsCompatible("rfi", "BB", 40), false);
  assert.equal(scenarioIsCompatible("bb-defense", "BTN", 40), false);
  assert.equal(scenarioIsCompatible("vs-jam", "BB", 40), false);
  assert.equal(scenarioIsCompatible("vs-3bet", "CO", 10), false);
});

test("dataset validation rejects incomplete and invalid strategies", () => {
  const lookup = strategyRepository.lookup(defaultQuery());
  assert.equal(lookup.status, "available");
  if (lookup.status !== "available") return;
  const invalid = {
    metadata: { ...MODELED_METADATA, id: "invalid-test" },
    nodes: [{
      ...lookup.node,
      datasetId: "invalid-test",
      strategyByHand: { AA: [{ action: "raise", frequency: 80, ev: null }] },
    }],
  };
  const report = validateDataset(invalid);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === "hand_count"));
  assert.ok(report.issues.some((issue) => issue.code === "frequency_sum"));
});

test("JSON importer reports malformed input", () => {
  const result = parseDatasetJson("{bad");
  assert.equal(result.dataset, null);
  assert.equal(result.report.valid, false);
  assert.equal(result.report.issues[0].code, "json");
});
