import assert from "node:assert/strict";
import test from "node:test";
import { CfrPlus, Dcfr, VanillaCfr } from "../solver/algorithms/cfr.ts";
import { canonicalClassCounts, combosCollide, createHoldemDeck, enumerateHoleCombos } from "../solver/cards/cards.ts";
import { WeightedRange } from "../solver/cards/range.ts";
import { EquityApproximationProvider } from "../solver/continuation/provider.ts";
import { hashValue } from "../solver/core/stable.ts";
import { applyBettingAction, assertBettingState, createPreflopBettingState, legalBettingActions } from "../solver/game/betting.ts";
import { mtt8MaxDefinition } from "../solver/game/definition.ts";
import { HoldemPreflopPocSolver } from "../solver/game/holdem-poc.ts";
import { KuhnPoker, kuhnEquilibriumChecks } from "../solver/games/kuhn.ts";
import { exportHoldemPocDataset } from "../solver/export/strategy-dataset.ts";
import { validateHoldemPoc } from "../solver/validation/report.ts";
import { validateDataset } from "../app/core/strategy-data.ts";

test("solver card engine enumerates 52 cards, 1326 combos and 169 canonical classes", () => {
  const deck = createHoldemDeck();
  const combos = enumerateHoleCombos(deck);
  const counts = canonicalClassCounts(combos);
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((card) => card.id)).size, 52);
  assert.equal(combos.length, 1326);
  assert.equal(new Set(combos.map((combo) => combo.id)).size, 1326);
  assert.equal(counts.size, 169);
  assert.equal(counts.get("AA"), 6);
  assert.equal(counts.get("AKs"), 4);
  assert.equal(counts.get("AKo"), 12);
});

test("weighted ranges preserve weights and condition on exact card removal", () => {
  const combos = enumerateHoleCombos();
  const hero = combos.find((combo) => combo.notation === "2c2d");
  assert.ok(hero);
  const range = WeightedRange.uniform(combos).compatibleWith(hero);
  assert.equal(range.entries().length, 1225);
  assert.ok(range.entries().every(({ combo }) => !combosCollide(hero, combo)));
  const probability = range.normalizedProbabilities().reduce((sum, item) => sum + item.probability, 0);
  assert.ok(Math.abs(probability - 1) < 1e-12);
});

test("8-max betting engine derives the 2.5bb unopened pot and correct first actor", () => {
  const state = createPreflopBettingState(mtt8MaxDefinition(30));
  assert.equal(state.pot, 2.5);
  assert.equal(state.actingPlayerId, "UTG");
  assert.equal(state.currentBet, 1);
  assert.equal(assertBettingState(state).valid, true);
});

test("short all-in does not reopen raising for players who already acted", () => {
  const definition = {
    id: "three-handed-reopen-test",
    game: "NLHE",
    format: "test",
    utilityModel: "chipev",
    players: [
      { id: "BTN", position: "BTN", startingStack: 20 },
      { id: "SB", position: "SB", startingStack: 20 },
      { id: "BB", position: "BB", startingStack: 7 },
    ],
    smallBlind: 0.5,
    bigBlind: 1,
    antePerPlayer: 0,
    bigBlindAnte: 0,
    abstraction: { openRaiseTo: [6], threeBetTo: [], fourBetTo: [], jamAllowed: true },
  };
  let state = createPreflopBettingState(definition);
  state = applyBettingAction(state, { type: "raise", raiseTo: 6 });
  state = applyBettingAction(state, { type: "call" });
  state = applyBettingAction(state, { type: "all-in" });
  assert.equal(state.currentBet, 7);
  assert.equal(state.history.at(-1).fullRaise, false);
  assert.equal(state.actingPlayerId, "BTN");
  const btnActions = legalBettingActions(state, [12]);
  assert.ok(btnActions.some((action) => action.type === "call"));
  assert.ok(!btnActions.some((action) => action.type === "raise" || action.type === "all-in"));
  assert.equal(assertBettingState(state).valid, true);
});

for (const [name, create] of [
  ["vanilla-cfr", (game) => new VanillaCfr(game, { seed: 11 })],
  ["cfr-plus", (game) => new CfrPlus(game, { seed: 11, cfrPlusAveragingDelay: 100 })],
  ["dcfr", (game) => new Dcfr(game, { seed: 11, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } })],
]) {
  test(`${name} converges on Kuhn with exact best-response metrics`, () => {
    const solver = create(new KuhnPoker());
    const result = solver.solve({ maxIterations: 30_000, metricInterval: 30_000 });
    const checks = kuhnEquilibriumChecks(result.strategy);
    assert.equal(result.metrics.infosets, 12);
    assert.ok(checks.valueError < 0.015, `value error ${checks.valueError}`);
    assert.ok(checks.exploitability < 0.015, `exploitability ${checks.exploitability}`);
    assert.equal(checks.probabilityIntegrity, true);
  });
}

test("CFR checkpoint resumes deterministically and rejects another configuration", () => {
  const game = new KuhnPoker();
  const partial = new Dcfr(game, { seed: 22, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } });
  partial.solve({ maxIterations: 1000, metricInterval: 1000 });
  const checkpoint = partial.checkpoint();
  const resumed = new Dcfr(game, { seed: 22, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } });
  resumed.restore(checkpoint);
  const resumedResult = resumed.solve({ maxIterations: 2000, metricInterval: 1000 });
  const uninterrupted = new Dcfr(game, { seed: 22, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } });
  const uninterruptedResult = uninterrupted.solve({ maxIterations: 2000, metricInterval: 1000 });
  assert.equal(hashValue(resumedResult.strategy), hashValue(uninterruptedResult.strategy));
  const wrong = new Dcfr(game, { seed: 23, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } });
  assert.throws(() => wrong.restore(checkpoint), /different solver configuration/);
});

test("Hold'em POC is deterministic, combo-level and exports only Experimental data", () => {
  const config = {
    id: "test-poc",
    seed: 77,
    iterations: 5000,
    metricInterval: 1000,
    stack: 10,
    smallBlind: 0.5,
    bigBlind: 1,
  };
  const first = new HoldemPreflopPocSolver(config, new EquityApproximationProvider()).solve();
  const second = new HoldemPreflopPocSolver(config, new EquityApproximationProvider()).solve();
  assert.equal(hashValue(first.rawStrategy), hashValue(second.rawStrategy));
  assert.equal(first.rawStrategy.sb.length, 1326);
  assert.equal(first.rawStrategy.bbVsJam.length, 1326);
  assert.equal(first.exploitability, null);
  const validation = validateHoldemPoc(first);
  assert.equal(validation.valid, true);
  assert.equal(validation.eligibleForVerified, false);
  const dataset = exportHoldemPocDataset(first, validation, "2026-10-03T00:00:00.000Z");
  assert.equal(dataset.metadata.trustLevel, "experimental");
  assert.equal(dataset.metadata.sourceType, "internal-solve");
  assert.equal(dataset.metadata.evAvailable, false);
  assert.equal(Object.keys(dataset.nodes[0].strategyByHand).length, 169);
  assert.equal(validateDataset(dataset).valid, true);
});
