import assert from "node:assert/strict";
import test from "node:test";
import { grade } from "../app/engine.ts";
import { buildTodayTraining, createSessionReport, updateLearningState } from "../app/core/learning.ts";
import { defaultQuery, dominantAction, strategyRepository } from "../app/core/strategy-data.ts";
import { makeSpot, resolveRound } from "../app/simulation.ts";

test("E2E decision → confidence → feedback → history → analyze", () => {
  const spot = makeSpot(40, "rfi", "BTN");
  const action = dominantAction(spot.strategy).action;
  const graded = grade(spot.strategy, action, 4);
  const resolution = resolveRound(spot, action);
  const record = { ...spot, selected: action, ...graded, confidence: 4, resolution, marked: false, timestamp: 1_790_000_000_000 };
  const state = updateLearningState(undefined, { nodeId: record.nodeId, hand: record.notation, correct: record.correct, confidence: 4, frequencyError: record.frequencyError, evLoss: record.loss, difficulty: "advanced", timestamp: record.timestamp });
  const report = createSessionReport([record]);
  assert.equal(record.provenance.datasetVersion.length > 0, true);
  assert.equal(record.loss, null);
  assert.equal(state.attempts, 1);
  assert.equal(report.decisions, 1);
});

test("E2E Explore → select BTN RFI A5s → compare stacks", () => {
  const nodes = [20, 40, 100].map((stack) => strategyRepository.lookup(defaultQuery({ stack, hero: "BTN", scenario: "rfi" })));
  assert.ok(nodes.every((item) => item.status === "available"));
  const strategies = nodes.map((item) => item.node.strategyByHand.A5s);
  assert.ok(strategies.every((items) => Math.round(items.reduce((sum, item) => sum + item.frequency, 0)) === 100));
});

test("E2E adaptive queue avoids immediate triple repetition where alternatives exist", () => {
  const base = makeSpot(40, "rfi", "BTN");
  const records = Array.from({ length: 12 }, (_, index) => ({ ...base, id: String(index), notation: ["A5s", "KQo", "76s", "22"][index % 4], hero: ["BTN", "CO", "HJ"][index % 3], nodeId: base.nodeId + index % 3, selected: "fold", correct: false, score: 0, frequencyError: 30, loss: null, marked: index % 2 === 0, confidence: 4, knowledgeState: "misconception", timestamp: 1_790_000_000_000 - index }));
  const queue = buildTodayTraining(records, 10, 1_790_000_000_000);
  assert.ok(queue.length >= 4);
  for (let index = 2; index < queue.length; index += 1) {
    assert.equal(queue[index].record.notation === queue[index - 1].record.notation && queue[index].record.notation === queue[index - 2].record.notation, false);
  }
});
