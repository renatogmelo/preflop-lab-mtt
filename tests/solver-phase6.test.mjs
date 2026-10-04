import assert from "node:assert/strict";
import test from "node:test";
import { CfrPlus, Dcfr, cfrPlusAveragingWeight, dcfrDiscountScales } from "../solver/algorithms/cfr.ts";
import { IndexedCfrSolver } from "../solver/algorithms/indexed-cfr.ts";
import { createCombo, createHoldemDeck } from "../solver/cards/cards.ts";
import { EquityEngine } from "../solver/cards/equity.ts";
import { evaluateHoldemHand, evaluateHoldemHandReference } from "../solver/cards/hand-evaluator.ts";
import { WeightedRange } from "../solver/cards/range.ts";
import { continuationArtifactKey, ContinuationArtifactCache } from "../solver/continuation/cache.ts";
import { StrengthProxyProvider } from "../solver/continuation/strength-proxy.ts";
import { detectDivergence, detectPeriodTwoOscillation, satisfiesConvergencePatience } from "../solver/coupling/engine.ts";
import { hashValue } from "../solver/core/stable.ts";
import { BestResponseEvaluator, StrategyEvaluator } from "../solver/evaluation/best-response.ts";
import {
  CompiledBestResponseEvaluator,
  compiledInformationSetReach,
  counterfactualActionDiagnostics,
  evaluateCompiledNode,
  strategyStability,
} from "../solver/evaluation/compiled-analysis.ts";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../solver/evaluation/holdem-preflop.ts";
import { ConvergenceExperimentRunner } from "../solver/experiments/convergence.ts";
import {
  assertPhase6ReferenceGame,
  phase6ReferenceFlop,
  phase6ReferencePreflop,
  phase6ReferenceRanges,
} from "../solver/experiments/phase6-reference.ts";
import { BucketedBoardProvider, RangePostflopHoldemSubgame, solveRangePostflopSubgame } from "../solver/game/range-postflop-subgame.ts";
import { HoldemPreflopV2Solver } from "../solver/game/holdem-preflop-v2.ts";
import { KuhnPoker } from "../solver/games/kuhn.ts";
import { compileGameTree } from "../solver/tree/compiled.ts";

const deck = createHoldemDeck();
const card = (notation) => {
  const found = deck.find((candidate) => candidate.notation === notation);
  assert.ok(found, `Missing card ${notation}`);
  return found;
};
const combo = (first, second) => createCombo(card(first), card(second));

test("Phase 6 reference game is frozen at the Phase 5 46-deal laboratory", () => {
  const reference = assertPhase6ReferenceGame();
  assert.equal(reference.id, "phase6-reference-game-v1");
  assert.equal(reference.compatiblePrivateDeals, 46);
  assert.equal(typeof reference.hash, "string");
});

test("compiled strategy and best-response evaluation match the state implementation", () => {
  const game = new KuhnPoker();
  const compiled = compileGameTree(game);
  const strategy = new Dcfr(game, { seed: 3 }).solve({ maxIterations: 100, metricInterval: 100 }).strategy;
  const dynamicUtilities = new StrategyEvaluator(game).evaluate(strategy);
  const compiledUtilities = evaluateCompiledNode(compiled.root, strategy);
  assert.deepEqual(compiledUtilities, dynamicUtilities);
  for (const player of [0, 1]) {
    const dynamic = new BestResponseEvaluator(game).evaluate(player, strategy);
    const optimized = new CompiledBestResponseEvaluator(compiled.root).evaluate(player, strategy);
    assert.ok(Math.abs(dynamic.value - optimized.value) < 1e-12);
    assert.deepEqual(optimized.policy, dynamic.policy);
  }
});

test("indexed CFR is strategy- and regret-equivalent to the object-tree oracle", () => {
  const game = new KuhnPoker();
  const compiled = compileGameTree(game);
  const configuration = { algorithm: "dcfr", seed: 5, exactMetrics: false, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } };
  const oracle = new Dcfr(game, { seed: 5, exactMetrics: false, dcfr: configuration.dcfr }, compiled);
  const indexed = new IndexedCfrSolver(game, configuration, compiled);
  oracle.solve({ maxIterations: 500, metricInterval: 500 });
  indexed.solve({ maxIterations: 500, metricInterval: 500 });
  assert.deepEqual(indexed.averageStrategy(), oracle.averageStrategy());
  assert.deepEqual(indexed.checkpoint().infosets, oracle.checkpoint().infosets);
});

test("DCFR discounts and CFR+ delayed linear averaging match their declared formulas", () => {
  assert.deepEqual(dcfrDiscountScales(1, { alpha: 1.5, beta: 0, gamma: 2 }), {
    positive: 0.5,
    negative: 0.5,
    strategy: 0,
  });
  const second = dcfrDiscountScales(2, { alpha: 1.5, beta: 0, gamma: 2 });
  assert.ok(Math.abs(second.positive - (2 ** 1.5) / (2 ** 1.5 + 1)) < 1e-15);
  assert.equal(second.negative, 0.5);
  assert.equal(second.strategy, 0.25);
  assert.deepEqual([1, 2, 3, 4].map((iteration) => cfrPlusAveragingWeight(iteration, 2)), [0, 0, 1, 2]);
});

test("reach-weighted strategy delta separates trunk movement from unreachable corners", () => {
  const previous = {
    trunk: { fold: 0.5, call: 0.5 },
    corner: { fold: 1, call: 0 },
  };
  const current = {
    trunk: { fold: 0.49, call: 0.51 },
    corner: { fold: 0, call: 1 },
  };
  const metrics = strategyStability(previous, current, { trunk: 1, corner: 1e-12 }, 1e-9);
  assert.equal(metrics.maxStrategyDelta, 1);
  assert.ok(metrics.activeInfosetDelta < 0.011);
  assert.ok(metrics.reachWeightedStrategyDelta < 0.011);
  assert.equal(metrics.activeInformationSets, 1);
});

test("counterfactual action EV is tree-derived, finite and paired with reach and regret", () => {
  const game = new KuhnPoker();
  const compiled = compileGameTree(game);
  const strategy = new CfrPlus(game, { seed: 1, cfrPlusAveragingDelay: 10 })
    .solve({ maxIterations: 1_000, metricInterval: 1_000 }).strategy;
  const reaches = compiledInformationSetReach(compiled.root, strategy);
  const diagnostics = counterfactualActionDiagnostics(compiled.root, strategy, 0);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((entry) => entry.reach >= 0 && entry.counterfactualReach > 0));
  assert.ok(diagnostics.every((entry) => Object.values(entry.actionEvs).every(Number.isFinite)));
  assert.ok(diagnostics.every((entry) => Math.abs(entry.reach - reaches[entry.informationSet]) < 1e-12));
});

test("convergence harness records checkpoints and deterministic resume preserves the solve", () => {
  const configuration = { algorithm: "dcfr", seed: 11, exactMetrics: false, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } };
  const first = new ConvergenceExperimentRunner(new KuhnPoker(), {
    referenceGameId: "phase6-resume-test",
    configuration,
    budgets: [250],
  }).run();
  const resumed = new ConvergenceExperimentRunner(new KuhnPoker(), {
    referenceGameId: "phase6-resume-test",
    configuration,
    budgets: [500],
    resume: first.checkpoint,
  }).run();
  const continuous = new ConvergenceExperimentRunner(new KuhnPoker(), {
    referenceGameId: "phase6-resume-test",
    configuration,
    budgets: [250, 500],
  }).run();
  assert.equal(resumed.history.length, 2);
  assert.equal(hashValue(resumed.finalStrategy), hashValue(continuous.finalStrategy));
  assert.deepEqual(resumed.checkpoint.solver.infosets, continuous.checkpoint.solver.infosets);
  assert.ok(Math.abs(resumed.history.at(-1).exploitability - continuous.history.at(-1).exploitability) < 1e-15);
});

test("optimized Hold'em evaluator is differential-equivalent to the reference implementation", () => {
  let state = 0x12345678;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  for (let sample = 0; sample < 1_000; sample += 1) {
    const available = [...deck];
    const hand = [];
    for (let index = 0; index < 7; index += 1) hand.push(available.splice(random() % available.length, 1)[0]);
    assert.deepEqual(evaluateHoldemHand(hand), evaluateHoldemHandReference(hand));
  }
});

test("equity cache reuses identical matchup work without changing the result", () => {
  const engine = new EquityEngine();
  const hero = combo("As", "Ah");
  const villain = combo("Kd", "Kc");
  const board = ["8h", "7d", "2c"].map(card);
  const first = engine.comboEquity(hero, villain, board, { exactThreshold: 2_000, seed: 17 });
  const second = engine.comboEquity(hero, villain, board, { exactThreshold: 2_000, seed: 17 });
  assert.deepEqual(second, first);
  assert.deepEqual(engine.cacheMetrics(), { entries: 1, hits: 1, misses: 1, hitRate: 0.5 });
});

test("coupling diagnostics detect patience, divergence and period-two oscillation", () => {
  assert.equal(satisfiesConvergencePatience([false, true, true, true], 3), true);
  assert.equal(satisfiesConvergencePatience([true, false, true], 2), false);
  assert.equal(detectDivergence([0.1, 0.2, 0.3], 3), true);
  assert.equal(detectDivergence([0.3, 0.2, 0.1], 3), false);
  const oscillation = detectPeriodTwoOscillation([0.1, 0.9, 0.1, 0.9], 1e-9);
  assert.equal(oscillation.detected, true);
  assert.equal(oscillation.period, 2);
});

test("cache quantization is explicit and coarser reuse never happens silently", () => {
  const base = {
    board: [...phase6ReferenceFlop],
    pot: 4,
    stacks: [8, 8],
    actingPlayer: 1,
    position: "BB",
    actionHistory: ["raise:2", "call"],
    ranges: phase6ReferenceRanges,
    bettingAbstraction: { flop: [0.33] },
    algorithmConfiguration: { algorithm: "dcfr", iterations: 20 },
  };
  const fine = continuationArtifactKey(base, 1e-10);
  const normal = continuationArtifactKey(base, 1e-9);
  assert.equal(typeof fine, "string");
  assert.equal(typeof normal, "string");
  const cache = new ContinuationArtifactCache(1e-8);
  cache.getOrCreate(base, () => 1);
  cache.getOrCreate(base, () => 2);
  assert.equal(cache.metrics().rangeWeightQuantization, 1e-8);
  assert.equal(cache.metrics().hits, 1);
});

test("range solve exports per-pair utilities that aggregate to the strategy EV", () => {
  const ranges = [
    new WeightedRange([
      { combo: combo("As", "Ah"), weight: 1 },
      { combo: combo("Qs", "Qh"), weight: 0.5 },
    ]),
    new WeightedRange([
      { combo: combo("Kd", "Kc"), weight: 1 },
      { combo: combo("Jh", "Jd"), weight: 0.5 },
    ]),
  ];
  const definition = {
    id: "phase6-pair-utility-test",
    ranges,
    flop: [...phase6ReferenceFlop],
    pot: 4,
    stacks: [2, 2],
    firstPlayer: 1,
    abstraction: {
      flopBetFractions: [],
      turnBetFractions: [],
      riverBetFractions: [0.5],
      raisePotFractions: [],
      maxRaisesPerStreet: 0,
      jamAllowed: false,
    },
    boardProvider: new BucketedBoardProvider(2),
    rangeSource: { description: "phase6 test" },
  };
  const game = new RangePostflopHoldemSubgame(definition);
  const artifact = solveRangePostflopSubgame(definition, {
    algorithm: "dcfr",
    iterations: 5,
    metricInterval: 5,
    seed: 1,
  });
  assert.equal(artifact.pairUtilities.length, game.privateDeals.length);
  const weighted = game.privateDeals.reduce((sum, deal, index) => (
    sum + deal.probability * artifact.pairUtilities[index].utilities[0]
  ), 0);
  assert.ok(Math.abs(weighted - artifact.utilities[0]) < 1e-9);
});

test("preflop per-action EV diagnostics use the exact reduced evaluation tree", () => {
  const tiny = [
    new WeightedRange([
      { combo: combo("As", "Ah"), weight: 1 },
      { combo: combo("Qs", "Qh"), weight: 0.7 },
    ]),
    new WeightedRange([
      { combo: combo("Kd", "Kc"), weight: 1 },
      { combo: combo("Jh", "Jd"), weight: 0.7 },
    ]),
  ];
  const config = { ...phase6ReferencePreflop, iterations: 500, metricInterval: 500 };
  const provider = new StrengthProxyProvider();
  const solve = new HoldemPreflopV2Solver(config, provider, tiny).solve();
  const evaluator = new HoldemPreflopStrategyEvaluator(
    new HoldemPreflopEvaluationGame(config, tiny, provider, [...phase6ReferenceFlop]),
  );
  const diagnostics = evaluator.counterfactualActionEvs(solve.strategy);
  const root = diagnostics.find((entry) => entry.informationSet.startsWith("SB|") && entry.informationSet.endsWith("|root"));
  assert.ok(root);
  assert.ok(Object.values(root.actionEvs).every(Number.isFinite));
  assert.ok(root.strategyEv !== null);
});
