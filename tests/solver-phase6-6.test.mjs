import assert from "node:assert/strict";
import test from "node:test";
import { createHoldemDeck } from "../solver/cards/cards.ts";
import { WeightedRange } from "../solver/cards/range.ts";
import {
  deterministicPerturbationDirections,
  localResponseRatio,
  perturbDistribution,
  residualNorms,
  SafeguardedAnderson,
  sensitivityMetrics,
  summarizeRatios,
  vectorNorms,
} from "../solver/analysis/phase6-6.ts";
import { auditRangeTransformation } from "../solver/analysis/range-pipeline.ts";
import { CoupledFixedPointSolverV2 } from "../solver/coupling/fixed-point-v2.ts";
import { StrengthProxyProvider } from "../solver/continuation/strength-proxy.ts";
import {
  phase6ReferenceActionHistory,
  phase6ReferenceFlop,
  phase6ReferencePostflopDefinition,
  phase6ReferencePreflop,
  phase6ReferenceRanges,
} from "../solver/experiments/phase6-reference.ts";
import { ExactHoldemPreflopSolver } from "../solver/game/holdem-preflop-exact.ts";
import {
  BucketedBoardProvider,
  ExactBoardEnumerationProvider,
  ExpectedBucketBoardProvider,
  RangePostflopHoldemSubgame,
  solveRangePostflopSubgame,
  solveRangePostflopToQuality,
} from "../solver/game/range-postflop-subgame.ts";
import { deriveConditionalJointDealSnapshot } from "../solver/ranges/conditional.ts";

const microRanges = phase6ReferenceRanges.map((range) => new WeightedRange(range.entries().slice(0, 2)));
const microAbstraction = {
  flopBetFractions: [],
  turnBetFractions: [],
  riverBetFractions: [1],
  raisePotFractions: [],
  maxRaisesPerStreet: 0,
  jamAllowed: false,
};
const microDefinition = (provider) => ({
  ...phase6ReferencePostflopDefinition(microRanges),
  id: "phase6-6-test:" + provider.id,
  ranges: microRanges,
  abstraction: microAbstraction,
  boardProvider: provider,
});
const tinySolve = { algorithm: "dcfr", iterations: 2, metricInterval: 2, seed: 19, exactMetrics: true, engine: "indexed-tree", dcfr: { alpha: 2, beta: 0, gamma: 3 } };

test("finite-solve sensitivity reports complete derivative metrics", () => {
  const metrics = sensitivityMetrics([1, 2], [1.02, 1.96], 0.01, [0.75, 0.25]);
  assert.ok(Math.abs(metrics.maxDerivative - 4) < 1e-12);
  assert.ok(metrics.meanDerivative > 2);
  assert.ok(metrics.weightedDerivative > 0);
  assert.ok(metrics.utilityVectorL1 > metrics.maxUtilityDelta);
});

test("fixed-quality solve stops only after exploitability and reach movement are measured", () => {
  const result = solveRangePostflopToQuality(
    microDefinition(new BucketedBoardProvider(2)),
    tinySolve,
    { exploitabilityThreshold: 100, reachWeightedMovementThreshold: 100, checkpoints: [1, 2], maximumIterations: 2 },
  );
  assert.equal(result.innerQuality.passed, true);
  assert.equal(result.innerQuality.points.length, 2);
  assert.notEqual(result.innerQuality.points.at(-1).reachWeightedMovement, null);
});

test("perturbations preserve non-negative normalized mass", () => {
  const direction = deterministicPerturbationDirections(4)[0];
  const result = perturbDistribution([0.4, 0.3, 0.2, 0.1], direction, 0.05);
  assert.ok(result.perturbed.every((value) => value >= 0));
  assert.ok(Math.abs(result.perturbed.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
});

test("reach-weighted sensitivity discounts irrelevant components", () => {
  const unweighted = vectorNorms([100, 1], [1, 1]).reachWeighted;
  const weighted = vectorNorms([100, 1], [0, 1]).reachWeighted;
  assert.ok(weighted < unweighted);
  assert.equal(weighted, 1);
});

test("deterministic perturbation directions reproduce exactly", () => {
  assert.deepEqual(deterministicPerturbationDirections(7, undefined, 19), deterministicPerturbationDirections(7, undefined, 19));
  assert.equal(deterministicPerturbationDirections(7).length, 8);
});

test("expected-bucket membership is stable under input permutation", () => {
  const provider = new ExpectedBucketBoardProvider(2);
  const cards = createHoldemDeck().slice(0, 17);
  const normal = provider.outcomes(cards, "turn").map((outcome) => [outcome.card.id, outcome.bucketId]);
  const reversed = provider.outcomes([...cards].reverse(), "turn").map((outcome) => [outcome.card.id, outcome.bucketId]);
  assert.deepEqual(normal, reversed);
});

test("expected-bucket retains exact physical-card probabilities", () => {
  const provider = new ExpectedBucketBoardProvider(2);
  const cards = createHoldemDeck().slice(0, 11);
  const outcomes = provider.outcomes(cards, "turn");
  assert.equal(outcomes.length, 11);
  assert.ok(outcomes.every((outcome) => Math.abs(outcome.probability - 1 / 11) < 1e-12));
  assert.ok(Math.abs(outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 1e-12);
});

test("expected-bucket never reintroduces blocked cards", () => {
  const blocked = new Set([0, 1, 2, 3, 4, 5, 6]);
  const available = createHoldemDeck().filter((card) => !blocked.has(card.id));
  const outcomes = new ExpectedBucketBoardProvider(2).outcomes(available, "river");
  assert.ok(outcomes.every((outcome) => !blocked.has(outcome.card.id)));
});

test("exact-future microgame stays below the declared node cap", () => {
  const game = new RangePostflopHoldemSubgame(microDefinition(new ExactBoardEnumerationProvider()));
  const tree = game.estimateTree();
  assert.ok(tree.nodes < 2_000_000);
  assert.ok(tree.chanceNodes > 1);
  assert.equal(tree.maximumDepth >= 9, true);
});

test("R E and X artifacts declare distinct board continuation models", () => {
  const providers = [new BucketedBoardProvider(2), new ExpectedBucketBoardProvider(2), new ExactBoardEnumerationProvider()];
  const models = providers.map((provider) => solveRangePostflopSubgame(microDefinition(provider), tinySolve).boardContinuationModel);
  assert.deepEqual(models, ["representative-bucket", "expected-bucket", "exact-future"]);
});

test("residual norms expose L1 L2 Linfinity and reach weighting", () => {
  const result = residualNorms([1, 2], [2, 0], [0.75, 0.25]);
  assert.deepEqual(result.residual, [1, -2]);
  assert.equal(result.l1, 3);
  assert.equal(result.lInfinity, 2);
  assert.ok(result.l2 > 2);
  assert.ok(result.reachWeighted > 0);
});

test("normalized residual does not vanish with tiny damping", () => {
  const raw = residualNorms([0, 0], [2, -2]);
  const tinyUpdate = vectorNorms(raw.residual.map((value) => value * 0.0001)).lInfinity;
  assert.ok(tinyUpdate < 0.02);
  assert.ok(raw.normalizedL2 > 0.02);
});

test("LocalResponseRatio is diagnostic and ratio summaries are deterministic", () => {
  const ratio = localResponseRatio([0, 0], [1, 0], [0, 0], [2, 0]);
  assert.equal(ratio.ratio, 2);
  assert.deepEqual(summarizeRatios([3, 1, 2, 4]), { count: 4, min: 1, median: 2, mean: 2.5, p90: 4, max: 4 });
});

test("inner quality failure is explicit at the maximum budget", () => {
  const result = solveRangePostflopToQuality(
    microDefinition(new BucketedBoardProvider(2)),
    tinySolve,
    { exploitabilityThreshold: 1e-15, reachWeightedMovementThreshold: 1e-15, checkpoints: [1, 2], maximumIterations: 2 },
  );
  assert.equal(result.innerQuality.passed, false);
  assert.equal(result.innerQuality.status, "inner-quality-failed");
});

test("posterior audit records joint deals and product-of-marginals error", () => {
  const solved = new ExactHoldemPreflopSolver(
    phase6ReferencePreflop,
    phase6ReferenceRanges,
    new StrengthProxyProvider(),
    { algorithm: "dcfr", iterations: 5, metricInterval: 5, dcfr: { alpha: 2, beta: 0, gamma: 3 } },
  ).solve();
  const perturbed = [new WeightedRange(phase6ReferenceRanges[0].entries().map((entry, index) => ({ combo: entry.combo, weight: entry.weight + (index === phase6ReferenceRanges[0].entries().length - 1 ? 0.001 : 0) }))), phase6ReferenceRanges[1]];
  const input = { configuration: phase6ReferencePreflop, ranges: phase6ReferenceRanges, strategy: solved.strategy, actionHistory: phase6ReferenceActionHistory, board: phase6ReferenceFlop, sourceSolveId: solved.id };
  const audit = auditRangeTransformation(input, perturbed, 0.001);
  assert.equal(audit.explicitJointDeals.baseline.length, 46);
  assert.ok(audit.posteriorVsProductOfMarginals.baseline.l1 >= 0);
});

test("conditional posterior remains normalized with zero-reach deals retained", () => {
  const solved = new ExactHoldemPreflopSolver(
    phase6ReferencePreflop,
    phase6ReferenceRanges,
    new StrengthProxyProvider(),
    { algorithm: "dcfr", iterations: 2, metricInterval: 2 },
  ).solve();
  const joint = deriveConditionalJointDealSnapshot({ configuration: phase6ReferencePreflop, ranges: phase6ReferenceRanges, strategy: solved.strategy, actionHistory: phase6ReferenceActionHistory, board: phase6ReferenceFlop, sourceSolveId: solved.id });
  assert.equal(joint.deals.length, 46);
  assert.ok(Math.abs(joint.deals.reduce((sum, deal) => sum + deal.probability, 0) - 1) < 1e-12);
});

test("safeguarded Anderson converges on a synthetic contraction deterministically", () => {
  const run = () => {
    const accelerator = new SafeguardedAnderson(3, 1e-8, 1.25);
    let state = [0];
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const mapped = [0.5 * state[0] + 1];
      const baseline = [state[0] + 0.5 * (mapped[0] - state[0])];
      state = accelerator.propose(state, mapped, baseline).candidate;
    }
    return { state, checkpoint: accelerator.checkpoint() };
  };
  const first = run();
  const second = run();
  assert.deepEqual(first, second);
  assert.ok(Math.abs(first.state[0] - 2) < 0.05);
});

test("Anderson safeguard rejects a materially worse residual and restarts", () => {
  const accelerator = new SafeguardedAnderson(2, 1e-8, 1.1);
  accelerator.propose([0], [1], [0.5]);
  assert.equal(accelerator.safeguard(2, 1), false);
  assert.equal(accelerator.rejectedSteps, 1);
  assert.equal(accelerator.checkpoint().records.length, 0);
});

test("Anderson checkpoint restores bounded history and counters exactly", () => {
  const first = new SafeguardedAnderson(2, 1e-8, 1.25);
  first.propose([0], [1], [0.5]);
  first.propose([0.5], [1.25], [0.875]);
  const checkpoint = first.checkpoint();
  const second = new SafeguardedAnderson(2, 1e-8, 1.25);
  second.restore(checkpoint);
  assert.deepEqual(second.checkpoint(), checkpoint);
});

test("Coupling V2 configuration identity changes across initializations", () => {
  const keys = phase6ReferenceRanges[0].entries().length;
  assert.ok(keys > 0);
  const initial = new Map();
  for (const left of microRanges[0].entries()) for (const right of microRanges[1].entries()) {
    if (new Set([left.combo.first.id, left.combo.second.id, right.combo.first.id, right.combo.second.id]).size === 4) initial.set(left.combo.id + "|" + right.combo.id, [0, 0]);
  }
  const configuration = {
    preflop: { ...phase6ReferencePreflop, iterations: 2, metricInterval: 2 },
    exactPreflop: { algorithm: "dcfr", iterations: 2, metricInterval: 2 },
    ranges: microRanges,
    actionHistory: phase6ReferenceActionHistory,
    flop: phase6ReferenceFlop,
    postflopAbstraction: microAbstraction,
    boardProvider: new BucketedBoardProvider(2),
    postflopSolve: tinySolve,
    innerQuality: { exploitabilityThreshold: 100, reachWeightedMovementThreshold: 100, checkpoints: [1, 2], maximumIterations: 2 },
    outerIterations: 2,
    dampingAlpha: 0.05,
    method: "safeguarded-anderson",
    anderson: { history: 2, regularization: 1e-8, safeguardFactor: 1.25 },
    gateD: { preflopReachWeightedDelta: 100, conditionalRangeL1: 100, normalizedRawContinuationResidual: 100, dampedContinuationDelta: 100, postflopReachWeightedDelta: 100, localResponseRatio: 100, patience: 3 },
  };
  const first = new CoupledFixedPointSolverV2(configuration, initial, "zero");
  const second = new CoupledFixedPointSolverV2(configuration, initial, "another");
  assert.notEqual(first.configurationHash, second.configurationHash);
});


