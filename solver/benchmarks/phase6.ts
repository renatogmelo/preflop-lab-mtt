import { execFileSync } from "node:child_process";
import { cpus, freemem, platform, totalmem } from "node:os";
import { resolve } from "node:path";
import { createHoldemDeck, type SolverCard } from "../cards/cards";
import { EquityEngine } from "../cards/equity";
import { evaluateHoldemHand, evaluateHoldemHandReference } from "../cards/hand-evaluator";
import { privateDealDistribution } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import { strategyDistance } from "../comparison/strategy-distance";
import { continuationArtifactKey } from "../continuation/cache";
import { EquityProvider, continuationRequestHash, type ContinuationRequest, type ContinuationResult, type StrategicContinuationProvider } from "../continuation/engine";
import { StrengthProxyProvider } from "../continuation/strength-proxy";
import { CoupledPreflopPostflopSolver, PairTableContinuationProvider } from "../coupling/engine";
import { hashValue } from "../core/stable";
import { SOLVER_VERSION } from "../core/version";
import type { AlgorithmName, BehavioralStrategy, DcfrParameters, SolverConfiguration } from "../core/types";
import { NashConvEvaluator } from "../evaluation/best-response";
import { CompiledNashConvEvaluator } from "../evaluation/compiled-analysis";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../evaluation/holdem-preflop";
import { ConvergenceExperimentRunner, descriptiveStatistics, providerSeparationRatio, withinProviderSeedNoise } from "../experiments/convergence";
import { PHASE6_REFERENCE_GAME_ID, assertPhase6ReferenceGame, phase6ReferenceActionHistory, phase6ReferenceBoardProvider, phase6ReferenceFlop, phase6ReferenceGameHash, phase6ReferencePostflopAbstraction, phase6ReferencePostflopDefinition, phase6ReferencePreflop, phase6ReferenceRanges } from "../experiments/phase6-reference";
import { HoldemPreflopV2Solver } from "../game/holdem-preflop-v2";
import { RangePostflopHoldemSubgame, solveRangePostflopSubgame, type RangePostflopArtifact, type RangePostflopSolveConfiguration } from "../game/range-postflop-subgame";
import { readJson, writeJson } from "../storage/files";
import { compileGameTree } from "../tree/compiled";

const SOURCE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const startedAt = new Date().toISOString();
const phaseStarted = performance.now();
const reference = assertPhase6ReferenceGame();
const budgets = [20, 50, 100, 250, 500, 1_000, 2_500];
const seeds = [1, 7, 19, 42, 99];
type Phase5Artifact = {
  rangePostflop: {
    runtime: { solveMs: number; [key: string]: unknown };
    convergence: { exploitability: number };
  };
  continuationComparison: {
    meanStrategies: { equity: BehavioralStrategy; solved: BehavioralStrategy };
    seedVariance: { solved: { distance: { mean: number } } };
    strategyDistances: { equityVsSolved: { weightedMeanAbsoluteDelta: number } };
  };
};

type PreflopRun = {
  seed: number;
  runtimeMs: number;
  solveId: string;
  strategy: BehavioralStrategy;
  strategyHash: string;
  convergence: unknown;
  evaluation: ReturnType<HoldemPreflopStrategyEvaluator["evaluate"]>;
  frequencies: { sbRaise: number; bbCall: number };
  cacheEntries: number;
};

type CouplingSummary = ReturnType<typeof summarizeCoupling>;

class MemoProvider implements StrategicContinuationProvider {
  readonly id: string;
  readonly level;
  readonly eligibleForVerified;
  private readonly cache = new Map<string, ContinuationResult>();
  constructor(readonly inner: StrategicContinuationProvider) {
    this.id = "memo:" + inner.id;
    this.level = inner.level;
    this.eligibleForVerified = inner.eligibleForVerified;
  }
  evaluate(request: ContinuationRequest) {
    const key = continuationRequestHash(request);
    const existing = this.cache.get(key);
    if (existing) return existing;
    const result = this.inner.evaluate(request);
    this.cache.set(key, result);
    return result;
  }
  get size() { return this.cache.size; }
}

function averageStrategy(strategies: BehavioralStrategy[]) {
  const result: BehavioralStrategy = {};
  const keys = new Set(strategies.flatMap((strategy) => Object.keys(strategy)));
  keys.forEach((key) => {
    const actions = new Set(strategies.flatMap((strategy) => Object.keys(strategy[key] ?? {})));
    result[key] = {};
    actions.forEach((action) => {
      result[key][action] = strategies.reduce((sum, strategy) => sum + (strategy[key]?.[action] ?? 0), 0) / strategies.length;
    });
  });
  return result;
}

function rangeFrequency(strategy: BehavioralStrategy, player: 0 | 1, action: string) {
  const prefix = player === 0 ? "SB" : "BB";
  const suffix = player === 0 ? "|root" : "|SB:raise:2";
  const entries = phase6ReferenceRanges[player].entries().filter(({ weight }) => weight > 0);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return entries.reduce((sum, entry) => sum + entry.weight * (strategy[prefix + "|" + entry.combo.id + suffix]?.[action] ?? 0), 0) / total;
}

function pairProvider(artifact: RangePostflopArtifact) {
  return new PairTableContinuationProvider(
    new Map(artifact.pairUtilities.map((entry) => [entry.pairKey, entry.utilities])),
    { pot: 4, stacks: [8, 8] },
    artifact,
  );
}

function experiment(algorithm: AlgorithmName, parameters: {
  dcfr?: DcfrParameters;
  cfrPlusAveragingDelay?: number;
  budgets?: number[];
  engine?: "object-tree" | "indexed-tree";
} = {}) {
  const configuration: SolverConfiguration = {
    algorithm,
    seed: 19,
    exactMetrics: false,
    engine: parameters.engine ?? "indexed-tree",
    dcfr: parameters.dcfr,
    cfrPlusAveragingDelay: parameters.cfrPlusAveragingDelay,
  };
  return new ConvergenceExperimentRunner(
    new RangePostflopHoldemSubgame(phase6ReferencePostflopDefinition()),
    {
      referenceGameId: PHASE6_REFERENCE_GAME_ID,
      configuration,
      budgets: parameters.budgets ?? budgets,
      maximumRuntimeMs: 180_000,
      maximumHeapBytes: Math.floor(totalmem() * 0.8),
      activeReachThreshold: 1e-8,
    },
  ).run();
}

const finalPoint = (result: ReturnType<typeof experiment>) => {
  const point = result.history.at(-1);
  if (!point) throw new Error("Convergence experiment produced no checkpoint.");
  return point;
};
const thresholdRuntime = (result: ReturnType<typeof experiment>, threshold: number) =>
  result.history.find((point) => point.exploitability < threshold)?.runtimeMs ?? null;

function summarizeCoupling(result: ReturnType<CoupledPreflopPostflopSolver["solve"]>) {
  return {
    id: result.id,
    trust: result.trust,
    converged: result.converged,
    stopReason: result.stopReason,
    dampingAlpha: result.dampingAlpha,
    convergencePatience: result.convergencePatience,
    convergenceCriteria: result.convergenceCriteria,
    outerMetrics: result.outerMetrics,
    continuationValueHistory: result.continuationValueHistory,
    cache: result.cache,
    conditionalRanges: result.conditionalRanges,
    postflopArtifacts: result.postflopArtifacts.map((artifact) => ({
      id: artifact.id,
      gameDefinitionHash: artifact.gameDefinitionHash,
      rangeHashes: artifact.rangeHashes,
      convergence: artifact.convergence,
      runtime: artifact.runtime,
      strategyHash: hashValue(artifact.strategy),
    })),
    finalPreflop: {
      id: result.preflop.id,
      strategyHash: hashValue(result.preflop.strategy),
      metrics: result.preflop.metrics.at(-1),
    },
  };
}

function actionFrequency(strategy: BehavioralStrategy, player: 0 | 1, comboId: string, action: string) {
  const key = player === 0 ? `SB|${comboId}|root` : `BB|${comboId}|SB:raise:2`;
  return strategy[key]?.[action] ?? 0;
}

function classifyShift(oldEquity: number, oldSolved: number, equity: number, solved: number, noise: number) {
  const oldGap = oldSolved - oldEquity;
  const gap = solved - equity;
  if (Math.abs(gap) <= noise) return "unstable";
  if (Math.sign(oldGap) !== 0 && Math.sign(gap) !== Math.sign(oldGap)) return "reversed";
  if (Math.abs(gap) < 0.1 || Math.abs(gap) < Math.abs(oldGap) * 0.25) return "disappeared";
  if (Math.abs(gap) < Math.abs(oldGap) * 0.75) return "reduced";
  return "persistent";
}

async function main() {
  const phase5 = await readJson<Phase5Artifact>(resolve("solver/artifacts/phase5-strategic-coupling-v0.3.0.json"));
  const manifest: Array<Record<string, unknown>> = [];
  manifest.push({
    id: "phase6-run-002-global-performance-object",
    category: "harness",
    status: "failed",
    failure: "The second full run completed, but artifact serialization referenced the Node global performance object instead of the measured performanceProfile.",
    resolution: "Serialize performanceProfile through explicit object properties and rerun the complete matrix.",
  });
  manifest.push({
    id: "phase6-run-001-invalid-quantization-fixture",
    category: "harness",
    status: "failed",
    failure: "The first full run used 1 + 4e-9 for an already unit-weight combo; WeightedRange correctly rejected the invalid input before artifacts were written.",
    resolution: "Use 1 - 4e-9 so the cache-quantization control remains inside the declared [0, 1] domain.",
  });
  const record = (id: string, category: string, result: unknown, notes?: string) =>
    manifest.push({ id, category, status: "completed", resultHash: hashValue(result), notes });

  const objectBaseline = experiment("dcfr", {
    engine: "object-tree",
    budgets: [20, 100, 500, 1_000],
    dcfr: { alpha: 1.5, beta: 0, gamma: 2 },
  });
  record("object-tree-baseline", "performance", objectBaseline);

  const algorithms = {
    vanilla: experiment("vanilla-cfr"),
    cfrPlus: experiment("cfr-plus", { cfrPlusAveragingDelay: 0 }),
    dcfr: experiment("dcfr", { dcfr: { alpha: 1.5, beta: 0, gamma: 2 } }),
  };
  Object.entries(algorithms).forEach(([id, result]) => record("algorithm-" + id, "algorithm-shootout", result));

  const cfrPlusStudy = {
    delay0: algorithms.cfrPlus,
    delay100: experiment("cfr-plus", { cfrPlusAveragingDelay: 100 }),
    delay500: experiment("cfr-plus", { cfrPlusAveragingDelay: 500 }),
  };
  Object.entries(cfrPlusStudy).slice(1).forEach(([id, result]) => record("cfr-plus-" + id, "cfr-plus-averaging", result));

  const dcfrStudy = {
    baseline: algorithms.dcfr,
    lowerDiscount: experiment("dcfr", { dcfr: { alpha: 1, beta: 0, gamma: 1 } }),
    strongerPositive: experiment("dcfr", { dcfr: { alpha: 2, beta: 0, gamma: 3 } }),
    negativeDecay: experiment("dcfr", { dcfr: { alpha: 1.5, beta: -0.5, gamma: 2 } }),
  };
  Object.entries(dcfrStudy).slice(1).forEach(([id, result]) => record("dcfr-" + id, "dcfr-parameters", result));

  const candidates = [
    ...Object.entries(algorithms).map(([id, result]) => ({ id, result })),
    ...Object.entries(cfrPlusStudy).slice(1).map(([id, result]) => ({ id: "cfrPlus-" + id, result })),
    ...Object.entries(dcfrStudy).slice(1).map(([id, result]) => ({ id: "dcfr-" + id, result })),
  ].sort((a, b) => finalPoint(a.result).exploitability - finalPoint(b.result).exploitability);
  const selected = candidates[0];
  const selectedConfig = selected.result.configuration;
  const finalConvergence = experiment(selectedConfig.algorithm, {
    dcfr: selectedConfig.dcfr,
    cfrPlusAveragingDelay: selectedConfig.cfrPlusAveragingDelay,
    budgets: [...budgets, 5_000],
  });
  record("selected-5000", "inner-convergence", finalConvergence, "Selected at 2,500: " + selected.id);

  const wallClockCandidates = Object.entries(algorithms).map(([algorithm, result]) => ({
    algorithm,
    runtimeToT2Ms: thresholdRuntime(result, 0.05),
    finalExploitability: finalPoint(result).exploitability,
    finalRuntimeMs: finalPoint(result).runtimeMs,
  }));
  const wallClockWinner = [...wallClockCandidates].sort((a, b) => {
    if (a.runtimeToT2Ms !== null && b.runtimeToT2Ms !== null) return a.runtimeToT2Ms - b.runtimeToT2Ms;
    if (a.runtimeToT2Ms !== null) return -1;
    if (b.runtimeToT2Ms !== null) return 1;
    return a.finalExploitability - b.finalExploitability;
  })[0];

  const solveConfig: RangePostflopSolveConfiguration = {
    algorithm: selectedConfig.algorithm,
    iterations: 5_000,
    metricInterval: 500,
    seed: 19,
    exactMetrics: true,
    engine: "indexed-tree",
    dcfr: selectedConfig.dcfr,
    cfrPlusAveragingDelay: selectedConfig.cfrPlusAveragingDelay,
  };
  const solvedArtifact = solveRangePostflopSubgame(phase6ReferencePostflopDefinition(), solveConfig);
  record("final-range-artifact", "postflop-solve", {
    id: solvedArtifact.id,
    convergence: solvedArtifact.convergence,
    runtime: solvedArtifact.runtime,
  });
  const solvedProvider = pairProvider(solvedArtifact);

  const factories: Record<string, () => MemoProvider> = {
    proxy: () => new MemoProvider(new StrengthProxyProvider()),
    equity: () => new MemoProvider(new EquityProvider(new EquityEngine(), { exactThreshold: 2_000, seed: 17 })),
    solved: () => new MemoProvider(solvedProvider),
  };
  const runs: Record<string, PreflopRun[]> = { proxy: [], equity: [], solved: [] };
  for (const [name, factory] of Object.entries(factories)) {
    for (const seed of seeds) {
      const provider = factory();
      const config = { ...phase6ReferencePreflop, seed, iterations: 10_000, metricInterval: 2_500 };
      const before = performance.now();
      const solve = new HoldemPreflopV2Solver(config, provider, phase6ReferenceRanges).solve();
      const evaluator = new HoldemPreflopStrategyEvaluator(
        new HoldemPreflopEvaluationGame(config, phase6ReferenceRanges, provider, [...phase6ReferenceFlop]),
      );
      runs[name].push({
        seed,
        runtimeMs: performance.now() - before,
        solveId: solve.id,
        strategy: solve.strategy,
        strategyHash: hashValue(solve.strategy),
        convergence: solve.metrics.at(-1),
        evaluation: evaluator.evaluate(solve.strategy),
        frequencies: {
          sbRaise: rangeFrequency(solve.strategy, 0, "raise:2"),
          bbCall: rangeFrequency(solve.strategy, 1, "call"),
        },
        cacheEntries: provider.size,
      });
    }
    record("provider-" + name + "-five-seeds", "provider-seed-study", runs[name]);
  }
  const means = Object.fromEntries(Object.entries(runs).map(([name, values]) => [
    name,
    averageStrategy(values.map((value) => value.strategy)),
  ])) as Record<string, BehavioralStrategy>;
  const stability = Object.fromEntries(Object.entries(runs).map(([name, values]) => [name, {
    strategyDistance: withinProviderSeedNoise(values.map((value) => value.strategy)),
    exploitability: descriptiveStatistics(values.map((value) => value.evaluation.exploitability)),
    evP0: descriptiveStatistics(values.map((value) => value.evaluation.utilities[0])),
    runtimeMs: descriptiveStatistics(values.map((value) => value.runtimeMs)),
  }]));
  const providerDistances = {
    proxyVsEquity: strategyDistance(means.proxy, means.equity),
    proxyVsSolved: strategyDistance(means.proxy, means.solved),
    equityVsSolved: strategyDistance(means.equity, means.solved),
  };
  const separation = providerSeparationRatio(
    providerDistances.equityVsSolved.weightedMeanAbsoluteDelta,
    stability.solved.strategyDistance.statistics.mean,
  );

  const targets = [
    ["T9s BB call", 1, "T9s", "call"],
    ["QQ SB raise", 0, "QQ", "raise:2"],
    ["AKs SB raise", 0, "AKs", "raise:2"],
    ["JJ BB call", 1, "JJ", "call"],
    ["AKo SB raise", 0, "AKo", "raise:2"],
  ].map(([label, player, canonical, action]) => ({
    label: String(label),
    player: player as 0 | 1,
    action: String(action),
    combo: phase6ReferenceRanges[player as 0 | 1].entries().find((entry) => entry.combo.canonical === canonical)!.combo,
  }));
  const shiftAudit = targets.map((target) => {
    const oldEquity = actionFrequency(phase5.continuationComparison.meanStrategies.equity, target.player, target.combo.id, target.action);
    const oldSolved = actionFrequency(phase5.continuationComparison.meanStrategies.solved, target.player, target.combo.id, target.action);
    const equity = actionFrequency(means.equity, target.player, target.combo.id, target.action);
    const solved = actionFrequency(means.solved, target.player, target.combo.id, target.action);
    const noise = descriptiveStatistics(runs.solved.map((run) => actionFrequency(run.strategy, target.player, target.combo.id, target.action))).standardDeviation;
    return {
      label: target.label,
      comboId: target.combo.id,
      action: target.action,
      phase5: { equity: oldEquity, solved: oldSolved, gap: oldSolved - oldEquity },
      phase6: { equity, solved, gap: solved - equity },
      solvedSeedStandardDeviation: noise,
      classification: classifyShift(oldEquity, oldSolved, equity, solved, noise),
    };
  });

  const actionEvaluator = new HoldemPreflopStrategyEvaluator(
    new HoldemPreflopEvaluationGame(phase6ReferencePreflop, phase6ReferenceRanges, solvedProvider, [...phase6ReferenceFlop]),
  );
  const perActionEv = actionEvaluator.counterfactualActionEvs(means.solved);
  const targetActionEv = targets.map((target) => {
    const key = target.player === 0 ? `SB|${target.combo.id}|root` : `BB|${target.combo.id}|SB:raise:2`;
    return { label: target.label, diagnostic: perActionEv.find((entry) => entry.informationSet === key) ?? null };
  });
  const mixed = perActionEv.filter((entry) => Object.values(entry.probabilities).filter((p) => p >= 0.01).length >= 2);
  const mixedSpreads = mixed.map((entry) => entry.mixedActionEvSpread).filter((value): value is number => value !== null);

  const couplingBase = {
    preflop: { ...phase6ReferencePreflop, seed: 19, iterations: 10_000, metricInterval: 2_500 },
    ranges: phase6ReferenceRanges,
    actionHistory: phase6ReferenceActionHistory,
    flop: [...phase6ReferenceFlop] as [SolverCard, SolverCard, SolverCard],
    postflopAbstraction: phase6ReferencePostflopAbstraction,
    boardProvider: phase6ReferenceBoardProvider,
    postflopSolve: { ...solveConfig, iterations: 1_000, metricInterval: 1_000 },
    outerIterations: 10,
    preflopSeedMode: "fixed" as const,
    maximumRuntimeMs: 120_000,
    stopOnOscillation: true,
    divergenceWindow: 4,
    rangeHashQuantization: 1e-9,
    convergence: {
      preflopStrategyDelta: 0.02,
      conditionalRangeDelta: 0.02,
      continuationUtilityDelta: 0.02,
      postflopStrategyDelta: 0.02,
      patience: 3,
    },
  };
  const couplingGrid: Record<string, CouplingSummary> = {};
  for (const alpha of [0.25, 0.4, 0.6]) {
    const result = new CoupledPreflopPostflopSolver(
      { ...couplingBase, dampingAlpha: alpha },
      new MemoProvider(new EquityProvider(new EquityEngine(), { exactThreshold: 2_000, seed: 17 })),
    ).solve();
    couplingGrid[String(alpha)] = summarizeCoupling(result);
    record("coupling-alpha-" + alpha, "coupling-grid", couplingGrid[String(alpha)]);
  }
  const noDampingSummary = summarizeCoupling(new CoupledPreflopPostflopSolver(
    { ...couplingBase, dampingAlpha: 1, outerIterations: 5 },
    new MemoProvider(new EquityProvider(new EquityEngine(), { exactThreshold: 2_000, seed: 17 })),
  ).solve());
  record("coupling-alpha-1", "coupling-ablation", noDampingSummary);

  const frozen = new MemoProvider(solvedProvider);
  const frozenRuns = seeds.map((seed) => new HoldemPreflopV2Solver(
    { ...phase6ReferencePreflop, seed, iterations: 10_000, metricInterval: 10_000 },
    frozen,
    phase6ReferenceRanges,
  ).solve().strategy);
  const repeated = new HoldemPreflopV2Solver(
    { ...phase6ReferencePreflop, seed: seeds[0], iterations: 10_000, metricInterval: 10_000 },
    frozen,
    phase6ReferenceRanges,
  ).solve().strategy;
  const frozenContinuation = {
    sameSeed: strategyDistance(frozenRuns[0], repeated),
    crossSeedNoise: withinProviderSeedNoise(frozenRuns),
  };
  record("frozen-continuation", "ablation", frozenContinuation);

  const frozenRangeRuns = seeds.map((seed) => solveRangePostflopSubgame(
    phase6ReferencePostflopDefinition(),
    { ...solveConfig, iterations: 1_000, metricInterval: 1_000, seed },
  ));
  const frozenRange = {
    uniqueStrategyHashes: new Set(frozenRangeRuns.map((run) => hashValue(run.strategy))).size,
    pairwiseNoise: withinProviderSeedNoise(frozenRangeRuns.map((run) => run.strategy),
    ),
    exploitabilities: frozenRangeRuns.map((run) => run.convergence.exploitability),
    conclusion: "Full-tree postflop CFR is deterministic; seed is provenance only.",
  };
  record("frozen-range-five-seeds", "ablation", frozenRange);

  const identity = {
    board: [...phase6ReferenceFlop],
    pot: 4,
    stacks: [8, 8] as [number, number],
    actingPlayer: 1 as const,
    position: "BB",
    actionHistory: phase6ReferenceActionHistory,
    ranges: phase6ReferenceRanges,
    bettingAbstraction: phase6ReferencePostflopAbstraction,
    algorithmConfiguration: solveConfig,
  };
  const perturbed: [WeightedRange, WeightedRange] = [
    new WeightedRange(phase6ReferenceRanges[0].entries().map((entry, index) => ({
      combo: entry.combo,
      weight: entry.weight - (index === 0 ? 4e-9 : 0),
    }))),
    phase6ReferenceRanges[1],
  ];
  const quantizationStudy = [1e-6, 1e-8, 1e-9, 1e-10].map((quantization) => ({
    quantization,
    cacheKeyReused: continuationArtifactKey(identity, quantization) === continuationArtifactKey({ ...identity, ranges: perturbed }, quantization),
    inputRangeL1: 4e-9,
    maximumPerWeightRoundingError: quantization / 2,
  }));
  const originalStrategy = new HoldemPreflopV2Solver(
    { ...phase6ReferencePreflop, seed: 19, iterations: 10_000, metricInterval: 10_000 },
    new StrengthProxyProvider(),
    phase6ReferenceRanges,
  ).solve().strategy;
  const perturbedStrategy = new HoldemPreflopV2Solver(
    { ...phase6ReferencePreflop, seed: 19, iterations: 10_000, metricInterval: 10_000 },
    new StrengthProxyProvider(),
    perturbed,
  ).solve().strategy;
  const quantizationDistance = strategyDistance(originalStrategy, perturbedStrategy);
  record("range-hash-quantization", "cache-diagnostic", { quantizationStudy, quantizationDistance });

  const perfGame = new RangePostflopHoldemSubgame(phase6ReferencePostflopDefinition());
  const perfCompiled = compileGameTree(perfGame);
  const dynamicStarted = performance.now();
  const dynamicEval = new NashConvEvaluator(perfGame).evaluate(finalConvergence.finalStrategy);
  const dynamicBrMs = performance.now() - dynamicStarted;
  const compiledStarted = performance.now();
  const compiledEval = new CompiledNashConvEvaluator(perfCompiled.root).evaluate(finalConvergence.finalStrategy);
  const compiledBrMs = performance.now() - compiledStarted;
  if (Math.abs(dynamicEval.nashConv - compiledEval.nashConv) > 1e-12) throw new Error("Compiled BR changed NashConv.");

  const deals = privateDealDistribution(phase6ReferenceRanges[0], phase6ReferenceRanges[1], [...phase6ReferenceFlop]);
  const equityEngine = new EquityEngine();
  const coldStarted = performance.now();
  deals.forEach((deal) => equityEngine.comboEquity(deal.playerZero, deal.playerOne, [...phase6ReferenceFlop], { exactThreshold: 2_000, seed: 17 }));
  const equityColdMs = performance.now() - coldStarted;
  const warmStarted = performance.now();
  deals.forEach((deal) => equityEngine.comboEquity(deal.playerZero, deal.playerOne, [...phase6ReferenceFlop], { exactThreshold: 2_000, seed: 17 }));
  const equityWarmMs = performance.now() - warmStarted;

  const deck = createHoldemDeck();
  const hands = Array.from({ length: 2_000 }, (_, sample) =>
    Array.from({ length: 7 }, (_, offset) => deck[(sample * 7 + offset * 11) % deck.length]),
  ).filter((hand) => new Set(hand.map((card) => card.id)).size === 7);
  const refStarted = performance.now();
  hands.forEach(evaluateHoldemHandReference);
  const handReferenceMs = performance.now() - refStarted;
  const optStarted = performance.now();
  hands.forEach(evaluateHoldemHand);
  const handOptimizedMs = performance.now() - optStarted;

  const indexedFinal = finalPoint(algorithms.dcfr);
  const objectFinal = finalPoint(objectBaseline);
  const performanceProfile = {
    phase5: phase5.rangePostflop.runtime,
    objectTree: objectFinal,
    indexedTree: indexedFinal,
    indexedTraversalSpeedup: indexedFinal.iterationsPerSecond / objectFinal.iterationsPerSecond,
    phase5ToPhase6TwentyIterationWallSpeedup: phase5.rangePostflop.runtime.solveMs / algorithms.dcfr.history[0].runtimeMs,
    br: { dynamicMs: dynamicBrMs, compiledMs: compiledBrMs, speedup: dynamicBrMs / compiledBrMs, nashConv: compiledEval.nashConv },
    equity: { pairs: deals.length, coldMs: equityColdMs, warmMs: equityWarmMs, speedup: equityColdMs / Math.max(1e-9, equityWarmMs), cache: equityEngine.cacheMetrics() },
    handEvaluator: { hands: hands.length, referenceMs: handReferenceMs, optimizedMs: handOptimizedMs, speedup: handReferenceMs / Math.max(1e-9, handOptimizedMs) },
    selectedProfile: finalConvergence.profiling,
  };
  record("performance-profile", "performance", performanceProfile);

  const bestCoupling = Object.values(couplingGrid).sort((a, b) =>
    Number(a.outerMetrics.at(-1)!.preflopStrategyDelta) - Number(b.outerMetrics.at(-1)!.preflopStrategyDelta),
  )[0];
  const final = finalPoint(finalConvergence);
  const artifact = {
    schemaVersion: 1,
    phase: 6,
    solverVersion: SOLVER_VERSION,
    sourceCommit: SOURCE_COMMIT,
    startedAt,
    finishedAt: new Date().toISOString(),
    trust: "Experimental",
    verifiedDatasets: 0,
    environment: {
      node: process.version,
      platform: platform(),
      cpu: cpus()[0]?.model ?? "unknown",
      logicalCores: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryAtArtifactBytes: freemem(),
      language: "TypeScript f64 single-threaded",
    },
    referenceGame: {
      ...reference,
      independentlyRecordedHash: phase6ReferenceGameHash,
      frozenAgainstPhase5: true,
      board: phase6ReferenceFlop.map((card) => card.notation),
      abstraction: phase6ReferencePostflopAbstraction,
      futureBoardProvider: phase6ReferenceBoardProvider.metadata(),
    },
    baselinePhase5: {
      exploitability: phase5.rangePostflop.convergence.exploitability,
      solvedSeedDistance: phase5.continuationComparison.seedVariance.solved.distance.mean,
      equityVsSolvedDistance: phase5.continuationComparison.strategyDistances.equityVsSolved.weightedMeanAbsoluteDelta,
    },
    innerSolver: {
      objectBaseline,
      algorithms,
      cfrPlusStudy,
      dcfrStudy,
      selectedCandidateAt2500: selected.id,
      finalConvergence,
      finalRangeArtifact: solvedArtifact,
      wallClockCandidates,
      wallClockWinner,
      convergedApproximationPolicy: {
        exploitabilityMaximum: 0.01,
        reachWeightedStrategyDeltaMaximum: 0.005,
        deterministicReproductionRequired: true,
        seedStabilityRequired: true,
        satisfied: final.exploitability <= 0.01 && (final.strategyDelta?.reachWeightedStrategyDelta ?? Infinity) <= 0.005,
      },
    },
    seedAndProviderStudy: {
      seeds,
      preflopIterations: 10_000,
      runs,
      meanStrategies: means,
      seedStability: stability,
      providerDistances,
      providerSeparationRatio: separation,
      comboLevelInterpretationAllowed: separation.value !== null && separation.value > 1,
      shiftAudit,
    },
    counterfactualActionEv: {
      methodology: "Exact reduced-game counterfactual reach over the compiled tree.",
      targets: targetActionEv,
      allInformationSets: perActionEv,
      mixedStrategyDiagnostics: mixed,
      mixedEvSpreadStatistics: mixedSpreads.length ? descriptiveStatistics(mixedSpreads) : null,
    },
    coupling: { grid: couplingGrid, noDampingAblation: noDampingSummary, bestObserved: bestCoupling, frozenContinuation, frozenRange },
    cacheQuantization: { study: quantizationStudy, measuredStrategyDistance: quantizationDistance, selected: 1e-9 },
    performance: performanceProfile,
    errorBudget: {
      finiteCfrConvergence: final.exploitability,
      futureBoardAbstraction: "Dominant unquantified model error: two representatives change the game.",
      sampling: "Postflop is deterministic; sampled preflop variance is measured separately.",
      seedVariance: stability.solved.strategyDistance.statistics,
      outerLoopInstability: bestCoupling.outerMetrics.at(-1),
      warning: "Sources are not added into a fake scalar total uncertainty.",
    },
    rustDecisionGate: {
      largestHotPath: "Indexed CFR traversal",
      measuredSharePercent: finalConvergence.profiling.approximatePercent.cfrTraversalIncludingRegretMatchingAndInfosetLookup,
      typescriptGain: performanceProfile.indexedTraversalSpeedup,
      maximumMeasuredTree: finalConvergence.tree,
      nativeCandidate: "Traversal and regret arrays only after a declared scale gate requires it.",
      recommendation: "Do not migrate yet.",
    },
    stopGatePhase7: {
      A_innerConverges: final.exploitability < 0.02,
      B_seedsStable: stability.solved.strategyDistance.statistics.mean < 0.1,
      C_providerSignalExceedsNoise: separation.value !== null && separation.value > 1,
      D_couplingFixedPoint: Object.values(couplingGrid).some((result) => result.converged),
    },
    limitations: [
      "Experimental reduced HU game, not 8-max.",
      "One fixed flop and seven physical combos per range.",
      "Future turn/river chance is a two-outcome abstraction.",
      "One bet size per street and no raises or jams in the main game.",
      "No external-solver comparison or independent review.",
      "Verified remains zero.",
    ],
    totalRuntimeMs: performance.now() - phaseStarted,
  };
  const manifestArtifact = {
    schemaVersion: 1,
    phase: 6,
    sourceCommit: SOURCE_COMMIT,
    solverVersion: SOLVER_VERSION,
    referenceGameId: PHASE6_REFERENCE_GAME_ID,
    referenceGameHash: phase6ReferenceGameHash,
    startedAt,
    finishedAt: artifact.finishedAt,
    experiments: manifest,
    includesNegativeResults: true,
  };
  await writeJson(resolve("solver/artifacts/phase6-convergence-stability-v0.4.0.json"), artifact);
  await writeJson(resolve("solver/artifacts/phase6-reference-v0.4.0.checkpoint.json"), finalConvergence.checkpoint);
  await writeJson(resolve("solver/experiments/phase6-manifest.json"), manifestArtifact);
  process.stdout.write(JSON.stringify({
    sourceCommit: SOURCE_COMMIT,
    reference,
    phase5Exploitability: artifact.baselinePhase5.exploitability,
    final,
    selectedCandidate: selected.id,
    wallClockWinner,
    stability,
    providerDistances,
    separation,
    shiftAudit,
    coupling: Object.fromEntries(Object.entries(couplingGrid).map(([alpha, result]) => [alpha, {
      converged: result.converged,
      stopReason: result.stopReason,
      iterations: result.outerMetrics.length,
      final: result.outerMetrics.at(-1),
    }])),
    noDamping: {
      converged: noDampingSummary.converged,
      stopReason: noDampingSummary.stopReason,
      iterations: noDampingSummary.outerMetrics.length,
      final: noDampingSummary.outerMetrics.at(-1),
    },
    performance: performanceProfile,
    stopGatePhase7: artifact.stopGatePhase7,
    totalRuntimeMs: artifact.totalRuntimeMs,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
