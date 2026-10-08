import { performance } from "node:perf_hooks";
import { IndexedCfrSolver } from "../../algorithms/indexed-cfr";
import { strategyDistance } from "../../comparison/strategy-distance";
import { hashValue } from "../../core/stable";
import { CompiledNashConvEvaluator } from "../../evaluation/compiled-analysis";
import { compileGameTree } from "../../tree/compiled";
import { UnifiedResearchGame } from "../unified/game-tree";
import { solveNormalFormGroundTruth } from "../unified/ground-truth";
import { validateGeneratedDefinition } from "./generated-validation";
import {
  permutePrivateStateLabels,
  permutePlayers,
  renameActionsAndInformationSets,
  reorderChanceBranches,
  restoreRenamedStrategy,
  restorePlayerPermutedStrategy,
  scaleUtilities,
} from "./metamorphic";
import {
  compileWithProfile,
  differentialReferenceVsIndexed,
  runIndexedAlgorithm,
  SCALABILITY_ALGORITHM_VERSION,
  verifyIndexedCheckpointResume,
} from "./performance-profiler";
import { assessResourceBudget, DEFAULT_RESEARCH_BUDGET, safeAbortArtifact, type ResearchResourceBudget } from "./resource-safety";
import { SyntheticExtensiveGameGenerator, SYNTHETIC_GENERATOR_VERSION } from "./synthetic-generator";
import { estimateSyntheticGame, type SyntheticGameConfiguration } from "./tree-size-estimator";

export const SCALE_CONFIGURATIONS: Array<{
  level: "S0" | "S1" | "S2" | "S3" | "S4" | "S5";
  configuration: SyntheticGameConfiguration;
  budgets: number[];
  differentialIterations: number;
}> = [
  { level: "S0", configuration: { id: "scale-s0", players: 2, privateStates: 2, publicSignals: 1, stages: 2, actionsPerDecision: 2, seed: 680, zeroSum: true, perfectRecall: true, dependencyComplexity: "history-coupled" }, budgets: [100, 500, 1000, 2500, 5000], differentialIterations: 500 },
  { level: "S1", configuration: { id: "scale-s1", players: 2, privateStates: 2, publicSignals: 2, stages: 3, actionsPerDecision: 2, seed: 681, zeroSum: true, perfectRecall: true, dependencyComplexity: "history-coupled" }, budgets: [100, 500, 1000, 2500], differentialIterations: 200 },
  { level: "S2", configuration: { id: "scale-s2", players: 2, privateStates: 2, publicSignals: 2, stages: 5, actionsPerDecision: 2, seed: 682, zeroSum: true, perfectRecall: true, dependencyComplexity: "history-coupled" }, budgets: [25, 50, 100, 250], differentialIterations: 20 },
  { level: "S3", configuration: { id: "scale-s3", players: 2, privateStates: 2, publicSignals: 2, stages: 6, actionsPerDecision: 2, seed: 683, zeroSum: true, perfectRecall: true, dependencyComplexity: "history-coupled" }, budgets: [5, 10, 25, 50], differentialIterations: 5 },
  { level: "S4", configuration: { id: "scale-s4", players: 2, privateStates: 2, publicSignals: 2, stages: 7, actionsPerDecision: 2, seed: 684, zeroSum: true, perfectRecall: true, dependencyComplexity: "history-coupled" }, budgets: [1, 2], differentialIterations: 1 },
  { level: "S5", configuration: { id: "scale-s5", players: 2, privateStates: 2, publicSignals: 2, stages: 9, actionsPerDecision: 2, seed: 685, zeroSum: true, perfectRecall: true, dependencyComplexity: "history-coupled" }, budgets: [1], differentialIterations: 1 },
];

function summarizeAlgorithm(run: ReturnType<typeof runIndexedAlgorithm>) {
  return {
    algorithm: run.algorithm,
    configuration: run.configuration,
    configurationHash: run.configurationHash,
    strategyHash: run.strategyHash,
    evaluation: run.evaluation,
    curve: run.curve,
    final: run.final,
    performance: run.performance,
    checkpoint: run.checkpoint,
  };
}

function solveMetamorphic(definition: ReturnType<SyntheticExtensiveGameGenerator["generateGame"]>["definition"], iterations = 500) {
  const solve = (candidate: typeof definition) => {
    const game = new UnifiedResearchGame(candidate);
    const compiled = compileGameTree(game);
    const solver = new IndexedCfrSolver(game, { algorithm: "dcfr", seed: 68, exactMetrics: true, dcfr: { alpha: 2, beta: 0, gamma: 3 }, engine: "indexed-tree" }, compiled);
    const result = solver.solve({ maxIterations: iterations, metricInterval: iterations });
    const evaluation = new CompiledNashConvEvaluator(compiled.root).evaluate(result.strategy);
    return { strategy: result.strategy, evaluation, strategyHash: hashValue(result.strategy) };
  };
  const base = solve(definition);
  const renamed = renameActionsAndInformationSets(definition);
  const renamedSolve = solve(renamed.definition);
  const restored = restoreRenamedStrategy(renamedSolve.strategy, renamed.mapping);
  const reordered = solve(reorderChanceBranches(definition));
  const scaled = solve(scaleUtilities(definition, 3));
  const permuted = solve(permutePrivateStateLabels(definition, 2));
  const playersPermuted = permutePlayers(definition);
  const playersPermutedSolve = solve(playersPermuted.definition);
  const playersRestoredStrategy = restorePlayerPermutedStrategy(playersPermutedSolve.strategy, playersPermuted.informationSetNewToOld);
  const baseProbabilities = Object.values(base.strategy).flatMap((actions) => Object.values(actions)).sort((left, right) => left - right);
  const permutedProbabilities = Object.values(permuted.strategy).flatMap((actions) => Object.values(actions)).sort((left, right) => left - right);
  const privateFrequencyError = baseProbabilities.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - permutedProbabilities[index])), 0);
  const results = {
    rename: { strategyDistance: strategyDistance(base.strategy, restored), utilityError: Math.abs(base.evaluation.utilities[0] - renamedSolve.evaluation.utilities[0]) },
    chanceOrder: { strategyDistance: strategyDistance(base.strategy, reordered.strategy), utilityError: Math.abs(base.evaluation.utilities[0] - reordered.evaluation.utilities[0]) },
    utilityScale: { strategyDistance: strategyDistance(base.strategy, scaled.strategy), exploitabilityScaleError: Math.abs(scaled.evaluation.exploitability - base.evaluation.exploitability * 3) },
    privateStatePermutation: { sortedFrequencyMaximumError: privateFrequencyError, utilityError: Math.abs(base.evaluation.utilities[0] - permuted.evaluation.utilities[0]), exploitabilityError: Math.abs(base.evaluation.exploitability - permuted.evaluation.exploitability) },
    playerPermutation: { strategyDistance: strategyDistance(base.strategy, playersRestoredStrategy), utilitySwapError: Math.abs(base.evaluation.utilities[0] - playersPermutedSolve.evaluation.utilities[1]), exploitabilityError: Math.abs(base.evaluation.exploitability - playersPermutedSolve.evaluation.exploitability) },
  };
  return {
    tolerance: 1e-10,
    passed: results.rename.strategyDistance.maxAbsoluteDelta <= 1e-10
      && results.chanceOrder.strategyDistance.maxAbsoluteDelta <= 1e-10
      && results.utilityScale.strategyDistance.maxAbsoluteDelta <= 1e-10
      && results.utilityScale.exploitabilityScaleError <= 1e-10
      && results.privateStatePermutation.sortedFrequencyMaximumError <= 1e-10
      && results.playerPermutation.strategyDistance.maxAbsoluteDelta <= 1e-10
      && results.playerPermutation.utilitySwapError <= 1e-10,
    results,
  };
}

function runPropertyCases() {
  const generator = new SyntheticExtensiveGameGenerator();
  const cases = Array.from({ length: 24 }, (_, index) => {
    const configuration: SyntheticGameConfiguration = {
      id: `property-${index}`,
      players: 2,
      privateStates: 1 + index % 3,
      publicSignals: 1 + index % 2,
      stages: 1 + index % 3,
      actionsPerDecision: 2 + index % 2,
      seed: 8_000 + index,
      zeroSum: true,
      perfectRecall: true,
      dependencyComplexity: (["independent", "stage-coupled", "history-coupled"] as const)[index % 3],
    };
    const first = generator.generateGame(configuration);
    const second = generator.generateGame(configuration);
    const validation = validateGeneratedDefinition(first.definition);
    const game = new UnifiedResearchGame(first.definition);
    const compiled = compileGameTree(game);
    const solver = new IndexedCfrSolver(game, { algorithm: "dcfr", seed: configuration.seed, exactMetrics: false, dcfr: { alpha: 2, beta: 0, gamma: 3 }, engine: "indexed-tree" }, compiled);
    const result = solver.solve({ maxIterations: 12, metricInterval: 12 });
    const checkpoint = solver.checkpoint();
    const evaluation = new CompiledNashConvEvaluator(compiled.root).evaluate(result.strategy);
    const strategyValid = Object.values(result.strategy).every((actions) => {
      const probabilities = Object.values(actions);
      return probabilities.every((probability) => Number.isFinite(probability) && probability >= 0 && probability <= 1)
        && Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) <= 1e-12;
    });
    const regretsFinite = checkpoint.infosets.every((informationSet) => informationSet.regrets.every(Number.isFinite));
    const strategySumsFinite = checkpoint.infosets.every((informationSet) => informationSet.strategySum.every(Number.isFinite));
    const utilitiesFinite = evaluation.utilities.every(Number.isFinite);
    const numericalStability = strategyValid && regretsFinite && strategySumsFinite && utilitiesFinite
      && Number.isFinite(result.metrics.averagePositiveRegret);
    return {
      seed: configuration.seed,
      configuration,
      hash: first.definitionHash,
      deterministic: first.definitionHash === second.definitionHash,
      validation,
      properties: { strategyValid, regretsFinite, strategySumsFinite, utilitiesFinite, numericalStability },
    };
  });
  return { count: cases.length, passed: cases.every((entry) => entry.deterministic && entry.validation.valid && entry.properties.numericalStability), failures: cases.filter((entry) => !entry.deterministic || !entry.validation.valid || !entry.properties.numericalStability) };
}

function algorithmConsistency(algorithms: Array<ReturnType<typeof runIndexedAlgorithm>>) {
  const values = algorithms.map((run) => run.evaluation.utilities[0]);
  const exploitabilities = algorithms.map((run) => run.evaluation.exploitability);
  return {
    strategyEvSpread: Math.max(...values) - Math.min(...values),
    exploitabilityRange: [Math.min(...exploitabilities), Math.max(...exploitabilities)] as [number, number],
    bestExploitabilityAlgorithm: algorithms.reduce((best, run) => run.evaluation.exploitability < best.evaluation.exploitability ? run : best).algorithm,
    fastestAlgorithm: algorithms.reduce((best, run) => run.performance.traversalRuntimeMs < best.performance.traversalRuntimeMs ? run : best).algorithm,
  };
}

export function runPhase68Research(resourceBudget: ResearchResourceBudget = DEFAULT_RESEARCH_BUDGET) {
  const generator = new SyntheticExtensiveGameGenerator();
  const started = performance.now();
  const failures: Array<{ experiment: string; reason: string }> = [];
  const scales = SCALE_CONFIGURATIONS.map((entry) => {
    const estimate = estimateSyntheticGame(entry.configuration);
    const decision = assessResourceBudget(estimate, Math.max(...entry.budgets), resourceBudget);
    if (!decision.allowed) return safeAbortArtifact(entry.level, estimate, decision);
    try {
      const generated = generator.generateGame(entry.configuration);
      const validation = validateGeneratedDefinition(generated.definition);
      if (!validation.valid) throw new Error(`structural-validation:${validation.issues.join(",")}`);
      const game = new UnifiedResearchGame(generated.definition);
      const compilation = compileWithProfile(game);
      const algorithms = (["vanilla-cfr", "cfr-plus", "dcfr"] as const).map((algorithm) => runIndexedAlgorithm(game, compilation.compiled, estimate, algorithm, entry.budgets, resourceBudget));
      const differential = differentialReferenceVsIndexed(game, compilation.compiled, "dcfr", entry.differentialIterations);
      const checkpoint = verifyIndexedCheckpointResume(game, compilation.compiled, Math.max(2, entry.differentialIterations * 2));
      const groundTruth = entry.level === "S0" ? solveNormalFormGroundTruth(game) : null;
      return {
        level: entry.level,
        status: algorithms.some((algorithm) => algorithm.final.stoppedBy === "runtime") ? "runtime-limited" as const : "completed" as const,
        executed: true,
        configuration: entry.configuration,
        gameHash: generated.definitionHash,
        estimate,
        actual: generated.actual,
        generationMs: generated.generationMs,
        validation,
        compilation: {
          objectCompileMs: compilation.objectCompileMs,
          indexedCompileMs: compilation.indexedCompileMs,
          indexedStorageBytes: compilation.indexedStorageBytes,
          bytesPerNode: compilation.bytesPerNode,
          statistics: compilation.compiled.statistics,
        },
        algorithms: algorithms.map(summarizeAlgorithm),
        algorithmConsistency: algorithmConsistency(algorithms),
        differential,
        checkpoint,
        independentValidation: groundTruth ? {
          method: groundTruth.method,
          value: groundTruth.value,
          exploitability: groundTruth.evaluation.exploitability,
          strategyHash: groundTruth.strategyHash,
          pureStrategies: groundTruth.pureStrategies,
        } : { method: "not-feasible; BR/NashConv/differential/metamorphic invariants used", exploitability: null },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ experiment: entry.level, reason });
      return { level: entry.level, status: "failed" as const, executed: true, estimate, configuration: entry.configuration, reason };
    }
  });
  const s0 = scales.find((scale) => scale.level === "S0" && scale.status === "completed");
  if (!s0 || !("configuration" in s0)) throw new Error("S0 must complete before metamorphic validation.");
  const s0Generated = generator.generateGame(s0.configuration);
  const metamorphic = solveMetamorphic(s0Generated.definition);
  const properties = runPropertyCases();
  const runtimeAbortConfiguration: SyntheticGameConfiguration = { ...SCALE_CONFIGURATIONS[1].configuration, id: "runtime-abort-control" };
  const runtimeAbortGenerated = generator.generateGame(runtimeAbortConfiguration);
  const runtimeAbortGame = new UnifiedResearchGame(runtimeAbortGenerated.definition);
  const runtimeAbortCompiled = compileGameTree(runtimeAbortGame);
  const runtimeAbortSolver = new IndexedCfrSolver(runtimeAbortGame, { algorithm: "dcfr", seed: 68, exactMetrics: false, dcfr: { alpha: 2, beta: 0, gamma: 3 } }, runtimeAbortCompiled);
  const runtimeAbort = runtimeAbortSolver.solve({ maxIterations: 25_000, metricInterval: 25_000, maxRuntimeMs: 1 });
  const successful = scales.filter((scale) => "algorithms" in scale && Array.isArray(scale.algorithms)) as unknown as Array<{ level: string; status: string; estimate: ReturnType<typeof estimateSyntheticGame>; gameHash: string; algorithms: Array<ReturnType<typeof summarizeAlgorithm>>; differential: ReturnType<typeof differentialReferenceVsIndexed>; checkpoint: ReturnType<typeof verifyIndexedCheckpointResume> }>;
  const largest = successful.reduce((best, scale) => scale.estimate.nodes > best.estimate.nodes ? scale : best, successful[0]);
  const gates = {
    S1: scales.filter((scale) => scale.executed).every((scale) => scale.status !== "failed" && (!("validation" in scale) || scale.validation.valid)),
    S2: successful.every((scale) => scale.differential.passed) && metamorphic.passed && properties.passed,
    S3: successful.every((scale) => scale.checkpoint.identicalStrategy && scale.checkpoint.identicalCheckpoint && scale.checkpoint.envelopeValid),
    S4: successful.length >= 5 && scales.some((scale) => scale.status === "safe-abort"),
    S5: successful.every((scale) => scale.algorithms.every((algorithm) => Number.isFinite(algorithm.performance.nodesPerSecond) && algorithm.performance.nodesPerSecond > 0)),
    S6: true,
  };
  const semantic = scales.map((scale) => {
    const solved = successful.find((entry) => entry.level === scale.level);
    if (!solved) return { level: scale.level, status: scale.status, estimate: scale.estimate };
    return { level: solved.level, status: solved.status, gameHash: solved.gameHash, algorithms: solved.algorithms.map((algorithm) => ({ algorithm: algorithm.algorithm, strategyHash: algorithm.strategyHash, checkpoint: algorithm.checkpoint.semanticHash, exploitability: algorithm.evaluation.exploitability, nashConv: algorithm.evaluation.nashConv })), differential: solved.differential.passed, checkpoint: solved.checkpoint };
  });
  return {
    schemaVersion: 1,
    researchVersion: "0.8.0",
    baseline: "d2b72f812f694228edad82ff17bc44dc121a2f47",
    trust: "Experimental",
    verifiedDatasets: 0,
    historicalGates: { A: true, B: true, C: true, D: false },
    previousResearchGates: { U1: true, U2: true, U3: true, U4: true, U5: true },
    algorithmVersions: { generator: SYNTHETIC_GENERATOR_VERSION, benchmark: SCALABILITY_ALGORITHM_VERSION, indexedRepresentation: "indexed-f64-v1", checkpoint: 3 },
    resourceBudget,
    scales,
    largestCompletedLevel: largest?.level ?? null,
    metamorphic,
    propertyTesting: properties,
    resourceSafety: {
      runtimeAbort: { stoppedBy: runtimeAbort.metrics.stoppedBy, iterations: runtimeAbort.metrics.iteration, requestedIterations: 25_000, passed: runtimeAbort.metrics.stoppedBy === "runtime" },
      nodeBudgetAbort: scales.find((scale) => scale.status === "safe-abort") ?? null,
    },
    failures,
    gates,
    totalRuntimeMs: performance.now() - started,
    semanticHash: hashValue({ gates, semantic, metamorphic, properties: { passed: properties.passed, count: properties.count }, failures }),
    limitations: [
      "Benchmarks are synthetic two-player zero-sum games and do not produce poker strategy.",
      "Only S0 has independent normal-form ground truth; larger games share BR/evaluation components with the solver stack.",
      "Peak memory is sampled between checkpoints, not measured by a native heap profiler.",
      "Kernel timing for regret updates and strategy accumulation is calibrated and not additive wall-clock attribution.",
      "S5 is intentionally not materialized because the preflight node budget rejects it.",
      "Historical Gate D remains failed and Verified remains zero.",
    ],
  };
}
