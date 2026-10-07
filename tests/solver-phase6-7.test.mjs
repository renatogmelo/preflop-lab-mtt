import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NashConvEvaluator, StrategyEvaluator } from "../solver/evaluation/best-response.ts";
import { hashValue } from "../solver/core/stable.ts";
import { DecomposedSolver, decompositionInitialization } from "../solver/research/decomposition/decomposed-solver.ts";
import { ContinuationOperator, continuationStateDistribution } from "../solver/research/decomposition/continuation-operator.ts";
import { evaluateFixedPoint } from "../solver/research/decomposition/fixed-point-evaluator.ts";
import { chanceAudit } from "../solver/research/unified/chance.ts";
import { informationSetAudit } from "../solver/research/unified/information-sets.ts";
import { UnifiedResearchGame } from "../solver/research/unified/game-tree.ts";
import { solveNormalFormGroundTruth } from "../solver/research/unified/ground-truth.ts";
import { referenceGameDefinitions } from "../solver/research/unified/reference-games.ts";
import { solveUnifiedGame, verifyUnifiedCheckpointResume } from "../solver/research/unified/unified-solver.ts";
import { validateResearchGame } from "../solver/research/unified/validation.ts";
import { zeroSumAudit } from "../solver/research/unified/utilities.ts";

const definitions = referenceGameDefinitions();
const games = definitions.map((definition) => new UnifiedResearchGame(definition));

test("Phase 6.7 reference games have normalized chance distributions", () => {
  games.forEach((game) => assert.equal(chanceAudit(game.definition).valid, true));
});

test("Phase 6.7 reference games satisfy perfect recall", () => {
  games.forEach((game) => assert.deepEqual(informationSetAudit(game).issues, []));
});

test("information sets keep legal actions and actors consistent", () => {
  games.forEach((game) => assert.equal(validateResearchGame(game).informationSets.valid, true));
});

test("every synthetic terminal is exactly two-player zero-sum", () => {
  games.forEach((game) => assert.equal(zeroSumAudit(game).maximumError, 0));
});

test("private states remain indistinguishable at shared responder information sets", () => {
  const game = games[0];
  assert.equal(game.informationSet({ nodeId: "p1-high", history: [] }), game.informationSet({ nodeId: "p1-low", history: [] }));
});

test("public signals select distinct public information sets without exposing private type", () => {
  const game = games[1];
  assert.equal(game.informationSet({ nodeId: "p1-high-good", history: [] }), game.informationSet({ nodeId: "p1-low-good", history: [] }));
  assert.notEqual(game.informationSet({ nodeId: "p1-high-good", history: [] }), game.informationSet({ nodeId: "p1-high-bad", history: [] }));
});

test("independent normal-form enumeration finds negligible exploitability", () => {
  games.forEach((game) => assert.ok(solveNormalFormGroundTruth(game).evaluation.exploitability < 1e-8));
});

test("strategy evaluation is deterministic", () => {
  const game = games[0];
  const strategy = solveNormalFormGroundTruth(game).strategy;
  const evaluator = new StrategyEvaluator(game);
  assert.deepEqual(evaluator.evaluate(strategy), evaluator.evaluate(strategy));
});

test("best response and NashConv agree on exploitability definition", () => {
  const game = games[0];
  const result = new NashConvEvaluator(game).evaluate(solveNormalFormGroundTruth(game).strategy);
  assert.ok(Math.abs(result.nashConv / 2 - result.exploitability) < 1e-12);
});

test("unified full-tree solves converge toward the independent reference", () => {
  games.forEach((game) => assert.ok(solveUnifiedGame(game, { iterations: 2500, metricInterval: 2500 }).evaluation.exploitability < 0.01));
});

test("decomposition reports raw fixed-point residual separately from damped movement", () => {
  const game = games[2];
  const result = new DecomposedSolver(game, { innerIterations: 50, outerIterations: 3, damping: 0.25, method: "damped", initialization: "uniform" }).solve();
  assert.ok(result.final.residual.l2 >= result.final.updateDistance.l2);
  assert.ok(Number.isFinite(result.final.residual.normalizedL2));
});

test("multiple decomposition initializations are deterministic and explicitly distinct", () => {
  const game = games[2];
  const first = decompositionInitialization(game, "first-action");
  const second = decompositionInitialization(game, "second-action");
  assert.notEqual(hashValue(first), hashValue(second));
  assert.equal(hashValue(first), hashValue(decompositionInitialization(game, "first-action")));
});

test("conditional continuation probabilities are normalized", () => {
  const game = games[2];
  const strategy = { ...decompositionInitialization(game, "uniform"), ...new ContinuationOperator(game, 10).map(decompositionInitialization(game, "uniform")).continuationStrategy };
  const distribution = continuationStateDistribution(game, strategy);
  assert.ok(Math.abs(distribution.reduce((sum, entry) => sum + entry.conditionalProbability, 0) - 1) < 1e-12);
});

test("unified checkpoint resume reproduces the uninterrupted strategy", () => {
  games.forEach((game) => assert.equal(verifyUnifiedCheckpointResume(game, 200).identical, true));
});

test("decomposed checkpoint resume reproduces strategy and metric trajectory", () => {
  const game = games[0];
  const configuration = { innerIterations: 30, outerIterations: 6, damping: 0.5, method: "damped", initialization: "uniform" };
  const continuous = new DecomposedSolver(game, configuration).solve(6);
  const partial = new DecomposedSolver(game, configuration);
  partial.solve(3);
  const resumed = new DecomposedSolver(game, configuration);
  resumed.restore(partial.checkpoint());
  const result = resumed.solve(6);
  assert.equal(result.strategyHash, continuous.strategyHash);
  assert.deepEqual(result.metrics, continuous.metrics);
});

test("fixed-point evaluator preserves R(S) = F(S) - S", () => {
  const game = games[0];
  const initial = decompositionInitialization(game, "uniform");
  const result = evaluateFixedPoint(game, initial, 20);
  assert.equal(result.residual.residual.length, 4);
  assert.ok(result.residual.l2 > 0);
});

test("Phase 6.7 artifact preserves historical Gate D failure and Verified zero", async () => {
  const artifact = JSON.parse(await readFile(new URL("../solver/artifacts/phase6-7-unified-research-v0.7.0.json", import.meta.url), "utf8"));
  assert.deepEqual(artifact.historicalGates, { A: true, B: true, C: true, D: false });
  assert.equal(artifact.verifiedDatasets, 0);
  assert.equal(artifact.trust, "Experimental");
  assert.deepEqual(artifact.gates, { U1: true, U2: true, U3: true, U4: true, U5: true });
});
