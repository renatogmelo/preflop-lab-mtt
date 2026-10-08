import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { IndexedCfrSolver } from "../solver/algorithms/indexed-cfr.ts";
import { strategyDistance } from "../solver/comparison/strategy-distance.ts";
import { CompiledNashConvEvaluator } from "../solver/evaluation/compiled-analysis.ts";
import { UnifiedResearchGame } from "../solver/research/unified/game-tree.ts";
import { compileGameTree } from "../solver/tree/compiled.ts";
import { createResearchCheckpointV3, validateResearchCheckpointV3 } from "../solver/research/scalability/checkpoint-v3.ts";
import { validateGeneratedDefinition } from "../solver/research/scalability/generated-validation.ts";
import {
  permutePlayers,
  renameActionsAndInformationSets,
  reorderChanceBranches,
  restorePlayerPermutedStrategy,
  restoreRenamedStrategy,
  scaleUtilities,
} from "../solver/research/scalability/metamorphic.ts";
import { compileWithProfile, differentialReferenceVsIndexed, verifyIndexedCheckpointResume } from "../solver/research/scalability/performance-profiler.ts";
import { assessResourceBudget, DEFAULT_RESEARCH_BUDGET, safeAbortArtifact } from "../solver/research/scalability/resource-safety.ts";
import { SyntheticExtensiveGameGenerator } from "../solver/research/scalability/synthetic-generator.ts";
import { estimateSyntheticGame } from "../solver/research/scalability/tree-size-estimator.ts";

const configuration = {
  id: "phase68-test",
  players: 2,
  privateStates: 2,
  publicSignals: 2,
  stages: 2,
  actionsPerDecision: 2,
  seed: 680,
  zeroSum: true,
  perfectRecall: true,
  dependencyComplexity: "history-coupled",
};
const generator = new SyntheticExtensiveGameGenerator();
const generated = generator.generateGame(configuration);

function solveDefinition(definition, iterations = 100) {
  const game = new UnifiedResearchGame(definition);
  const compiled = compileGameTree(game);
  const solver = new IndexedCfrSolver(game, { algorithm: "dcfr", seed: 68, exactMetrics: false, dcfr: { alpha: 2, beta: 0, gamma: 3 }, engine: "indexed-tree" }, compiled);
  const result = solver.solve({ maxIterations: iterations, metricInterval: iterations });
  return { game, compiled, solver, result, evaluation: new CompiledNashConvEvaluator(compiled.root).evaluate(result.strategy) };
}

test("Phase 6.8 synthetic generation is deterministic by seed", () => {
  assert.equal(generated.definitionHash, generator.generateGame(configuration).definitionHash);
  assert.notEqual(generated.definitionHash, generator.generateGame({ ...configuration, seed: 681 }).definitionHash);
});

test("tree-size estimator exactly matches the materialized structure", () => {
  const estimate = estimateSyntheticGame(configuration);
  assert.equal(estimate.nodes, generated.actual.nodes);
  assert.equal(estimate.terminals, generated.actual.terminals);
  assert.equal(estimate.chanceNodes, generated.actual.chanceNodes);
  assert.equal(estimate.decisionNodes, generated.actual.decisionNodes);
  assert.equal(estimate.informationSets, generated.actual.informationSets);
});

test("generated game passes every validation-first invariant", () => {
  const validation = validateGeneratedDefinition(generated.definition);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.perfectRecall, true);
  assert.equal(validation.noInformationLeakage, true);
  assert.equal(validation.zeroSum, true);
});

test("chance distributions are normalized at every generated node", () => {
  for (const node of Object.values(generated.definition.nodes)) {
    if (node.kind === "chance") assert.ok(Math.abs(node.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) <= 1e-12);
  }
});

test("information sets hide the opponent private state", () => {
  const groups = new Map();
  for (const node of Object.values(generated.definition.nodes)) {
    if (node.kind !== "decision") continue;
    const states = groups.get(node.informationSet) ?? new Set();
    states.add(node.observation.opponentPrivateState);
    groups.set(node.informationSet, states);
  }
  assert.ok([...groups.values()].some((states) => states.size > 1));
});

test("indexed solver produces normalized strategies and finite numeric state", () => {
  const { result, solver, evaluation } = solveDefinition(generated.definition, 50);
  for (const actions of Object.values(result.strategy)) {
    const probabilities = Object.values(actions);
    assert.ok(probabilities.every(Number.isFinite));
    assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) <= 1e-12);
  }
  assert.ok([...solver.regrets, ...solver.strategySums, ...evaluation.utilities].every(Number.isFinite));
});

test("action and information-set renaming is metamorphically equivalent", () => {
  const base = solveDefinition(generated.definition);
  const renamed = renameActionsAndInformationSets(generated.definition);
  const transformed = solveDefinition(renamed.definition);
  assert.ok(strategyDistance(base.result.strategy, restoreRenamedStrategy(transformed.result.strategy, renamed.mapping)).maxAbsoluteDelta <= 1e-10);
});

test("chance branch reordering is metamorphically equivalent", () => {
  const base = solveDefinition(generated.definition);
  const transformed = solveDefinition(reorderChanceBranches(generated.definition));
  const distance = strategyDistance(base.result.strategy, transformed.result.strategy);
  assert.ok(distance.maxAbsoluteDelta <= 2e-8, JSON.stringify(distance));
});

test("positive utility scaling preserves strategy and scales exploitability", () => {
  const base = solveDefinition(generated.definition);
  const transformed = solveDefinition(scaleUtilities(generated.definition, 3));
  const distance = strategyDistance(base.result.strategy, transformed.result.strategy);
  assert.ok(distance.maxAbsoluteDelta <= 2e-8, JSON.stringify(distance));
  assert.ok(Math.abs(transformed.evaluation.exploitability - base.evaluation.exploitability * 3) <= 1e-10);
});

test("player permutation swaps utilities and preserves the restored strategy", () => {
  const base = solveDefinition(generated.definition);
  const permutation = permutePlayers(generated.definition);
  const transformed = solveDefinition(permutation.definition);
  const restored = restorePlayerPermutedStrategy(transformed.result.strategy, permutation.informationSetNewToOld);
  const distance = strategyDistance(base.result.strategy, restored);
  assert.ok(distance.maxAbsoluteDelta <= 2e-8, JSON.stringify(distance));
  assert.ok(Math.abs(base.evaluation.utilities[0] - transformed.evaluation.utilities[1]) <= 2e-8, `${base.evaluation.utilities[0]} vs ${transformed.evaluation.utilities[1]}`);
});

test("reference and indexed solvers match strategies, regrets and strategy sums", () => {
  const game = new UnifiedResearchGame(generated.definition);
  const differential = differentialReferenceVsIndexed(game, compileGameTree(game), "dcfr", 20);
  assert.equal(differential.passed, true);
  assert.deepEqual(differential.regretHash, { reference: differential.regretHash.reference, optimized: differential.regretHash.reference });
  assert.deepEqual(differential.strategySumHash, { reference: differential.strategySumHash.reference, optimized: differential.strategySumHash.reference });
});

test("checkpoint V3 validates and continuous/resumed execution is identical", () => {
  const { game, compiled, solver } = solveDefinition(generated.definition, 10);
  assert.equal(validateResearchCheckpointV3(createResearchCheckpointV3(solver.checkpoint())).valid, true);
  const resumed = verifyIndexedCheckpointResume(game, compiled, 40);
  assert.equal(resumed.identicalStrategy, true);
  assert.equal(resumed.identicalCheckpoint, true);
  assert.equal(resumed.envelopeValid, true);
});

test("indexed representation uses typed arrays and records compact bytes per node", () => {
  const profile = compileWithProfile(new UnifiedResearchGame(generated.definition));
  assert.ok(profile.indexed.kind instanceof Uint8Array);
  assert.ok(profile.indexed.edgeProbability instanceof Float64Array);
  assert.ok(profile.indexedStorageBytes > 0);
  assert.ok(Number.isFinite(profile.bytesPerNode));
});

test("resource preflight allows small games and rejects S5-sized games", () => {
  assert.equal(assessResourceBudget(generated.estimate, 100, DEFAULT_RESEARCH_BUDGET).allowed, true);
  const s5 = estimateSyntheticGame({ ...configuration, id: "s5-test", stages: 9 });
  const decision = assessResourceBudget(s5, 1, DEFAULT_RESEARCH_BUDGET);
  assert.equal(decision.allowed, false);
  assert.equal(safeAbortArtifact("S5", s5, decision).executed, false);
});

test("Phase 6.8 artifact preserves trust boundaries and all research gates", async () => {
  const artifact = JSON.parse(await readFile(new URL("../solver/artifacts/phase6-8-unified-scalability-v0.8.0.json", import.meta.url), "utf8"));
  assert.equal(artifact.trust, "Experimental");
  assert.equal(artifact.verifiedDatasets, 0);
  assert.deepEqual(artifact.historicalGates, { A: true, B: true, C: true, D: false });
  assert.deepEqual(artifact.gates, { S1: true, S2: true, S3: true, S4: true, S5: true, S6: true });
});

test("Phase 6.8 artifact records controlled scaling and the first safe limit", async () => {
  const artifact = JSON.parse(await readFile(new URL("../solver/artifacts/phase6-8-unified-scalability-v0.8.0.json", import.meta.url), "utf8"));
  assert.equal(artifact.largestCompletedLevel, "S4");
  assert.equal(artifact.scales.find((entry) => entry.level === "S4").actual.nodes, 131069);
  assert.equal(artifact.scales.find((entry) => entry.level === "S5").status, "safe-abort");
  assert.equal(artifact.resourceSafety.runtimeAbort.passed, true);
});

test("Phase 6.8 artifact records independent, differential and property validation", async () => {
  const artifact = JSON.parse(await readFile(new URL("../solver/artifacts/phase6-8-unified-scalability-v0.8.0.json", import.meta.url), "utf8"));
  assert.equal(artifact.scales[0].independentValidation.exploitability, 0);
  assert.ok(artifact.scales.filter((entry) => entry.executed).every((entry) => entry.differential.passed));
  assert.equal(artifact.metamorphic.passed, true);
  assert.equal(artifact.propertyTesting.count, 24);
  assert.equal(artifact.propertyTesting.passed, true);
  assert.match(artifact.semanticHash, /^[0-9a-f]{16}$/);
});
