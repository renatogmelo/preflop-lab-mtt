import assert from "node:assert/strict";
import test from "node:test";
import { createCombo, createHoldemDeck } from "../solver/cards/cards.ts";
import { privateDealDistribution } from "../solver/cards/private-chance.ts";
import { WeightedRange } from "../solver/cards/range.ts";
import { continuationArtifactKey, ContinuationArtifactCache } from "../solver/continuation/cache.ts";
import { EquityProvider } from "../solver/continuation/engine.ts";
import { CoupledPreflopPostflopSolver } from "../solver/coupling/engine.ts";
import { StrengthProxyProvider } from "../solver/continuation/strength-proxy.ts";
import { strategyDistance } from "../solver/comparison/strategy-distance.ts";
import { BestResponseEvaluator } from "../solver/evaluation/best-response.ts";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../solver/evaluation/holdem-preflop.ts";
import { HoldemPreflopV2Solver } from "../solver/game/holdem-preflop-v2.ts";
import { BucketedBoardProvider, ExactBoardEnumerationProvider, RangePostflopHoldemSubgame, solveRangePostflopSubgame } from "../solver/game/range-postflop-subgame.ts";
import { deriveConditionalRangeSnapshots } from "../solver/ranges/conditional.ts";

const deck = createHoldemDeck();
const card = (notation) => {
  const found = deck.find((candidate) => candidate.notation === notation);
  assert.ok(found, "Missing " + notation);
  return found;
};
const combo = (first, second) => createCombo(card(first), card(second));

const preflopConfig = {
  id: "phase5-test-preflop",
  seed: 7,
  iterations: 100,
  metricInterval: 100,
  stack: 10,
  smallBlind: 0.5,
  bigBlind: 1,
  sbOpenRaiseTo: [2],
  bbVsLimpRaiseTo: [],
  bbThreeBetTo: [],
  sbFourBetTo: [],
  maximumRaises: 1,
  limpAllowed: false,
  jamAllowed: false,
  continuationBoard: [card("8h"), card("7d"), card("2c")],
  continuationAbstractionId: "phase5-test",
};

const ranges = [
  new WeightedRange([
    { combo: combo("As", "Ah"), weight: 1 },
    { combo: combo("Qs", "Qh"), weight: 0.6 },
    { combo: combo("6s", "5s"), weight: 0.3 },
  ]),
  new WeightedRange([
    { combo: combo("Kd", "Kh"), weight: 1 },
    { combo: combo("Jc", "Tc"), weight: 0.5 },
    { combo: combo("Ac", "5c"), weight: 0.25 },
  ]),
];

test("weighted private chance uses product weights, blockers and exact normalization", () => {
  const deals = privateDealDistribution(ranges[0], ranges[1], preflopConfig.continuationBoard);
  assert.ok(deals.length > 0);
  assert.ok(Math.abs(deals.reduce((sum, deal) => sum + deal.probability, 0) - 1) < 1e-12);
  assert.ok(deals.every((deal) => new Set([
    deal.playerZero.first.id, deal.playerZero.second.id,
    deal.playerOne.first.id, deal.playerOne.second.id,
    ...preflopConfig.continuationBoard.map((item) => item.id),
  ]).size === 7));
  const aaKk = deals.find((deal) => deal.playerZero.canonical === "AA" && deal.playerOne.canonical === "KK");
  const suited = deals.find((deal) => deal.playerZero.canonical === "65s" && deal.playerOne.canonical === "JTs");
  assert.ok(aaKk && suited);
  assert.ok(Math.abs(aaKk.rawWeight / suited.rawWeight - (1 / 0.15)) < 1e-12);
});

test("conditional snapshots apply the complete joint likelihood and are reproducible", () => {
  const solved = new HoldemPreflopV2Solver(preflopConfig, new StrengthProxyProvider(), ranges).solve();
  const first = deriveConditionalRangeSnapshots({
    configuration: preflopConfig,
    ranges,
    strategy: solved.strategy,
    actionHistory: ["raise:2", "call"],
    board: preflopConfig.continuationBoard,
    sourceSolveId: solved.id,
  });
  const second = deriveConditionalRangeSnapshots({
    configuration: preflopConfig,
    ranges,
    strategy: solved.strategy,
    actionHistory: ["raise:2", "call"],
    board: preflopConfig.continuationBoard,
    sourceSolveId: solved.id,
  });
  assert.equal(first[0].id, second[0].id);
  assert.ok(Math.abs(first[0].comboWeights.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-12);
  assert.ok(Math.abs(first[1].comboWeights.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-12);
  assert.equal(Object.isFrozen(first[0]), true);
  assert.equal(first[0].actionHistory.join(","), "raise:2,call");
});

test("preflop evaluator separates sampled training from exact evaluation and BR respects infosets", () => {
  const provider = new StrengthProxyProvider();
  const trained = new HoldemPreflopV2Solver({ ...preflopConfig, iterations: 1000 }, provider, ranges).solve();
  const game = new HoldemPreflopEvaluationGame(preflopConfig, ranges, provider, preflopConfig.continuationBoard);
  const metrics = new HoldemPreflopStrategyEvaluator(game).evaluate(trained.strategy);
  assert.equal(metrics.chanceResolution, "exact-enumeration");
  assert.ok(metrics.chanceOutcomes > 1);
  assert.ok(Number.isFinite(metrics.nashConv));
  assert.ok(Number.isFinite(metrics.exploitability));
  assert.ok(Math.abs(metrics.utilities[0] + metrics.utilities[1]) < 1e-9);
  const response = new BestResponseEvaluator(game).evaluate(0, trained.strategy);
  assert.equal(Object.keys(response.policy).length, new Set(Object.keys(response.policy)).size);
  assert.ok(Object.keys(response.policy).every((key) => key.startsWith("SB|")));
});

test("range postflop game conditions turn and river cards on the actual private deal", () => {
  const game = new RangePostflopHoldemSubgame({
    id: "phase5-chance-test",
    ranges,
    flop: preflopConfig.continuationBoard,
    pot: 4,
    stacks: [2, 2],
    firstPlayer: 1,
    abstraction: {
      flopBetFractions: [],
      turnBetFractions: [],
      riverBetFractions: [],
      raisePotFractions: [],
      maxRaisesPerStreet: 0,
      jamAllowed: false,
    },
    boardProvider: new ExactBoardEnumerationProvider(),
    rangeSource: { description: "test" },
  });
  const root = game.initialState();
  const dealt = game.next(root, game.chanceOutcomes(root)[0].action);
  const firstCheck = game.next(dealt, "check");
  const chance = game.next(firstCheck, "check");
  const turnOutcomes = game.chanceOutcomes(chance);
  assert.equal(turnOutcomes.length, 45);
  const blocked = new Set([...chance.board.map((item) => item.id), chance.holeCards[0].first.id, chance.holeCards[0].second.id, chance.holeCards[1].first.id, chance.holeCards[1].second.id]);
  assert.ok(turnOutcomes.every((outcome) => !blocked.has(Number(outcome.action.slice(5)))));
  assert.ok(Math.abs(turnOutcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 1e-12);
});

test("range postflop solve exercises flop, turn, river, all-in and strategic validation", () => {
  const tiny = [new WeightedRange([{ combo: combo("As", "Ah"), weight: 1 }]), new WeightedRange([{ combo: combo("Kd", "Kh"), weight: 1 }])];
  const definition = {
    id: "phase5-range-solve-test",
    ranges: tiny,
    flop: preflopConfig.continuationBoard,
    pot: 4,
    stacks: [2, 2],
    firstPlayer: 1,
    abstraction: {
      flopBetFractions: [0.5],
      turnBetFractions: [0.5],
      riverBetFractions: [0.5],
      raisePotFractions: [1],
      maxRaisesPerStreet: 1,
      jamAllowed: true,
    },
    boardProvider: new BucketedBoardProvider(2),
    rangeSource: { description: "test singleton ranges" },
  };
  const game = new RangePostflopHoldemSubgame(definition);
  const root = game.initialState();
  let state = game.next(root, game.chanceOutcomes(root)[0].action);
  assert.ok(game.actions(state).includes("jam"));
  state = game.next(state, "jam");
  state = game.next(state, "call");
  state = game.next(state, game.chanceOutcomes(state)[0].action);
  state = game.next(state, game.chanceOutcomes(state)[0].action);
  assert.equal(game.isTerminal(state), true);
  assert.ok(state.stacks.every((stack) => stack >= 0));
  const artifact = solveRangePostflopSubgame(definition, { algorithm: "dcfr", iterations: 5, metricInterval: 5, seed: 7 });
  assert.equal(artifact.validation.valid, true);
  assert.equal(artifact.trust, "Experimental");
  assert.ok(artifact.tree.chanceNodes >= 3);
  assert.ok(Math.abs(artifact.utilities[0] + artifact.utilities[1]) < 1e-8);
});

test("continuation cache keys every strategically relevant mutation", () => {
  const base = {
    board: preflopConfig.continuationBoard,
    pot: 4,
    stacks: [8, 8],
    actingPlayer: 1,
    position: "BB",
    actionHistory: ["raise:2", "call"],
    ranges,
    bettingAbstraction: { flop: [0.33] },
    algorithmConfiguration: { algorithm: "dcfr", iterations: 10 },
  };
  const cache = new ContinuationArtifactCache();
  assert.equal(cache.getOrCreate(base, () => "a").cacheHit, false);
  assert.equal(cache.getOrCreate(base, () => "b").cacheHit, true);
  assert.notEqual(continuationArtifactKey(base), continuationArtifactKey({ ...base, pot: 5 }));
  assert.notEqual(continuationArtifactKey(base), continuationArtifactKey({ ...base, stacks: [7, 8] }));
  assert.notEqual(continuationArtifactKey(base), continuationArtifactKey({ ...base, board: [card("9h"), card("7d"), card("2c")] }));
  assert.notEqual(continuationArtifactKey(base), continuationArtifactKey({ ...base, bettingAbstraction: { flop: [0.75] } }));
  const changedRange = [new WeightedRange([{ combo: combo("As", "Ah"), weight: 0.9 }]), ranges[1]];
  assert.notEqual(continuationArtifactKey(base), continuationArtifactKey({ ...base, ranges: changedRange }));
});

test("strategy distance is zero for identity and finite with zero probabilities", () => {
  const first = { "I": { fold: 1, call: 0 } };
  const second = { "I": { fold: 0.5, call: 0.5 } };
  assert.equal(strategyDistance(first, first).maxAbsoluteDelta, 0);
  const distance = strategyDistance(first, second);
  assert.equal(distance.l1, 1);
  assert.equal(distance.maxAbsoluteDelta, 0.5);
  assert.ok(Number.isFinite(distance.jensenShannonDivergence));
});

test("continuation semantics never call finite CFR strategically exact", () => {
  const request = {
    state: {
      street: "flop",
      board: preflopConfig.continuationBoard,
      pot: 4,
      stacks: [8, 8],
      contributions: [2, 2],
      actingPlayer: 0,
      inPositionPlayer: 0,
      actionHistory: ["raise:2", "call"],
    },
    ranges: {
      playerZero: new WeightedRange([{ combo: combo("As", "Ah"), weight: 1 }]),
      playerOne: new WeightedRange([{ combo: combo("Kd", "Kh"), weight: 1 }]),
      fixedCombos: [combo("As", "Ah"), combo("Kd", "Kh")],
    },
    context: { abstractionId: "test" },
  };
  const equity = new EquityProvider().evaluate(request);
  assert.equal(equity.chanceResolution.method, "exact-enumeration");
  assert.equal(equity.strategicSolution.status, "unvalidated");
});

test("coupling executes outer iterations with explicit damping and convergence metrics", () => {
  const tinyRanges = [
    new WeightedRange([{ combo: combo("As", "Ah"), weight: 1 }]),
    new WeightedRange([{ combo: combo("Kd", "Kh"), weight: 1 }]),
  ];
  const result = new CoupledPreflopPostflopSolver({
    preflop: { ...preflopConfig, iterations: 50, metricInterval: 50 },
    ranges: tinyRanges,
    actionHistory: ["raise:2", "call"],
    flop: preflopConfig.continuationBoard,
    postflopAbstraction: {
      flopBetFractions: [0.5],
      turnBetFractions: [],
      riverBetFractions: [0.5],
      raisePotFractions: [],
      maxRaisesPerStreet: 0,
      jamAllowed: false,
    },
    boardProvider: new BucketedBoardProvider(2),
    postflopSolve: { algorithm: "dcfr", iterations: 2, metricInterval: 2, seed: 3 },
    outerIterations: 2,
    dampingAlpha: 0.5,
    convergence: { preflopStrategyDelta: 0, conditionalRangeDelta: 0, continuationUtilityDelta: 0 },
  }, new StrengthProxyProvider()).solve();
  assert.equal(result.dampingAlpha, 0.5);
  assert.equal(result.outerMetrics.length, 2);
  assert.equal(result.outerMetrics[0].conditionalRangeDelta, null);
  assert.ok(Number.isFinite(result.outerMetrics[1].continuationUtilityDelta));
  assert.equal(result.cache.misses, 1);
  assert.equal(result.cache.hits, 1);
});