import test from "node:test";
import assert from "node:assert/strict";
import {
  boundaryCandidates,
  buildMasteryTree,
  buildReviewQueue,
  classifyKnowledge,
  computeMastery,
  detectLeaks,
  updateLearningState,
} from "../app/core/learning.ts";
import { defaultQuery, strategyRepository } from "../app/core/strategy-data.ts";

const now = Date.UTC(2026, 9, 3, 12);

test("high-confidence errors become misconceptions", () => {
  assert.equal(classifyKnowledge(false, 5, 2), "misconception");
  assert.equal(classifyKnowledge(false, 1, 2), "knowledge-gap");
  assert.equal(classifyKnowledge(true, 5, 3), "mastered");
});

test("spaced repetition scheduling is deterministic and errors return sooner", () => {
  const base = { nodeId: "node", hand: "A5s", frequencyError: 0, evLoss: null, difficulty: "advanced", timestamp: now };
  const correct = updateLearningState(undefined, { ...base, correct: true, confidence: 5 });
  const wrong = updateLearningState(undefined, { ...base, correct: false, confidence: 5 });
  assert.ok(correct.nextReview > wrong.nextReview);
  assert.equal(wrong.knowledgeState, "misconception");
  assert.deepEqual(updateLearningState(undefined, { ...base, correct: true, confidence: 5 }), correct);
});

test("mastery cannot become high from one correct attempt", () => {
  const mastery = computeMastery({ attempts: 1, correct: 1, averageFrequencyError: 0, confidenceCalibration: 1, streak: 1, lastSeen: now }, now);
  assert.ok(mastery < 25, `one sample returned ${mastery}% mastery`);
});

test("review queue prioritizes misconceptions and overdue items", () => {
  const base = {
    nodeId: "node", attempts: 3, correct: 1, incorrect: 2, streak: 0, lastSeen: now - 5_000,
    mastery: 20, confidenceCalibration: .3, averageEvLoss: null, averageFrequencyError: 20,
  };
  const queue = buildReviewQueue([
    { ...base, key: "a", hand: "A5s", nextReview: now + 100_000, knowledgeState: "misconception" },
    { ...base, key: "b", hand: "KTo", nextReview: now - 86_400_000, knowledgeState: "knowledge-gap" },
  ], now);
  assert.equal(queue[0].key, "a");
  assert.equal(queue.length, 2);
});

test("boundary algorithm returns mixed or action-switching hands first", () => {
  const lookup = strategyRepository.lookup(defaultQuery({ stack: 40, hero: "BTN", scenario: "rfi" }));
  assert.equal(lookup.status, "available");
  const candidates = boundaryCandidates(lookup.node, 20);
  assert.equal(candidates.length, 20);
  assert.ok(candidates[0].score >= candidates.at(-1).score);
  assert.ok(candidates.some((item) => item.strategy.some((action) => action.frequency > 0 && action.frequency < 100)));
});

function record(overrides = {}) {
  return {
    id: Math.random().toString(), cards: [], notation: "A5s", hero: "BTN", villain: "CO", scenario: "vs-open",
    stack: 40, history: [], pot: 5, strategy: [{ action: "fold", frequency: 20, ev: null }, { action: "threebet", frequency: 80, ev: null }],
    nodeId: "n", datasetId: "d", provenance: { datasetId: "d", datasetVersion: "1", sourceType: "modeled", sourceLabel: "test", isExact: false, frequencyPrecision: "estimated", evAvailable: false },
    selected: "fold", correct: false, score: 0, frequencyError: 80, loss: null, marked: false, confidence: 5,
    knowledgeState: "misconception", timestamp: now, ...overrides,
  };
}

test("synthetic repeated mistakes produce a targeted leak", () => {
  const leaks = detectLeaks([record(), record(), record(), record()], 3);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].severity, "major");
  assert.match(leaks[0].description, /range/i);
});

test("mastery tree is hierarchical and evidence-capped", () => {
  const tree = buildMasteryTree([record({ correct: true, confidence: 3, knowledgeState: "uncertain", frequencyError: 0 })], now);
  assert.equal(tree.children.length, 1);
  assert.ok(tree.mastery < 25);
  assert.equal(tree.children[0].children[0].children[0].label, "30–50bb");
});
