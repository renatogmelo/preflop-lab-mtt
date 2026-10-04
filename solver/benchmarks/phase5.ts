import { resolve } from "node:path";
import { VanillaCfr } from "../algorithms/cfr";
import { createCombo, createHoldemDeck } from "../cards/cards";
import { privateDealDistribution } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import { strategyDistance, aggregateComboActionFrequencies } from "../comparison/strategy-distance";
import { EquityProvider, continuationRequestHash, type ContinuationRequest, type ContinuationResult, type StrategicContinuationProvider } from "../continuation/engine";
import { StrengthProxyProvider } from "../continuation/strength-proxy";
import { CoupledPreflopPostflopSolver, PairTableContinuationProvider } from "../coupling/engine";
import { hashValue } from "../core/stable";
import { SOLVER_VERSION } from "../core/version";
import { StrategyEvaluator } from "../evaluation/best-response";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../evaluation/holdem-preflop";
import { HoldemPreflopV2Solver } from "../game/holdem-preflop-v2";
import { BucketedBoardProvider, RangePostflopHoldemSubgame, solveRangePostflopSubgame } from "../game/range-postflop-subgame";
import { writeJson } from "../storage/files";

const deck = createHoldemDeck();
const card = (notation: string) => {
  const result = deck.find((candidate) => candidate.notation === notation);
  if (!result) throw new Error("Unknown card " + notation);
  return result;
};
const combo = (first: string, second: string) => createCombo(card(first), card(second));

const ranges: [WeightedRange, WeightedRange] = [
  new WeightedRange([
    { combo: combo("As", "Ah"), weight: 1 },
    { combo: combo("Qs", "Qh"), weight: 0.85 },
    { combo: combo("As", "Ks"), weight: 0.75 },
    { combo: combo("Ad", "Kh"), weight: 0.6 },
    { combo: combo("7s", "6s"), weight: 0.45 },
    { combo: combo("Ac", "5c"), weight: 0.35 },
    { combo: combo("Js", "9s"), weight: 0.25 },
  ]),
  new WeightedRange([
    { combo: combo("Kd", "Kc"), weight: 1 },
    { combo: combo("Jh", "Jd"), weight: 0.85 },
    { combo: combo("Qd", "Jd"), weight: 0.7 },
    { combo: combo("Ac", "Qh"), weight: 0.55 },
    { combo: combo("6h", "5h"), weight: 0.45 },
    { combo: combo("Ad", "4d"), weight: 0.3 },
    { combo: combo("Tc", "9c"), weight: 0.25 },
  ]),
];
const flop = [card("8h"), card("7d"), card("2c")] as const;
const boardProvider = new BucketedBoardProvider(2);
const postflopAbstraction = {
  flopBetFractions: [0.33],
  turnBetFractions: [0.5],
  riverBetFractions: [1],
  raisePotFractions: [],
  maxRaisesPerStreet: 0 as const,
  jamAllowed: false,
};
const postflopSolve = { algorithm: "dcfr" as const, iterations: 20, metricInterval: 20, seed: 19 };
const basePreflop = {
  id: "phase5-hu-10bb-controlled",
  seed: 1,
  iterations: 4_000,
  metricInterval: 1_000,
  stack: 10,
  smallBlind: 0.5,
  bigBlind: 1,
  sbOpenRaiseTo: [2],
  bbVsLimpRaiseTo: [],
  bbThreeBetTo: [],
  sbFourBetTo: [],
  maximumRaises: 1,
  limpAllowed: false,
  jamAllowed: false,
  continuationBoard: [...flop],
  continuationAbstractionId: "phase5-fixed-flop-weighted-ranges-v1",
};
const actionHistory = ["raise:2", "call"];

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

function pairValues(artifact: ReturnType<typeof solveRangePostflopSubgame>) {
  const values = new Map<string, [number, number]>();
  for (const deal of privateDealDistribution(ranges[0], ranges[1], [...flop])) {
    const game = new RangePostflopHoldemSubgame({
      id: "phase5-pair-" + deal.playerZero.id + "-" + deal.playerOne.id,
      ranges: [
        new WeightedRange([{ combo: deal.playerZero, weight: 1 }]),
        new WeightedRange([{ combo: deal.playerOne, weight: 1 }]),
      ],
      flop: [...flop],
      pot: 4,
      stacks: [8, 8],
      firstPlayer: 1,
      abstraction: postflopAbstraction,
      boardProvider,
      rangeSource: { description: "Pairwise evaluation under the weighted-range subgame strategy." },
    });
    values.set(deal.playerZero.id + "|" + deal.playerOne.id, new StrategyEvaluator(game).evaluate(artifact.strategy));
  }
  return values;
}

function averageStrategy(strategies: Array<Record<string, Record<string, number>>>) {
  const result: Record<string, Record<string, number>> = {};
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

function stats(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, standardDeviation: Math.sqrt(variance), minimum: Math.min(...values), maximum: Math.max(...values) };
}

function rootFrequency(strategy: Record<string, Record<string, number>>, player: 0 | 1, action: string) {
  const position = player === 0 ? "SB" : "BB";
  const suffix = player === 0 ? "|root" : "|SB:raise:2";
  const source = ranges[player].entries().filter(({ weight }) => weight > 0);
  const total = source.reduce((sum, entry) => sum + entry.weight, 0);
  return source.reduce((sum, entry) => sum + entry.weight * (strategy[position + "|" + entry.combo.id + suffix]?.[action] ?? 0), 0) / total;
}

function comboRows(strategy: Record<string, Record<string, number>>) {
  return ranges[0].entries().map(({ combo: item }) => ({
    combo: item.notation,
    canonical: item.canonical,
    sb: strategy["SB|" + item.id + "|root"] ?? {},
  }));
}

async function main() {
  const phaseStarted = performance.now();
  const rangeArtifact = solveRangePostflopSubgame({
    id: "phase5-weighted-range-reference",
    ranges,
    flop: [...flop],
    pot: 4,
    stacks: [8, 8],
    firstPlayer: 1,
    abstraction: postflopAbstraction,
    boardProvider,
    rangeSource: { description: "Hand-selected physical combos spanning premiums, broadways, connectors, weak suited aces and bluff candidates." },
  }, postflopSolve);
  const solvedProvider = new PairTableContinuationProvider(pairValues(rangeArtifact), { pot: 4, stacks: [8, 8] }, rangeArtifact);
  const providerFactories = {
    proxy: () => new MemoProvider(new StrengthProxyProvider()),
    equity: () => new MemoProvider(new EquityProvider(undefined, { exactThreshold: 2_000, seed: 17 })),
    solved: () => new MemoProvider(solvedProvider),
  };
  const seeds = [1, 7, 42];
  type ExperimentRun = {
    seed: number;
    solveId: string;
    iterations: number;
    infosets: number;
    convergence: unknown;
    evaluation: ReturnType<HoldemPreflopStrategyEvaluator["evaluate"]>;
    runtimeMs: number;
    overallRangeFrequency: { sbRaise: number; sbFold: number; bbCall: number; bbFold: number };
    comboFrequencies: ReturnType<typeof comboRows>;
    strategyHash: string;
    continuationCacheEntries: number;
  };
  const runs: Record<string, ExperimentRun[]> = { proxy: [], equity: [], solved: [] };
  const strategies: Record<string, Array<Record<string, Record<string, number>>>> = { proxy: [], equity: [], solved: [] };

  for (const [model, factory] of Object.entries(providerFactories)) {
    for (const seed of seeds) {
      const provider = factory();
      const configuration = { ...basePreflop, seed };
      const started = performance.now();
      const solve = new HoldemPreflopV2Solver(configuration, provider, ranges).solve();
      const evaluation = new HoldemPreflopStrategyEvaluator(
        new HoldemPreflopEvaluationGame(configuration, ranges, provider, [...flop]),
      ).evaluate(solve.strategy);
      const runtimeMs = performance.now() - started;
      strategies[model].push(solve.strategy);
      runs[model].push({
        seed,
        solveId: solve.id,
        iterations: solve.iterations,
        infosets: solve.infosets,
        convergence: solve.metrics.at(-1),
        evaluation,
        runtimeMs,
        overallRangeFrequency: {
          sbRaise: rootFrequency(solve.strategy, 0, "raise:2"),
          sbFold: rootFrequency(solve.strategy, 0, "fold"),
          bbCall: rootFrequency(solve.strategy, 1, "call"),
          bbFold: rootFrequency(solve.strategy, 1, "fold"),
        },
        comboFrequencies: comboRows(solve.strategy),
        strategyHash: hashValue(solve.strategy),
        continuationCacheEntries: provider.size,
      });
    }
  }

  const means = Object.fromEntries(Object.entries(strategies).map(([model, values]) => [model, averageStrategy(values)]));
  const pairwise = {
    proxyVsEquity: strategyDistance(means.proxy, means.equity),
    proxyVsSolved: strategyDistance(means.proxy, means.solved),
    equityVsSolved: strategyDistance(means.equity, means.solved),
  };
  const comboCanonical = Object.fromEntries(ranges.flatMap((range) => range.entries()).map(({ combo: item }) => [item.id, item.canonical]));
  const aggregates169 = Object.fromEntries(Object.entries(means).map(([model, strategy]) => [model, aggregateComboActionFrequencies(strategy, comboCanonical)]));
  const seedVariance = Object.fromEntries(Object.entries(strategies).map(([model, values]) => {
    const distances = [];
    for (let left = 0; left < values.length; left += 1) for (let right = left + 1; right < values.length; right += 1) distances.push(strategyDistance(values[left], values[right]).weightedMeanAbsoluteDelta);
    return [model, { distance: stats(distances), sbRaise: stats(runs[model].map((run) => run.overallRangeFrequency.sbRaise)) }];
  }));

  const exactGame = new HoldemPreflopEvaluationGame(basePreflop, ranges, new StrengthProxyProvider(), [...flop]);
  const exactStarted = performance.now();
  const exactSolve = new VanillaCfr(exactGame, { seed: 1 }).solve({ maxIterations: 4_000, metricInterval: 4_000 });
  const exactRuntimeMs = performance.now() - exactStarted;
  const sampledComparisons = [];
  for (const iterations of [250, 1_000, 4_000]) {
    const sampled = new HoldemPreflopV2Solver({ ...basePreflop, iterations, metricInterval: iterations }, new StrengthProxyProvider(), ranges).solve();
    sampledComparisons.push({
      iterations,
      distanceToEnumerated: strategyDistance(sampled.strategy, exactSolve.strategy),
      sampledHash: hashValue(sampled.strategy),
    });
  }

  const coupling = new CoupledPreflopPostflopSolver({
    preflop: { ...basePreflop, seed: 7, iterations: 2_500, metricInterval: 500 },
    ranges,
    actionHistory,
    flop: [...flop],
    postflopAbstraction,
    boardProvider,
    postflopSolve: { ...postflopSolve, iterations: 12, metricInterval: 12 },
    outerIterations: 3,
    dampingAlpha: 0.6,
    convergence: { preflopStrategyDelta: 0.02, conditionalRangeDelta: 0.02, continuationUtilityDelta: 0.02 },
  }, new MemoProvider(new EquityProvider(undefined, { exactThreshold: 2_000, seed: 17 }))).solve();

  const artifact = {
    schemaVersion: 1,
    phase: 5,
    solverVersion: SOLVER_VERSION,
    createdAt: "2026-10-03T00:00:00.000Z",
    trust: "Experimental",
    scientificQuestion: "Do strategically solved continuation values create measurable, reproducible preflop strategy differences in the declared reduced HU game?",
    gameDefinition: {
      scope: "HU 10bb fixed-flop controlled preflop game",
      preflop: basePreflop,
      postflop: {
        board: flop.map((item) => item.notation),
        bettingAbstraction: postflopAbstraction,
        chanceAbstraction: boardProvider.metadata(),
      },
      ranges: ranges.map((range) => range.entries().map(({ combo: item, weight }) => ({ combo: item.notation, canonical: item.canonical, weight }))),
      privateDeals: privateDealDistribution(ranges[0], ranges[1], [...flop]).length,
      gameDefinitionHash: hashValue({ basePreflop, postflopAbstraction, board: flop.map((item) => item.id), ranges: ranges.map((range) => range.entries().map(({ combo: item, weight }) => [item.id, weight])) }),
    },
    rangePostflop: rangeArtifact,
    continuationComparison: {
      controlledVariables: {
        seeds,
        iterations: basePreflop.iterations,
        stack: basePreflop.stack,
        actions: ["SB fold", "SB raise 2bb", "BB fold", "BB call"],
        board: flop.map((item) => item.notation),
        ranges: "identical physical-combo weighted ranges",
      },
      runs,
      meanStrategies: means,
      aggregateBy169Class: aggregates169,
      strategyDistances: pairwise,
      seedVariance,
      evDifferences: Object.fromEntries(Object.entries(runs).map(([model, modelRuns]) => [model, stats(modelRuns.map((run) => run.evaluation.utilities[0]))])),
      actionEvByCombo: { available: false, reason: "The V2 experiment evaluates complete strategies and best responses; per-action counterfactual EV export is not implemented in this phase." },
    },
    sampledVsEnumerated: {
      exactTraversal: {
        algorithm: "vanilla-cfr",
        iterations: exactSolve.metrics.iteration,
        metrics: exactSolve.metrics,
        runtimeMs: exactRuntimeMs,
        strategyHash: hashValue(exactSolve.strategy),
      },
      sampledTraversal: sampledComparisons,
      interpretation: "Distance is measured against the enumerated solution of the same reduced chance game; finite-iteration monotonicity is not assumed.",
    },
    coupling,
    performance: {
      totalRuntimeMs: performance.now() - phaseStarted,
      rangeSubgame: rangeArtifact.runtime,
      preflopRunRuntimeMs: Object.fromEntries(Object.entries(runs).map(([model, modelRuns]) => [model, stats(modelRuns.map((run) => run.runtimeMs))])),
      exactEvaluationRuntimeMs: Object.fromEntries(Object.entries(runs).map(([model, modelRuns]) => [model, stats(modelRuns.map((run) => run.evaluation.totalEvaluationMs))])),
      cache: coupling.cache,
    },
    limitations: [
      "Experimental reduced HU game; not 8-max and not a professional full-game range.",
      "One fixed flop is used in preflop comparison.",
      "Future boards use a deterministic three-outcome abstraction that changes the solved game.",
      "No postflop raises are present in the main experiment, although the engine and tests support one raise.",
      "Finite CFR iterations produce approximate equilibria, never mathematical exactness.",
      "No independent external solver validation has been performed.",
      "Per-action preflop counterfactual EVs are not exported.",
    ],
  };
  await writeJson(resolve("solver/artifacts/phase5-strategic-coupling-v0.3.0.json"), artifact);
  await writeJson(resolve("datasets/solver-experimental/preflop-lab-solver-experimental-v0.3.0.json"), {
    schemaVersion: 1,
    id: "preflop-lab-solver-experimental-v0.3.0",
    name: "Preflop Lab Solver Experimental",
    version: "0.3.0",
    trustLevel: "experimental",
    status: "published",
    solverVersion: SOLVER_VERSION,
    artifactId: artifact.gameDefinition.gameDefinitionHash,
    methodology: "Original reduced HU CFR experiment with physical combo ranges, exact private-card evaluation, abstracted future boards and iterative preflop-postflop coupling.",
    license: "Original Preflop Lab solver output; no third-party commercial ranges.",
    strategy: means.solved,
    strategyHash: hashValue(means.solved),
    metrics: {
      providerDistances: pairwise,
      seedVariance,
      coupling: { converged: coupling.converged, outerMetrics: coupling.outerMetrics },
    },
    limitations: artifact.limitations,
  });
  process.stdout.write(JSON.stringify({
    rangeSubgame: { tree: rangeArtifact.tree, exploitability: rangeArtifact.convergence.exploitability, runtime: rangeArtifact.runtime },
    providerDistances: pairwise,
    seedVariance,
    sampledVsEnumerated: sampledComparisons.map((entry) => ({ iterations: entry.iterations, weightedMeanAbsoluteDelta: entry.distanceToEnumerated.weightedMeanAbsoluteDelta })),
    coupling: { converged: coupling.converged, outerMetrics: coupling.outerMetrics, cache: coupling.cache },
    totalRuntimeMs: artifact.performance.totalRuntimeMs,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
