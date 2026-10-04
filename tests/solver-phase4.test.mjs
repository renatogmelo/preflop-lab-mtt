import assert from "node:assert/strict";
import test from "node:test";
import { Dcfr } from "../solver/algorithms/cfr.ts";
import { createCombo, createHoldemDeck } from "../solver/cards/cards.ts";
import { EquityEngine } from "../solver/cards/equity.ts";
import { evaluateHoldemHand } from "../solver/cards/hand-evaluator.ts";
import { StrengthProxyProvider } from "../solver/continuation/strength-proxy.ts";
import { solvePostflopSubgame } from "../solver/continuation/subgame-solver.ts";
import { NashConvEvaluator } from "../solver/evaluation/best-response.ts";
import { HoldemPreflopV2Solver } from "../solver/game/holdem-preflop-v2.ts";
import { PostflopHoldemSubgame } from "../solver/game/postflop-subgame.ts";
import { KuhnPoker } from "../solver/games/kuhn.ts";
import { inspectLeducTree, LeducPoker } from "../solver/games/leduc.ts";
import { ValidationSuite } from "../solver/validation/suite.ts";

const deck = createHoldemDeck();
const card = (notation) => {
  const result = deck.find((candidate) => candidate.notation === notation);
  assert.ok(result, `Missing test card ${notation}`);
  return result;
};

test("generic best response reproduces Kuhn and OpenSpiel Leduc uniform-policy NashConv", () => {
  const kuhn = new NashConvEvaluator(new KuhnPoker()).evaluate({});
  assert.ok(Math.abs(kuhn.nashConv - 11 / 12) < 1e-12);

  const leducGame = new LeducPoker();
  const tree = inspectLeducTree(leducGame);
  const leduc = new NashConvEvaluator(leducGame).evaluate({});
  assert.equal(tree.informationSets, 936);
  assert.equal(tree.nodes, 9457);
  assert.ok(Math.abs(leduc.utilities[0] - (-0.078125)) < 1e-12);
  assert.ok(Math.abs(leduc.nashConv - 4.747222222222222) < 1e-12);
});

test("Leduc DCFR uses the shared core and moves toward the published equilibrium value", () => {
  const solver = new Dcfr(new LeducPoker(), { seed: 7, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } });
  const result = solver.solve({ maxIterations: 100, metricInterval: 100 });
  const evaluated = new NashConvEvaluator(new LeducPoker()).evaluate(result.strategy);
  assert.equal(result.metrics.infosets, 936);
  assert.ok(Math.abs(evaluated.utilities[0] - (-0.085606)) < 0.02);
  assert.ok(evaluated.exploitability < 0.16);
});

test("Hold'em evaluator covers the ranking hierarchy, wheel and board-play tie", () => {
  const cases = [
    ["high-card", ["As", "Kd", "9c", "7h", "4s", "3d", "2c"]],
    ["pair", ["As", "Ad", "9c", "7h", "4s", "3d", "2c"]],
    ["two-pair", ["As", "Ad", "9c", "9h", "4s", "3d", "2c"]],
    ["three-of-a-kind", ["As", "Ad", "Ac", "9h", "4s", "3d", "2c"]],
    ["straight", ["As", "2d", "3c", "4h", "5s", "9d", "Tc"]],
    ["flush", ["As", "Js", "9s", "5s", "2s", "Kd", "Qc"]],
    ["full-house", ["As", "Ad", "Ac", "9h", "9s", "3d", "2c"]],
    ["four-of-a-kind", ["As", "Ad", "Ac", "Ah", "9s", "3d", "2c"]],
    ["straight-flush", ["As", "Ks", "Qs", "Js", "Ts", "3d", "2c"]],
  ];
  cases.forEach(([expected, notations]) => assert.equal(evaluateHoldemHand(notations.map(card)).category, expected));
  assert.equal(evaluateHoldemHand(["As", "2d", "3c", "4h", "5s"].map(card)).kickers[0], 5);
});

test("equity engine enumerates exact rivers, respects card removal and handles ties", () => {
  const engine = new EquityEngine();
  const hero = createCombo(card("As"), card("Ah"));
  const villain = createCombo(card("Kd"), card("Kc"));
  const win = engine.comboEquity(hero, villain, ["2s", "3d", "4c", "5h", "9s"].map(card));
  assert.equal(win.method, "exact-enumeration");
  assert.equal(win.equity, 1);
  const tie = engine.comboEquity(
    createCombo(card("2c"), card("3c")),
    createCombo(card("4d"), card("5d")),
    ["As", "Ks", "Qs", "Js", "Ts"].map(card),
  );
  assert.equal(tie.equity, 0.5);
  assert.throws(() => engine.comboEquity(hero, villain, [card("As")]), /Duplicate card/);
});

function postflopDefinition() {
  return {
    id: "fixed-flop-proof-test",
    hero: createCombo(card("As"), card("Ah")),
    villain: createCombo(card("Kd"), card("Kc")),
    flop: [card("2s"), card("3d"), card("4c")],
    pot: 4,
    stacks: [8, 8],
    firstPlayer: 0,
    abstraction: { flopBetFractions: [], turnBetFractions: [], riverBetFractions: [0.5], maxRaisesPerStreet: 0 },
  };
}

test("fixed-flop subgame enumerates turn and river, solves future betting and reports exploitability", () => {
  const game = new PostflopHoldemSubgame(postflopDefinition());
  const tree = game.estimateTree();
  assert.equal(tree.nodes, 17958);
  assert.equal(tree.chanceNodes, 46);
  const artifact = solvePostflopSubgame(postflopDefinition(), { algorithm: "dcfr", iterations: 20, metricInterval: 20, seed: 9 });
  assert.ok(Math.abs(artifact.utilities[0] + artifact.utilities[1]) < 1e-9);
  assert.ok(artifact.convergence.exploitability < 0.01);
  assert.equal(artifact.validation.valid, true);
});

test("Hold'em Preflop V2 exposes limp, raises, jam, card-removal and conditional range weights", () => {
  const configuration = {
    id: "hu-v2-test",
    seed: 42,
    iterations: 5,
    metricInterval: 5,
    stack: 10,
    smallBlind: 0.5,
    bigBlind: 1,
    sbOpenRaiseTo: [2, 2.5],
    bbVsLimpRaiseTo: [3],
    bbThreeBetTo: [7.5],
    sbFourBetTo: [9],
    maximumRaises: 3,
    continuationBoard: [],
    continuationAbstractionId: "strength-proxy-v1",
  };
  const solver = new HoldemPreflopV2Solver(configuration, new StrengthProxyProvider());
  const tree = solver.estimateTree();
  assert.equal(tree.nodesPerDeal, 51);
  assert.equal(tree.estimatedInfosets, 21216);
  solver.solve();
  const range = solver.inspectRange(0, ["raise:2"], [card("As"), card("Ks")]);
  assert.equal(range.length, 1225);
  assert.ok(range.every((row) => !row.combo.includes("As") && !row.combo.includes("Ks")));
  assert.ok(Math.abs(range.reduce((sum, row) => sum + row.normalizedWeight, 0) - 1) < 1e-9);
});

test("validation suite classifies five validation levels and applies thresholds", () => {
  const report = new ValidationSuite("phase4")
    .add({ id: "structure", level: "STRUCTURAL", description: "ok", metric: { name: "value", value: 1 }, threshold: { kind: "minimum", value: 1 } })
    .add({ id: "repro", level: "REPRODUCIBILITY", description: "same hash", metric: { name: "same", value: true }, threshold: { kind: "equal", value: true } })
    .report("2026-10-03T00:00:00.000Z");
  assert.equal(report.valid, true);
  assert.equal(report.summary.STRUCTURAL.pass, 1);
  assert.equal(report.summary.REPRODUCIBILITY.pass, 1);
});
