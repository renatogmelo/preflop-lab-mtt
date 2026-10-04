import assert from "node:assert/strict";
import test from "node:test";
import { dampingStep, detectApproximateCycle, finiteDifferenceSensitivity } from "../solver/analysis/phase6-5.ts";
import { privateDealDistribution } from "../solver/cards/private-chance.ts";
import { WeightedRange } from "../solver/cards/range.ts";
import { strategyDistance } from "../solver/comparison/strategy-distance.ts";
import { StrengthProxyProvider } from "../solver/continuation/strength-proxy.ts";
import { DeterministicCoupledPreflopPostflopSolver } from "../solver/coupling/deterministic-engine.ts";
import { RandomnessLedger, deriveSubsystemSeed } from "../solver/core/randomness.ts";
import { hashValue } from "../solver/core/stable.ts";
import {
  phase6ReferenceActionHistory,
  phase6ReferenceBoardProvider,
  phase6ReferenceFlop,
  phase6ReferencePostflopAbstraction,
  phase6ReferencePreflop,
  phase6ReferenceRanges,
} from "../solver/experiments/phase6-reference.ts";
import { ExactHoldemPreflopSolver } from "../solver/game/holdem-preflop-exact.ts";
import { HoldemPreflopV2Solver } from "../solver/game/holdem-preflop-v2.ts";
import { BucketedBoardProvider } from "../solver/game/range-postflop-subgame.ts";
import { createChanceSampleSchedule, validateImportanceWeighting } from "../solver/sampling/chance-schedule.ts";

const exactConfiguration = {
  algorithm: "dcfr",
  iterations: 250,
  metricInterval: 250,
  dcfr: { alpha: 2, beta: 0, gamma: 3 },
};

test("randomness ledger derives isolated deterministic streams and accounts for every draw", () => {
  assert.equal(deriveSubsystemSeed(19, "chance"), deriveSubsystemSeed(19, "chance"));
  assert.notEqual(deriveSubsystemSeed(19, "chance"), deriveSubsystemSeed(19, "equity"));
  const first = new RandomnessLedger(19);
  const second = new RandomnessLedger(19);
  const a = first.stream("chance", "test chance");
  const b = second.stream("chance", "test chance");
  assert.deepEqual([a.next(), a.next(), a.next()], [b.next(), b.next(), b.next()]);
  assert.equal(first.entries()[0].sampleCount, 3);
  assert.equal(first.totalSamples(), 3);
});

test("fixed, stratified and quasi schedules are normalized, reproducible and coverage-audited", () => {
  const distribution = privateDealDistribution(phase6ReferenceRanges[0], phase6ReferenceRanges[1], [...phase6ReferenceFlop]);
  assert.ok(Math.abs(distribution.reduce((sum, deal) => sum + deal.probability, 0) - 1) < 1e-12);
  const fixedA = createChanceSampleSchedule(distribution, 1_000, "fixed-crn", 42);
  const fixedB = createChanceSampleSchedule(distribution, 1_000, "fixed-crn", 42);
  const stratified = createChanceSampleSchedule(distribution, 1_000, "stratified", 42);
  const quasi = createChanceSampleSchedule(distribution, 1_000, "quasi-deterministic", 42);
  assert.equal(fixedA.id, fixedB.id);
  assert.deepEqual(fixedA.samples, fixedB.samples);
  assert.equal(stratified.coverage.observedDeals, 46);
  assert.equal(quasi.coverage.observedDeals, 46);
  assert.ok(stratified.coverage.empiricalL1 < fixedA.coverage.empiricalL1);
  assert.equal(validateImportanceWeighting(stratified).valid, true);
  assert.equal(validateImportanceWeighting(quasi).valid, true);
});

test("exact private-deal traversal is deterministic and invariant to range entry order", () => {
  const provider = new StrengthProxyProvider();
  const first = new ExactHoldemPreflopSolver(
    phase6ReferencePreflop,
    phase6ReferenceRanges,
    provider,
    { ...exactConfiguration, provenanceSeed: 1 },
  ).solve();
  const repeated = new ExactHoldemPreflopSolver(
    phase6ReferencePreflop,
    phase6ReferenceRanges,
    provider,
    { ...exactConfiguration, provenanceSeed: 99 },
  ).solve();
  const reversed = phase6ReferenceRanges.map((range) => new WeightedRange([...range.entries()].reverse()));
  const reordered = new ExactHoldemPreflopSolver(
    phase6ReferencePreflop,
    reversed,
    provider,
    exactConfiguration,
  ).solve();
  assert.equal(first.chanceOutcomes, 46);
  assert.equal(first.seedRole, "provenance-only");
  assert.equal(strategyDistance(first.strategy, repeated.strategy).maxAbsoluteDelta, 0);
  assert.equal(strategyDistance(first.strategy, reordered.strategy).maxAbsoluteDelta, 0);
  assert.equal(hashValue(first.checkpoint.infosets), hashValue(repeated.checkpoint.infosets));
});

test("sampled traversal reports coverage and approaches the exact oracle measurably", () => {
  const provider = new StrengthProxyProvider();
  const exact = new ExactHoldemPreflopSolver(
    phase6ReferencePreflop,
    phase6ReferenceRanges,
    provider,
    exactConfiguration,
  ).solve();
  const sampled = new HoldemPreflopV2Solver({
    ...phase6ReferencePreflop,
    iterations: 5_000,
    metricInterval: 5_000,
    chanceSampling: { mode: "quasi-deterministic", masterSeed: 19 },
  }, provider, phase6ReferenceRanges).solve();
  const distance = strategyDistance(exact.strategy, sampled.strategy);
  assert.equal(sampled.sampling.coverage.observedDeals, 46);
  assert.ok(Number.isFinite(distance.weightedMeanAbsoluteDelta));
  assert.ok(distance.weightedMeanAbsoluteDelta < 0.5);
});

test("exact warm resume is identical to one continuous solve", () => {
  const provider = new StrengthProxyProvider();
  const first = new ExactHoldemPreflopSolver(
    phase6ReferencePreflop,
    phase6ReferenceRanges,
    provider,
    { ...exactConfiguration, iterations: 100, metricInterval: 100 },
  ).solve();
  const resumed = new ExactHoldemPreflopSolver(
    phase6ReferencePreflop,
    phase6ReferenceRanges,
    provider,
    { ...exactConfiguration, iterations: 200, metricInterval: 100 },
  ).solve(first.checkpoint);
  const continuous = new ExactHoldemPreflopSolver(
    phase6ReferencePreflop,
    phase6ReferenceRanges,
    provider,
    { ...exactConfiguration, iterations: 200, metricInterval: 100 },
  ).solve();
  assert.equal(hashValue(resumed.strategy), hashValue(continuous.strategy));
  assert.deepEqual(resumed.checkpoint.infosets, continuous.checkpoint.infosets);
});

test("bucket representatives are stable under input permutation", () => {
  const provider = new BucketedBoardProvider(2);
  const available = phase6ReferenceRanges[0].entries().flatMap(({ combo }) => [combo.first, combo.second]);
  const unique = [...new Map(available.map((card) => [card.id, card])).values()];
  const normal = provider.outcomes(unique, "turn");
  const reversed = provider.outcomes([...unique].reverse(), "turn");
  assert.deepEqual(normal, reversed);
});

test("sensitivity, damping and approximate period-two/three diagnostics are deterministic", () => {
  const sensitivity = finiteDifferenceSensitivity([0.4, 0.3], (input) => [input[0] * 2 + input[1]], 0);
  assert.ok(sensitivity.probes.every((probe) => Math.abs(probe.derivative[0] - 2) < 1e-10));
  assert.deepEqual(dampingStep([0, 2], [2, 0], 0.25), [0.5, 1.5]);
  assert.equal(detectApproximateCycle([[0], [1], [0], [1]], [2], 1e-12).period, 2);
  assert.equal(detectApproximateCycle([[0], [1], [2], [0], [1], [2]], [3], 1e-12).period, 3);
});

test("outer fixed-point checkpoint/resume matches the continuous deterministic trajectory", () => {
  const configuration = {
    preflop: { ...phase6ReferencePreflop, iterations: 20, metricInterval: 20 },
    exactPreflop: { ...exactConfiguration, iterations: 20, metricInterval: 20 },
    ranges: phase6ReferenceRanges,
    actionHistory: phase6ReferenceActionHistory,
    flop: [...phase6ReferenceFlop],
    postflopAbstraction: phase6ReferencePostflopAbstraction,
    boardProvider: phase6ReferenceBoardProvider,
    postflopSolve: { algorithm: "dcfr", iterations: 2, metricInterval: 2, seed: 19, exactMetrics: true, engine: "indexed-tree", dcfr: { alpha: 2, beta: 0, gamma: 3 } },
    outerIterations: 2,
    dampingAlpha: 0.1,
    convergence: { preflopStrategyDelta: 0.02, conditionalRangeDelta: 0.02, continuationUtilityDelta: 0.02, postflopStrategyDelta: 0.02, patience: 3 },
  };
  const continuous = new DeterministicCoupledPreflopPostflopSolver(configuration, new StrengthProxyProvider()).solve();
  const first = new DeterministicCoupledPreflopPostflopSolver(configuration, new StrengthProxyProvider()).solve(undefined, 1);
  const resumed = new DeterministicCoupledPreflopPostflopSolver(configuration, new StrengthProxyProvider()).solve(first.checkpoint);
  assert.equal(hashValue(continuous.preflop.strategy), hashValue(resumed.preflop.strategy));
  assert.deepEqual(continuous.checkpoint.previousDampedValues, resumed.checkpoint.previousDampedValues);
  const stableMetrics = (metrics) => metrics.map((metric) => {
    const stable = { ...metric };
    delete stable.runtimeMs;
    return stable;
  });
  assert.deepEqual(stableMetrics(continuous.outerMetrics), stableMetrics(resumed.outerMetrics));
});