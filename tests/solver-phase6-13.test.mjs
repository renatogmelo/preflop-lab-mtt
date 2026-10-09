import test from "node:test";
import assert from "node:assert/strict";
import { CompactCfrSolver } from "../solver/research/compact/compact-cfr.ts";
import { strategyArrayProbability } from "../solver/research/compact/compact-tree.ts";
import { compileGenericGame } from "../solver/research/generic/compiler-v3.ts";
import { evaluateGenericCompactGame } from "../solver/research/generic/generic-evaluation.ts";
import { scaleProviderUtilities, reverseProviderActions } from "../solver/research/generic/metamorphic-v2.ts";
import { deserializeBinaryCheckpointV5, restoreBinaryCheckpointV5, serializeBinaryCheckpointV5 } from "../solver/research/resource-safe/binary-checkpoint-v5.ts";
import {
  TableGameProvider,
  analyticalFixtures,
  controlledRandomGame,
  hiddenInformationProvider,
  matchingPenniesProvider,
  nonuniformChanceProvider,
  rockPaperScissorsProvider,
} from "../solver/research/mathematical/analytical-games.ts";
import { evaluateBehavioralStrategy, evaluateIndependentBestResponses } from "../solver/research/mathematical/independent-evaluation.ts";
import { IndependentReferenceCfr, referenceCfrPlusWeight, referenceDcfrScales, regretMatching, validateReferenceGame } from "../solver/research/mathematical/reference-engine.ts";

const algorithms = ["vanilla-cfr", "cfr-plus", "dcfr"];
const configuration = (algorithm) => ({ algorithm, seed: 1, exactMetrics: true, engine: "indexed-tree" });
const maximumDelta = (left, right) => left.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - right[index])), 0);

function flattened(reference, field) {
  return [...reference.information].sort(([left], [right]) => left.localeCompare(right)).flatMap(([, state]) => state[field]);
}

function uniformStrategy(provider) {
  const strategy = {};
  const seen = new Set();
  const visit = (state) => {
    const actor = provider.actor(state);
    if (actor === null) return;
    const actions = provider.legalActions(state);
    if (actor !== "chance") {
      const key = provider.informationSetKey(state);
      if (!seen.has(key)) {
        seen.add(key);
        strategy[key] = Object.fromEntries(actions.map((action) => [provider.actionKey(state, action), 1 / actions.length]));
      }
    }
    for (const action of actions) visit(provider.transition(state, action));
  };
  visit(provider.initialState());
  return strategy;
}

function compareIterations(provider, algorithm, iterations) {
  const compiled = compileGenericGame(provider);
  const reference = new IndependentReferenceCfr(provider, configuration(algorithm));
  const production = new CompactCfrSolver(compiled.provider, compiled.tree, configuration(algorithm));
  production.initialize();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    reference.iterate();
    production.iterate();
  }
  return {
    reference,
    production,
    regretDelta: maximumDelta(flattened(reference, "regrets"), [...production.regrets]),
    strategySumDelta: maximumDelta(flattened(reference, "strategySums"), [...production.strategySums]),
  };
}

test("Phase 6.13 regret matching and regret matching+ handle positive, negative and zero vectors", () => {
  assert.deepEqual(regretMatching([3, -2, 1]), [0.75, 0, 0.25]);
  assert.deepEqual(regretMatching([-3, -2]), [0.5, 0.5]);
  assert.deepEqual(regretMatching([3, -2, 1], true), [0.75, 0, 0.25]);
  assert.throws(() => regretMatching([0, Number.NaN]), /finite/);
});

test("Phase 6.13 CFR+ and DCFR indexing conventions are explicit", () => {
  assert.equal(referenceCfrPlusWeight(1, 0), 1);
  assert.equal(referenceCfrPlusWeight(2, 2), 0);
  assert.deepEqual(referenceDcfrScales(1, { alpha: 1.5, beta: 0, gamma: 2 }), { positive: 0.5, negative: 0.5, strategy: 0 });
});

test("Phase 6.13 trace exposes chance reach, counterfactual reach and average contribution", () => {
  const solver = new IndependentReferenceCfr(hiddenInformationProvider(), configuration("vanilla-cfr"));
  const trace = solver.iterate();
  const playerZero = trace.visits.find((entry) => entry.informationSet === "hidden:p0:strong");
  assert.equal(playerZero.chanceReach, 0.5);
  assert.equal(playerZero.counterfactualReach, 0.5);
  assert.deepEqual(playerZero.averageStrategyContributions, [0.25, 0.25]);
  assert.equal(trace.visits.some((entry) => entry.informationSet === "hidden:p1" && entry.chanceReach === 0.5), true);
});

for (const algorithm of algorithms) test(`Phase 6.13 ${algorithm} single-step equals independent reference`, () => {
  const result = compareIterations(hiddenInformationProvider(), algorithm, 1);
  assert.equal(result.regretDelta, 0);
  assert.equal(result.strategySumDelta, 0);
});

test("Phase 6.13 CFR, CFR+ and DCFR remain equivalent through iterations 0, 1, 2 and 25", () => {
  for (const algorithm of algorithms) for (const iterations of [0, 1, 2, 25]) {
    const result = compareIterations(hiddenInformationProvider(), algorithm, iterations);
    assert.equal(result.regretDelta, 0, `${algorithm}/${iterations}/regrets`);
    assert.equal(result.strategySumDelta, 0, `${algorithm}/${iterations}/strategy`);
  }
});

test("Phase 6.13 analytical equilibria have zero NashConv and exploitability", () => {
  for (const fixture of analyticalFixtures.filter((entry) => entry.equilibrium)) {
    const result = evaluateIndependentBestResponses(fixture.create(), fixture.equilibrium);
    assert.ok(Math.abs(result.utilities[0]) < 1e-15);
    assert.ok(Math.abs(result.nashConv) < 1e-15);
    assert.ok(Math.abs(result.exploitability) < 1e-15);
  }
});

test("Phase 6.13 independent pure-policy BR agrees with production EV, BR and NashConv", () => {
  for (const fixture of analyticalFixtures) {
    const provider = fixture.create();
    const strategy = uniformStrategy(provider);
    const independent = evaluateIndependentBestResponses(provider, strategy);
    const compiled = compileGenericGame(provider);
    const array = new Float64Array(compiled.tree.totalInformationSetActions);
    compiled.informationSetKeys.forEach((key, info) => {
      const offset = compiled.tree.informationSetActionOffset[info];
      Object.values(strategy[key]).forEach((value, action) => { array[offset + action] = value; });
    });
    const production = evaluateGenericCompactGame(compiled.tree, strategyArrayProbability(compiled.tree, array));
    assert.ok(maximumDelta(independent.utilities, production.utilities) <= 1e-12, fixture.name);
    assert.ok(maximumDelta(independent.bestResponseValues, production.bestResponseValues) <= 1e-12, fixture.name);
    assert.ok(Math.abs(independent.nashConv - production.nashConv) <= 1e-12, fixture.name);
  }
});

test("Phase 6.13 nonuniform chance and negative utilities are evaluated exactly", () => {
  const provider = nonuniformChanceProvider();
  const strategy = { "nonuniform:p0": { A: 1, B: 0 } };
  assert.ok(maximumDelta(evaluateBehavioralStrategy(provider, strategy), [0.2, -0.2]) <= 1e-15);
  const response = evaluateIndependentBestResponses(provider, strategy);
  assert.equal(response.bestResponseValues[0], 0.4);
});

test("Phase 6.13 zero-reach branches stay finite and contribute zero average weight", () => {
  const provider = new TableGameProvider("zero-reach", {
    root: { kind: "decision", player: 0, informationSet: "zero:p0", actions: ["skip", "play"], children: ["p1:skip", "p1:play"] },
    "p1:skip": { kind: "decision", player: 1, informationSet: "zero:p1:skip", actions: ["x", "y"], children: ["tsx", "tsy"] },
    "p1:play": { kind: "decision", player: 1, informationSet: "zero:p1:play", actions: ["x", "y"], children: ["tpx", "tpy"] },
    tsx: { kind: "terminal", utility: 0 }, tsy: { kind: "terminal", utility: 0 },
    tpx: { kind: "terminal", utility: 0 }, tpy: { kind: "terminal", utility: 0 },
  });
  const solver = new IndependentReferenceCfr(provider, configuration("vanilla-cfr"));
  solver.information.get("zero:p0").regrets = [0, 1];
  const trace = solver.iterate();
  assert.equal(trace.visits.flatMap((entry) => entry.averageStrategyContributions).every(Number.isFinite), true);
  assert.equal(trace.visits.some((entry) => entry.playerReach.includes(0)), true);
});

test("Phase 6.13 adversarial tiny and huge finite utilities do not create NaN or Infinity", () => {
  for (const factor of [1e-200, 1e100]) {
    const result = compareIterations(scaleProviderUtilities(hiddenInformationProvider(), factor), "dcfr", 4);
    assert.equal([...result.production.regrets, ...result.production.strategySums].every(Number.isFinite), true);
    assert.equal(result.regretDelta, 0);
  }
});

test("Phase 6.13 invalid games are rejected independently", () => {
  const invalidChance = new TableGameProvider("invalid-chance", {
    root: { kind: "chance", actions: ["a", "b"], probabilities: [0.4, 0.4], children: ["a", "b"] },
    a: { kind: "terminal", utility: 0 }, b: { kind: "terminal", utility: 0 },
  });
  assert.throws(() => validateReferenceGame(invalidChance), /Chance probabilities/);
  const valid = matchingPenniesProvider();
  valid.terminalUtility = (state) => valid.actor(state) === null ? [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] : null;
  const invalidUtility = valid;
  assert.throws(() => validateReferenceGame(invalidUtility), /terminal/);
});

test("Phase 6.13 controlled property games match production for fixed seeds", () => {
  for (const seed of Array.from({ length: 32 }, (_, index) => 61300 + index)) {
    for (const algorithm of algorithms) {
      const result = compareIterations(controlledRandomGame(seed), algorithm, 3);
      assert.ok(result.regretDelta <= 1e-12, `${seed}/${algorithm}/regrets`);
      assert.ok(result.strategySumDelta <= 1e-12, `${seed}/${algorithm}/strategy`);
    }
  }
});

test("Phase 6.13 metamorphic action reversal and utility scaling preserve declared relations", () => {
  const base = hiddenInformationProvider();
  const strategy = uniformStrategy(base);
  const original = evaluateIndependentBestResponses(base, strategy);
  const reversed = evaluateIndependentBestResponses(reverseProviderActions(base), strategy);
  const scaled = evaluateIndependentBestResponses(scaleProviderUtilities(base, 3), strategy);
  assert.deepEqual(reversed.utilities, original.utilities);
  assert.deepEqual(reversed.bestResponseValues, original.bestResponseValues);
  assert.ok(Math.abs(scaled.nashConv - 3 * original.nashConv) <= 1e-12);
});

test("Phase 6.13 Checkpoint V5 resumes CFR, CFR+ and DCFR bit-exactly", () => {
  for (const algorithm of algorithms) {
    const compiled = compileGenericGame(controlledRandomGame(613));
    const uninterrupted = new CompactCfrSolver(compiled.provider, compiled.tree, configuration(algorithm));
    uninterrupted.initialize();
    for (let index = 0; index < 10; index += 1) uninterrupted.iterate();
    const partial = new CompactCfrSolver(compiled.provider, compiled.tree, configuration(algorithm));
    partial.initialize();
    for (let index = 0; index < 5; index += 1) partial.iterate();
    const decoded = deserializeBinaryCheckpointV5(serializeBinaryCheckpointV5(partial).buffer);
    const resumed = new CompactCfrSolver(compiled.provider, compiled.tree, configuration(algorithm));
    restoreBinaryCheckpointV5(resumed, decoded);
    for (let index = 0; index < 5; index += 1) resumed.iterate();
    assert.equal(resumed.stateHash, uninterrupted.stateHash);
    assert.deepEqual([...resumed.regrets], [...uninterrupted.regrets]);
    assert.deepEqual([...resumed.strategySums], [...uninterrupted.strategySums]);
  }
});

test("Phase 6.13 repeated runs have deterministic hashes", () => {
  const run = () => {
    const compiled = compileGenericGame(controlledRandomGame(777));
    const solver = new CompactCfrSolver(compiled.provider, compiled.tree, configuration("dcfr"));
    solver.initialize();
    for (let index = 0; index < 8; index += 1) solver.iterate();
    return { state: solver.stateHash, checkpoint: serializeBinaryCheckpointV5(solver).semanticStateHash };
  };
  assert.deepEqual(run(), run());
});

test("Phase 6.13 independent oracle enforces pure-policy and node budgets", () => {
  assert.throws(() => evaluateIndependentBestResponses(rockPaperScissorsProvider(), uniformStrategy(rockPaperScissorsProvider()), 2), /budget/);
  assert.throws(() => validateReferenceGame(controlledRandomGame(1), 4), /node budget/);
});
