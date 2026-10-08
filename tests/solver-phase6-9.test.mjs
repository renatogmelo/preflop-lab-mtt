import assert from "node:assert/strict";
import test from "node:test";
import { IndexedCfrSolver } from "../solver/algorithms/indexed-cfr.ts";
import { strategyDistance } from "../solver/comparison/strategy-distance.ts";
import { CompiledNashConvEvaluator } from "../solver/evaluation/compiled-analysis.ts";
import {
  COMPACT_CHECKPOINT_SCHEMA,
  CompactBestResponseEvaluatorV2,
  CompactCfrSolver,
  CompactExtensiveGame,
  CompactNashConvEvaluatorV2,
  SyntheticCompactProvider,
  compactPreflightV2,
  compactStrategyToBehavioral,
  compileCompactGame,
  evaluateCompactStrategy,
  evaluateLazyStrategy,
  strategyArrayProbability,
} from "../solver/research/compact/index.ts";
import { SCALE_CONFIGURATIONS } from "../solver/research/scalability/experiment-runner.ts";
import { SyntheticExtensiveGameGenerator } from "../solver/research/scalability/synthetic-generator.ts";
import { UnifiedResearchGame } from "../solver/research/unified/game-tree.ts";
import { compileGameTree } from "../solver/tree/compiled.ts";

const s0 = SCALE_CONFIGURATIONS[0].configuration;

function compactFixture(configuration = s0) {
  const provider = new SyntheticCompactProvider(configuration);
  const compilation = compileCompactGame(provider);
  return { provider, compilation, tree: compilation.tree };
}

test("Phase 6.9 direct compiler exactly matches estimated S0 structure", () => {
  const { provider, tree } = compactFixture();
  assert.equal(tree.validation.valid, true);
  assert.equal(tree.validation.nodes, provider.estimate.nodes);
  assert.equal(tree.validation.terminals, provider.estimate.terminals);
  assert.equal(tree.validation.chanceNodes, provider.estimate.chanceNodes);
  assert.equal(tree.validation.decisionNodes, provider.estimate.decisionNodes);
  assert.equal(tree.validation.informationSets, provider.estimate.informationSets);
  assert.equal(tree.validation.allReachable, true);
});

test("Phase 6.9 compact provider preserves keys, actions, chance and utilities", () => {
  const generated = new SyntheticExtensiveGameGenerator().generateGame(s0);
  const provider = new SyntheticCompactProvider(s0);
  const compact = new CompactExtensiveGame(provider);
  const game = new UnifiedResearchGame(generated.definition);
  const compiled = compileGameTree(game);
  const uniform = new Float64Array(provider.estimate.informationSets * s0.actionsPerDecision).fill(0.5);
  const compactValue = evaluateLazyStrategy(provider, (_informationSet, action) => uniform[action]).utilities;
  const objectStrategy = Object.fromEntries(Array.from({ length: provider.informationSetCount }, (_, info) => [
    provider.informationSetKey(info),
    { a0: 0.5, a1: 0.5 },
  ]));
  const objectValue = new CompiledNashConvEvaluator(compiled.root).evaluate(objectStrategy).utilities;
  assert.ok(Math.abs(compactValue[0] - objectValue[0]) <= 1e-12);
  assert.equal(compact.walkLazy(() => {}), provider.nodeCount);
});

for (const algorithm of ["vanilla-cfr", "cfr-plus", "dcfr"]) {
  test(`Phase 6.9 compact ${algorithm} is differential-equivalent to indexed CFR`, () => {
    const generated = new SyntheticExtensiveGameGenerator().generateGame(s0);
    const game = new UnifiedResearchGame(generated.definition);
    const compiled = compileGameTree(game);
    const configuration = {
      algorithm,
      seed: 69,
      exactMetrics: true,
      engine: "indexed-tree",
      ...(algorithm === "dcfr" ? { dcfr: { alpha: 1.5, beta: 0, gamma: 2 } } : {}),
    };
    const indexed = new IndexedCfrSolver(game, configuration, compiled);
    indexed.solve({ maxIterations: 25, metricInterval: 25 });
    const { provider, tree } = compactFixture();
    const compact = new CompactCfrSolver(provider, tree, configuration);
    compact.solve({ maxIterations: 25, metricInterval: 25 });
    const distance = strategyDistance(indexed.averageStrategy(), compact.averageStrategy());
    assert.ok(distance.maxAbsoluteDelta <= 1e-12, JSON.stringify(distance));
    const indexedCheckpoint = indexed.checkpoint();
    const indexedByKey = new Map(indexedCheckpoint.infosets.map((info) => [info.key, info]));
    for (let info = 0; info < provider.informationSetCount; info += 1) {
      const object = indexedByKey.get(provider.informationSetKey(info));
      assert.ok(object);
      const offset = tree.informationSetActionOffset[info];
      object.regrets.forEach((value, action) => assert.ok(Math.abs(value - compact.regrets[offset + action]) <= 1e-12));
      object.strategySum.forEach((value, action) => assert.ok(Math.abs(value - compact.strategySums[offset + action]) <= 1e-12));
    }
  });
}

test("Phase 6.9 iterative EV and Best Response V2 match compiled analysis", () => {
  const generated = new SyntheticExtensiveGameGenerator().generateGame(s0);
  const game = new UnifiedResearchGame(generated.definition);
  const compiled = compileGameTree(game);
  const { provider, tree } = compactFixture();
  const solver = new CompactCfrSolver(provider, tree, { algorithm: "dcfr", seed: 69, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } });
  solver.solve({ maxIterations: 40, collectExactMetrics: false });
  const array = solver.averageStrategyArray();
  const probability = strategyArrayProbability(tree, array);
  const strategy = compactStrategyToBehavioral(provider, tree, array);
  const reference = new CompiledNashConvEvaluator(compiled.root).evaluate(strategy);
  const evaluation = evaluateCompactStrategy(tree, probability);
  const response = new CompactBestResponseEvaluatorV2(tree);
  const compact = new CompactNashConvEvaluatorV2(tree).evaluate(probability);
  assert.ok(Math.abs(evaluation.utilities[0] - reference.utilities[0]) <= 1e-12);
  assert.ok(Math.abs(response.evaluate(0, probability).value - reference.bestResponses[0].value) <= 1e-12);
  assert.ok(Math.abs(response.evaluate(1, probability).value - reference.bestResponses[1].value) <= 1e-12);
  assert.ok(Math.abs(compact.nashConv - reference.nashConv) <= 1e-12);
});

test("Phase 6.9 checkpoint V4 resumes bit-identically", () => {
  const { provider, tree } = compactFixture();
  const configuration = { algorithm: "dcfr", seed: 69, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } };
  const continuous = new CompactCfrSolver(provider, tree, configuration);
  continuous.solve({ maxIterations: 20, collectExactMetrics: false });
  const interrupted = new CompactCfrSolver(provider, tree, configuration);
  interrupted.solve({ maxIterations: 9, collectExactMetrics: false });
  const checkpoint = interrupted.checkpoint();
  assert.equal(checkpoint.schemaVersion, COMPACT_CHECKPOINT_SCHEMA);
  const resumed = new CompactCfrSolver(provider, tree, configuration);
  resumed.restore(checkpoint);
  resumed.solve({ maxIterations: 20, collectExactMetrics: false });
  assert.equal(resumed.stateHash, continuous.stateHash);
  assert.deepEqual(Array.from(resumed.regrets), Array.from(continuous.regrets));
  assert.deepEqual(Array.from(resumed.strategySums), Array.from(continuous.strategySums));
});

test("Phase 6.9 rejects incompatible checkpoint V4", () => {
  const { provider, tree } = compactFixture();
  const solver = new CompactCfrSolver(provider, tree, { algorithm: "dcfr", seed: 69 });
  solver.solve({ maxIterations: 1, collectExactMetrics: false });
  const checkpoint = solver.checkpoint();
  const incompatible = new CompactCfrSolver(provider, tree, { algorithm: "vanilla-cfr", seed: 69 });
  assert.throws(() => incompatible.restore(checkpoint), /configuration mismatch/);
  const corrupted = structuredClone(checkpoint);
  corrupted.regrets[0] += 1;
  const compatible = new CompactCfrSolver(provider, tree, { algorithm: "dcfr", seed: 69 });
  assert.throws(() => compatible.restore(corrupted), /semantic hash mismatch/);
});

test("Phase 6.9 S5 is safely blocked by the unchanged node budget", () => {
  const decision = compactPreflightV2(SCALE_CONFIGURATIONS[5].configuration);
  assert.equal(decision.allowed, false, JSON.stringify(decision));
  assert.deepEqual(decision.reasons, ["node-budget"]);
  assert.ok(decision.estimate.estimatedPeakBytes < decision.budget.maximumEstimatedPeakBytes);
  assert.ok(decision.estimate.estimatedFullValidationMs < decision.budget.maximumEstimatedRuntimeMs);
});

test("Phase 6.9 compact storage omits duplicate child indices and P1 terminals", () => {
  const { compilation, tree } = compactFixture();
  assert.equal("edgeChild" in tree, false);
  assert.equal("terminalP1" in tree, false);
  assert.equal(compilation.topologyBytes, tree.kind.length * 28);
  assert.ok(compilation.bytesPerNode < 32);
});
