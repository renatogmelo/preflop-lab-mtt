import { execFileSync } from "node:child_process";
import { cpus, platform, totalmem } from "node:os";
import { resolve } from "node:path";
import { finiteDifferenceSensitivity } from "../analysis/phase6-5";
import { createHoldemDeck } from "../cards/cards";
import { EquityEngine } from "../cards/equity";
import { privateDealDistribution } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import { strategyDistance } from "../comparison/strategy-distance";
import { EquityProvider, continuationRequestHash, type ContinuationRequest, type ContinuationResult, type StrategicContinuationProvider } from "../continuation/engine";
import { StrengthProxyProvider } from "../continuation/strength-proxy";
import { DeterministicCoupledPreflopPostflopSolver, type DeterministicCouplingConfiguration } from "../coupling/deterministic-engine";
import { PairTableContinuationProvider } from "../coupling/engine";
import { hashValue } from "../core/stable";
import { SOLVER_VERSION } from "../core/version";
import type { BehavioralStrategy } from "../core/types";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../evaluation/holdem-preflop";
import { descriptiveStatistics, providerSeparationRatio, withinProviderSeedNoise } from "../experiments/convergence";
import { PHASE6_REFERENCE_GAME_ID, assertPhase6ReferenceGame, phase6ReferenceActionHistory, phase6ReferenceBoardProvider, phase6ReferenceFlop, phase6ReferenceGameHash, phase6ReferencePostflopAbstraction, phase6ReferencePostflopDefinition, phase6ReferencePreflop, phase6ReferenceRanges } from "../experiments/phase6-reference";
import { ExactHoldemPreflopSolver } from "../game/holdem-preflop-exact";
import { HoldemPreflopV2Solver } from "../game/holdem-preflop-v2";
import { solveRangePostflopSubgame, type RangePostflopSolveConfiguration } from "../game/range-postflop-subgame";
import { conditionalRangeL1, deriveConditionalRangeSnapshots } from "../ranges/conditional";
import { readJson, writeJson } from "../storage/files";

const SOURCE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const BASELINE_COMMIT = "893d62720ca465153030ba5d3dcff25403f8f979";
const startedAt = new Date().toISOString();
const phaseStarted = performance.now();
const seeds = [1, 7, 19, 42, 99];
const sampleModes = ["iid", "fixed-crn", "stratified", "quasi-deterministic"] as const;
const sampleBudgets = [100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const exactSolve = { algorithm: "dcfr" as const, iterations: 5_000, metricInterval: 1_000, dcfr: { alpha: 2, beta: 0, gamma: 3 } };
const postflopSolve: RangePostflopSolveConfiguration = { algorithm: "dcfr", iterations: 5_000, metricInterval: 500, seed: 19, exactMetrics: true, engine: "indexed-tree", dcfr: { alpha: 2, beta: 0, gamma: 3 } };
const progress = (message: string) => process.stdout.write(`[phase6.5] ${message}\n`);

class MemoProvider implements StrategicContinuationProvider {
  readonly id: string;
  readonly level;
  readonly eligibleForVerified;
  private readonly cache = new Map<string, ContinuationResult>();
  constructor(readonly inner: StrategicContinuationProvider) {
    this.id = `memo:${inner.id}`;
    this.level = inner.level;
    this.eligibleForVerified = inner.eligibleForVerified;
  }
  evaluate(request: ContinuationRequest) {
    const key = continuationRequestHash(request);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = this.inner.evaluate(request);
    this.cache.set(key, result);
    return result;
  }
}

type Phase6Artifact = {
  baselinePhase5: { exploitability: number; solvedSeedDistance: number; equityVsSolvedDistance: number };
  seedAndProviderStudy: {
    providerDistances: { equityVsSolved: { weightedMeanAbsoluteDelta: number } };
    providerSeparationRatio: { value: number | null };
    shiftAudit: Array<{ label: string; classification: string }>;
  };
  stopGatePhase7: Record<string, boolean>;
};

function rangeFrequency(strategy: BehavioralStrategy, player: 0 | 1, action: string) {
  const prefix = player === 0 ? "SB" : "BB";
  const suffix = player === 0 ? "|root" : "|SB:raise:2";
  const entries = phase6ReferenceRanges[player].entries().filter(({ weight }) => weight > 0);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return entries.reduce((sum, entry) => sum + entry.weight * (strategy[`${prefix}|${entry.combo.id}${suffix}`]?.[action] ?? 0), 0) / total;
}

function actionFrequency(strategy: BehavioralStrategy, player: 0 | 1, comboId: string, action: string) {
  const key = player === 0 ? `SB|${comboId}|root` : `BB|${comboId}|SB:raise:2`;
  return strategy[key]?.[action] ?? 0;
}

function snapshots(strategy: BehavioralStrategy, id: string) {
  return deriveConditionalRangeSnapshots({ configuration: phase6ReferencePreflop, ranges: phase6ReferenceRanges, strategy, actionHistory: phase6ReferenceActionHistory, board: [...phase6ReferenceFlop], sourceSolveId: id });
}

function sampledSummary(strategy: BehavioralStrategy, exactStrategy: BehavioralStrategy, evaluation: ReturnType<HoldemPreflopStrategyEvaluator["evaluate"]>, sampling: ReturnType<HoldemPreflopV2Solver["solve"]>["sampling"], runtimeMs: number) {
  const exactRanges = snapshots(exactStrategy, "phase6-5-exact-oracle");
  const sampledRanges = snapshots(strategy, "phase6-5-sampled");
  return {
    runtimeMs,
    strategyHash: hashValue(strategy),
    distanceToExact: strategyDistance(exactStrategy, strategy),
    conditionalRangeL1ToExact: Math.max(conditionalRangeL1(exactRanges[0], sampledRanges[0]), conditionalRangeL1(exactRanges[1], sampledRanges[1])),
    evaluation,
    sampling,
  };
}

function summarizeExact(result: ReturnType<ExactHoldemPreflopSolver["solve"]>) {
  return {
    id: result.id,
    strategyHash: hashValue(result.strategy),
    runtimeMs: result.runtimeMs,
    chanceOutcomes: result.chanceOutcomes,
    seedRole: result.seedRole,
    provenanceSeed: result.provenanceSeed,
    solveMetrics: result.solveMetrics,
    evaluation: result.evaluation,
    frequencies: { sbRaise: rangeFrequency(result.strategy, 0, "raise:2"), bbCall: rangeFrequency(result.strategy, 1, "call") },
  };
}

function couplingScore(metric: { preflopReachWeightedDelta: number; conditionalRangeDelta: number | null; dampedContinuationUtilityDelta: number | null; postflopReachWeightedDelta: number | null }) {
  return Math.max(metric.preflopReachWeightedDelta, metric.conditionalRangeDelta ?? Infinity, metric.dampedContinuationUtilityDelta ?? Infinity, metric.postflopReachWeightedDelta ?? Infinity);
}

function summarizeCoupling(result: ReturnType<DeterministicCoupledPreflopPostflopSolver["solve"]>) {
  return {
    id: result.id,
    trust: result.trust,
    verifiedDatasets: result.verifiedDatasets,
    converged: result.converged,
    stopReason: result.stopReason,
    gateD: result.gateD,
    iterations: result.outerMetrics.length,
    outerMetrics: result.outerMetrics,
    continuationValueHistory: result.continuationValueHistory,
    contraction: result.contraction,
    cache: result.cache,
    finalPreflopStrategyHash: hashValue(result.preflop.strategy),
    finalConditionalRanges: result.conditionalRanges,
    postflopArtifacts: result.postflopArtifacts.map((artifact) => ({ id: artifact.id, rangeHashes: artifact.rangeHashes, strategyHash: hashValue(artifact.strategy), convergence: artifact.convergence, runtime: artifact.runtime })),
    checkpoint: result.checkpoint,
  };
}

function couplingConfiguration(alpha: number, postflopIterations: number, outerIterations: number, exactIterations: number): DeterministicCouplingConfiguration {
  return {
    preflop: { ...phase6ReferencePreflop, iterations: exactIterations, metricInterval: exactIterations },
    exactPreflop: { ...exactSolve, iterations: exactIterations, metricInterval: exactIterations },
    ranges: phase6ReferenceRanges,
    actionHistory: phase6ReferenceActionHistory,
    flop: [...phase6ReferenceFlop],
    postflopAbstraction: phase6ReferencePostflopAbstraction,
    boardProvider: phase6ReferenceBoardProvider,
    postflopSolve: { ...postflopSolve, iterations: postflopIterations, metricInterval: postflopIterations },
    outerIterations,
    dampingAlpha: alpha,
    rangeHashQuantization: 1e-9,
    convergence: { preflopStrategyDelta: 0.02, conditionalRangeDelta: 0.02, continuationUtilityDelta: 0.02, postflopStrategyDelta: 0.02, patience: 3 },
    cycleTolerance: 1e-4,
  };
}

async function main() {
  const phase6 = await readJson<Phase6Artifact>(resolve("solver/artifacts/phase6-convergence-stability-v0.4.0.json"));
  const reference = assertPhase6ReferenceGame();
  progress(`baseline ${BASELINE_COMMIT.slice(0, 8)}, implementation ${SOURCE_COMMIT.slice(0, 8)}, game ${reference.hash}`);
  progress("revalidating Gate A with the frozen 5,000-iteration postflop solve");
  const revalidatedPostflop = solveRangePostflopSubgame(phase6ReferencePostflopDefinition(), postflopSolve);
  const solvedProvider = new PairTableContinuationProvider(new Map(revalidatedPostflop.pairUtilities.map((entry) => [entry.pairKey, entry.utilities])), { pot: 4, stacks: [8, 8] }, revalidatedPostflop);
  const gateA = {
    threshold: 0.02,
    exploitability: revalidatedPostflop.convergence.exploitability,
    nashConv: revalidatedPostflop.convergence.nashConv,
    passed: Number(revalidatedPostflop.convergence.exploitability) < 0.02,
    strategyHash: hashValue(revalidatedPostflop.strategy),
    artifactId: revalidatedPostflop.id,
    runtime: revalidatedPostflop.runtime,
  };

  const equityEngine = new EquityEngine();
  const providers: Record<string, StrategicContinuationProvider> = {
    proxy: new MemoProvider(new StrengthProxyProvider()),
    equity: new MemoProvider(new EquityProvider(equityEngine, { exactThreshold: 2_000, seed: 17 })),
    solved: new MemoProvider(solvedProvider),
  };
  const exactResults: Record<string, ReturnType<ExactHoldemPreflopSolver["solve"]>> = {};
  for (const [name, provider] of Object.entries(providers)) {
    progress(`exact provider solve: ${name}`);
    exactResults[name] = new ExactHoldemPreflopSolver(phase6ReferencePreflop, phase6ReferenceRanges, provider, { ...exactSolve, provenanceSeed: 19 }).solve();
  }
  const exactProviderDistances = {
    proxyVsEquity: strategyDistance(exactResults.proxy.strategy, exactResults.equity.strategy),
    proxyVsSolved: strategyDistance(exactResults.proxy.strategy, exactResults.solved.strategy),
    equityVsSolved: strategyDistance(exactResults.equity.strategy, exactResults.solved.strategy),
  };

  progress("exact reproducibility, seed provenance, order invariance and warm resume");
  const exactSeedRuns = seeds.map((seed) => new ExactHoldemPreflopSolver(phase6ReferencePreflop, phase6ReferenceRanges, providers.solved, { ...exactSolve, provenanceSeed: seed }).solve());
  const exactSeedNoise = withinProviderSeedNoise(exactSeedRuns.map((run) => run.strategy));
  const reversedRanges = phase6ReferenceRanges.map((range) => new WeightedRange([...range.entries()].reverse())) as [WeightedRange, WeightedRange];
  const reversedExact = new ExactHoldemPreflopSolver(phase6ReferencePreflop, reversedRanges, providers.solved, { ...exactSolve, provenanceSeed: 19 }).solve();
  const warmCheckpoint = new ExactHoldemPreflopSolver(phase6ReferencePreflop, phase6ReferenceRanges, providers.solved, { ...exactSolve, iterations: 1_000, metricInterval: 1_000 }).solve();
  const warmStarted = performance.now();
  const warmResumed = new ExactHoldemPreflopSolver(phase6ReferencePreflop, phase6ReferenceRanges, providers.solved, exactSolve).solve(warmCheckpoint.checkpoint);
  const warmRuntimeMs = performance.now() - warmStarted;
  const coldStarted = performance.now();
  const coldRepeated = new ExactHoldemPreflopSolver(phase6ReferencePreflop, phase6ReferenceRanges, providers.solved, exactSolve).solve();
  const coldRuntimeMs = performance.now() - coldStarted;
  const reproducibility = {
    repeatedExactDistance: strategyDistance(exactSeedRuns[0].strategy, exactSeedRuns.at(-1)!.strategy),
    orderInvariantDistance: strategyDistance(exactResults.solved.strategy, reversedExact.strategy),
    uniqueSeedStrategyHashes: new Set(exactSeedRuns.map((run) => hashValue(run.strategy))).size,
    seedNoise: exactSeedNoise,
    runtimeMs: descriptiveStatistics(exactSeedRuns.map((run) => run.runtimeMs)),
    warmStart: {
      continuousStrategyHash: hashValue(coldRepeated.strategy),
      resumedStrategyHash: hashValue(warmResumed.strategy),
      distance: strategyDistance(coldRepeated.strategy, warmResumed.strategy),
      coldRuntimeMs,
      warmRuntimeMs,
      safeOnlyWhenGameAndProviderIdentityMatch: true,
      rejectedAcrossOuterIterations: "Continuation provider identity changes, so regret warm-start would introduce path dependence.",
    },
  };

  progress("building the same-algorithm exact oracle for sampled convergence");
  const sampledOracle = new ExactHoldemPreflopSolver(phase6ReferencePreflop, phase6ReferenceRanges, providers.solved, { algorithm: "vanilla-cfr", iterations: 10_000, metricInterval: 10_000, provenanceSeed: 19 }).solve();
  const sampledEvaluator = new HoldemPreflopStrategyEvaluator(new HoldemPreflopEvaluationGame(phase6ReferencePreflop, phase6ReferenceRanges, providers.solved, [...phase6ReferenceFlop]));
  const seedMatrix: Record<string, Array<Record<string, unknown>>> = {};
  for (const mode of sampleModes) {
    seedMatrix[mode] = [];
    for (const seed of seeds) {
      progress(`sample seed matrix ${mode} seed=${seed}`);
      const runStarted = performance.now();
      const solve = new HoldemPreflopV2Solver({ ...phase6ReferencePreflop, seed, iterations: 5_000, metricInterval: 5_000, chanceSampling: { mode, masterSeed: seed } }, providers.solved, phase6ReferenceRanges).solve();
      seedMatrix[mode].push({ seed, ...sampledSummary(solve.strategy, sampledOracle.strategy, sampledEvaluator.evaluate(solve.strategy), solve.sampling, performance.now() - runStarted) });
    }
  }
  const seedMatrixStatistics = Object.fromEntries(Object.entries(seedMatrix).map(([mode, runs]) => {
    const distances = runs.map((run) => Number((run.distanceToExact as { weightedMeanAbsoluteDelta: number }).weightedMeanAbsoluteDelta));
    return [mode, {
      uniqueStrategyHashes: new Set(runs.map((run) => run.strategyHash)).size,
      distanceToExact: descriptiveStatistics(distances),
      runtimeMs: descriptiveStatistics(runs.map((run) => Number(run.runtimeMs))),
    }];
  }));

  const sampleEfficiency: Record<string, Array<Record<string, unknown>>> = {};
  for (const mode of sampleModes) {
    sampleEfficiency[mode] = [];
    for (const budget of sampleBudgets) {
      const existing = budget === 5_000 ? seedMatrix[mode].find((run) => run.seed === 19) : undefined;
      if (existing) {
        sampleEfficiency[mode].push({ budget, ...existing });
        continue;
      }
      progress(`sample efficiency ${mode} budget=${budget}`);
      const runStarted = performance.now();
      const solve = new HoldemPreflopV2Solver({ ...phase6ReferencePreflop, seed: 19, iterations: budget, metricInterval: budget, chanceSampling: { mode, masterSeed: 19 } }, providers.solved, phase6ReferenceRanges).solve();
      sampleEfficiency[mode].push({ budget, ...sampledSummary(solve.strategy, sampledOracle.strategy, sampledEvaluator.evaluate(solve.strategy), solve.sampling, performance.now() - runStarted) });
    }
  }
  const sampledWinner = Object.entries(seedMatrixStatistics).sort(([, left], [, right]) => (
    Number((left as { distanceToExact: { mean: number } }).distanceToExact.mean) - Number((right as { distanceToExact: { mean: number } }).distanceToExact.mean)
  ))[0][0];
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
  const targetAudit = targets.map((target) => {
    const key = target.player === 0 ? `SB|${target.combo.id}|root` : `BB|${target.combo.id}|SB:raise:2`;
    return {
      label: target.label,
      comboId: target.combo.id,
      action: target.action,
      exact: {
        proxy: actionFrequency(exactResults.proxy.strategy, target.player, target.combo.id, target.action),
        equity: actionFrequency(exactResults.equity.strategy, target.player, target.combo.id, target.action),
        solved: actionFrequency(exactResults.solved.strategy, target.player, target.combo.id, target.action),
      },
      phase6: phase6.seedAndProviderStudy.shiftAudit.find((entry) => entry.label === target.label) ?? null,
      actionEv: exactResults.solved.actionEvs.find((entry) => entry.informationSet === key) ?? null,
    };
  });

  progress("auditing deterministic board buckets over every frozen private deal");
  const deck = createHoldemDeck();
  const deals = privateDealDistribution(phase6ReferenceRanges[0], phase6ReferenceRanges[1], [...phase6ReferenceFlop]);
  const bucketRows = deals.map((deal) => {
    const blocked = new Set([...phase6ReferenceFlop.map((card) => card.id), deal.playerZero.first.id, deal.playerZero.second.id, deal.playerOne.first.id, deal.playerOne.second.id]);
    const available = deck.filter((card) => !blocked.has(card.id));
    const turn = phase6ReferenceBoardProvider.outcomes(available);
    const reverseTurn = phase6ReferenceBoardProvider.outcomes([...available].reverse());
    const riverStable = turn.every((turnOutcome) => {
      const riverAvailable = available.filter((card) => card.id !== turnOutcome.card.id);
      return hashValue(phase6ReferenceBoardProvider.outcomes(riverAvailable)) === hashValue(phase6ReferenceBoardProvider.outcomes([...riverAvailable].reverse()));
    });
    return {
      pairKey: `${deal.playerZero.id}|${deal.playerOne.id}`,
      turnRepresentatives: turn.map((outcome) => outcome.card.notation),
      turnStable: hashValue(turn) === hashValue(reverseTurn),
      riverStable,
    };
  });
  const bucketAudit = {
    identity: phase6ReferenceBoardProvider.metadata(),
    mappingRule: "Sort available physical cards by card.id, distribute round-robin, select the middle card of each bucket.",
    dealsAudited: bucketRows.length,
    stableUnderReversePermutation: bucketRows.every((row) => row.turnStable && row.riverStable),
    uniqueTurnRepresentativePairs: new Set(bucketRows.map((row) => row.turnRepresentatives.join("|"))).size,
    rows: bucketRows,
  };

  progress("measuring range-to-continuation finite-difference sensitivity");
  const baseWeights = phase6ReferenceRanges[0].entries().map((entry) => entry.weight);
  const sensitivitySolve = { ...postflopSolve, iterations: 250, metricInterval: 250 };
  const sensitivity = finiteDifferenceSensitivity(baseWeights, (weights) => {
    const perturbed: [WeightedRange, WeightedRange] = [
      new WeightedRange(phase6ReferenceRanges[0].entries().map((entry, index) => ({ combo: entry.combo, weight: weights[index] }))),
      phase6ReferenceRanges[1],
    ];
    const artifact = solveRangePostflopSubgame(phase6ReferencePostflopDefinition(perturbed), sensitivitySolve);
    return [...artifact.pairUtilities].sort((left, right) => left.pairKey.localeCompare(right.pairKey)).map((entry) => entry.utilities[0]);
  }, baseWeights.length - 1);
  const exactFutureCardAblation = {
    executed: false,
    reason: "The frozen strategic tree would exceed the Phase 6.5 single-process resource cap; execution would change the risk profile rather than only the experiment.",
    projectedNodes: Math.round(11_179 * (45 / 2) * (44 / 2)),
    resourceCapNodes: 2_000_000,
    status: "blocked-by-predeclared-resource-safety",
  };

  progress("screening deterministic damping grid at 10 outer iterations");
  const screening: Record<string, ReturnType<typeof summarizeCoupling>> = {};
  const screeningRaw = new Map<number, ReturnType<DeterministicCoupledPreflopPostflopSolver["solve"]>>();
  for (const alpha of [0.05, 0.1, 0.15, 0.2, 0.25, 0.4]) {
    progress(`coupling screen alpha=${alpha}`);
    const result = new DeterministicCoupledPreflopPostflopSolver(
      couplingConfiguration(alpha, 250, 20, 500),
      new MemoProvider(new EquityProvider(new EquityEngine(), { exactThreshold: 2_000, seed: 17 })),
    ).solve(undefined, 10);
    screening[String(alpha)] = summarizeCoupling(result);
    screeningRaw.set(alpha, result);
  }
  const bestAlpha = [...screeningRaw].sort(([, left], [, right]) => couplingScore(left.outerMetrics.at(-1)!) - couplingScore(right.outerMetrics.at(-1)!))[0][0];

  progress(`confirming alpha=${bestAlpha} with 1,000 inner iterations to outer budget 25`);
  const confirmConfiguration = couplingConfiguration(bestAlpha, 1_000, 100, 1_000);
  const confirmSolver = () => new DeterministicCoupledPreflopPostflopSolver(confirmConfiguration, new MemoProvider(new EquityProvider(new EquityEngine(), { exactThreshold: 2_000, seed: 17 })));
  let confirmed = confirmSolver().solve(undefined, 25);
  const score25 = couplingScore(confirmed.outerMetrics.at(-1)!);
  if (!confirmed.converged) {
    progress(`alpha=${bestAlpha} did not converge by 25; extending deterministically to 50`);
    confirmed = confirmSolver().solve(confirmed.checkpoint, 50);
  }
  const score50 = couplingScore(confirmed.outerMetrics.at(-1)!);
  const cycleAt50 = confirmed.outerMetrics.at(-1)?.cycleDetected ?? false;
  if (!confirmed.converged && confirmed.outerMetrics.length >= 50 && score50 < score25 * 0.8 && !cycleAt50) {
    progress(`trajectory improved by >20%; extending alpha=${bestAlpha} to 100`);
    confirmed = confirmSolver().solve(confirmed.checkpoint, 100);
  }
  const confirmedSummary = summarizeCoupling(confirmed);

  progress("validating outer 10→20 checkpoint/resume against a continuous trajectory");
  const resumeConfiguration = couplingConfiguration(bestAlpha, 250, 20, 500);
  const newResumeSolver = () => new DeterministicCoupledPreflopPostflopSolver(resumeConfiguration, new MemoProvider(new EquityProvider(new EquityEngine(), { exactThreshold: 2_000, seed: 17 })));
  const splitFirst = screeningRaw.get(bestAlpha)!;
  const resumedOuter = newResumeSolver().solve(splitFirst.checkpoint, 20);
  const continuousOuter = newResumeSolver().solve();
  const stableMetrics = (metrics: typeof resumedOuter.outerMetrics) => metrics.map((metric) => ({ ...metric, runtimeMs: 0 }));
  const checkpointResume = {
    splitAt: 10,
    resumedTo: 20,
    continuousTo: 20,
    preflopStrategyDistance: strategyDistance(resumedOuter.preflop.strategy, continuousOuter.preflop.strategy),
    dampedValueHashEqual: hashValue(resumedOuter.checkpoint.previousDampedValues) === hashValue(continuousOuter.checkpoint.previousDampedValues),
    metricTrajectoryHashEqual: hashValue(stableMetrics(resumedOuter.outerMetrics)) === hashValue(stableMetrics(continuousOuter.outerMetrics)),
  };
  const officialSeedDistance = exactSeedNoise.statistics.mean;
  const separation = providerSeparationRatio(exactProviderDistances.equityVsSolved.weightedMeanAbsoluteDelta, officialSeedDistance);
  const exactSeparation = {
    ...separation,
    zeroNoiseLimit: officialSeedDistance === 0 && exactProviderDistances.equityVsSolved.weightedMeanAbsoluteDelta > 0 ? "infinite" : null,
    gatePassed: exactProviderDistances.equityVsSolved.weightedMeanAbsoluteDelta > officialSeedDistance,
  };
  const gates = {
    A: gateA.passed,
    B: officialSeedDistance < 0.1,
    B_tiers: {
      B0_0_10: officialSeedDistance < 0.1,
      B1_0_05: officialSeedDistance < 0.05,
      B2_0_02: officialSeedDistance < 0.02,
      B3_0_01: officialSeedDistance < 0.01,
      B4_0_005: officialSeedDistance < 0.005,
    },
    C: exactSeparation.gatePassed,
    D: confirmed.gateD.passed,
  };
  const releasePhase7 = gates.A && gates.B && gates.C && gates.D;

  const artifact = {
    schemaVersion: 1,
    phase: "6.5",
    solverVersion: SOLVER_VERSION,
    baselineCommit: BASELINE_COMMIT,
    implementationCommit: SOURCE_COMMIT,
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
      runtime: "TypeScript Float64 single-threaded",
    },
    referenceGame: { ...reference, independentlyRecordedHash: phase6ReferenceGameHash, id: PHASE6_REFERENCE_GAME_ID, frozen: true, expanded: false },
    phase6Baseline: {
      phase5: phase6.baselinePhase5,
      phase6Gates: phase6.stopGatePhase7,
      equityVsSolvedDistance: phase6.seedAndProviderStudy.providerDistances.equityVsSolved.weightedMeanAbsoluteDelta,
      providerSeparationRatio: phase6.seedAndProviderStudy.providerSeparationRatio.value,
    },
    randomness: {
      policy: "masterSeed plus subsystemId; every sampled schedule and equity runout has an isolated ledger stream.",
      sampledLedgerExample: (seedMatrix.iid[0].sampling as { randomnessLedger: unknown }).randomnessLedger,
      equityLedger: equityEngine.randomnessLedger(),
      looseMathRandomInSolver: 0,
    },
    exactPreflop: {
      configuration: exactSolve,
      providers: Object.fromEntries(Object.entries(exactResults).map(([name, result]) => [name, summarizeExact(result)])),
      providerDistances: exactProviderDistances,
      reproducibility,
      officialSolvedSeedDistance: officialSeedDistance,
      gateBThresholds: gates.B_tiers,
      actionEvTargets: targetAudit,
    },
    sampling: {
      oracle: summarizeExact(sampledOracle),
      modes: sampleModes,
      seeds,
      seedMatrix,
      seedMatrixStatistics,
      efficiencyCurves: sampleEfficiency,
      winner: sampledWinner,
      importanceWeighting: "target probability / proposal probability; IID/CRN proposal equals target, stratified/quasi proposal equals empirical allocation.",
    },
    providerComparison: {
      exactDistances: exactProviderDistances,
      separation: exactSeparation,
      phase6EquityVsSolvedDistance: phase6.seedAndProviderStudy.providerDistances.equityVsSolved.weightedMeanAbsoluteDelta,
      targetAudit,
    },
    bucketAudit,
    sensitivity: {
      rangeToContinuation: sensitivity,
      exactFutureCardAblation,
      representativeExpectationImplemented: false,
      representativeExpectationReason: "Changing representative payoff into a bucket expectation would change the frozen game and belongs to Phase 7 abstraction validation.",
    },
    coupling: {
      definition: "F(S): exact preflop strategy -> Bayesian conditional ranges -> solved postflop raw utilities -> damped continuation utilities -> exact preflop strategy.",
      rawAndDampedUtilitiesSeparated: true,
      screening,
      bestAlpha,
      confirmatory: confirmedSummary,
      checkpointResume,
      warmStartAcrossMap: "rejected",
    },
    cacheAndPerformance: {
      continuationArtifactCache: confirmed.cache,
      preflopExactRuntimeMs: reproducibility.runtimeMs,
      topologyReuse: "Compiled evaluators are reused within each exact solve; continuation-dependent terminal utilities prevent unsafe reuse across outer iterations.",
      rustDecision: "blocked: frozen 46-deal TypeScript solve is not the scaling bottleneck and no native migration gate was met.",
    },
    errorBudget: {
      finitePostflopCfrExploitability: gateA.exploitability,
      sampledPreflopDistance: seedMatrixStatistics,
      exactPreflopSeedVariance: exactSeedNoise.statistics,
      boardAbstraction: exactFutureCardAblation,
      rangeSensitivity: sensitivity,
      fixedPointResidual: confirmed.outerMetrics.at(-1),
      scalarTotalForbidden: true,
    },
    gates,
    releasePhase7,
    phase7Recommendation: releasePhase7 ? "Recommend Phase 7 Board Coverage & Abstraction Validation; do not implement it in Phase 6.5." : "Blocked until every A/B/C/D gate passes.",
    limitations: [
      "Reduced HU game with 46 private deals.",
      "One fixed flop and a deterministic two-representative future-board abstraction.",
      "One bet size per street and no raises or jams in the main game.",
      "No external solver validation or independent review.",
      "Exact future-card strategic ablation exceeded the declared single-process node cap.",
      "Verified remains zero.",
    ],
    totalRuntimeMs: performance.now() - phaseStarted,
  };
  const golden = {
    schemaVersion: 1,
    phase: "6.5",
    solverVersion: SOLVER_VERSION,
    referenceGameHash: phase6ReferenceGameHash,
    trust: "Experimental",
    verifiedDatasets: 0,
    exactOracle: {
      chanceOutcomes: exactResults.solved.chanceOutcomes,
      strategyHash: hashValue(exactResults.solved.strategy),
      evaluation: exactResults.solved.evaluation,
      repeatedDistance: reproducibility.repeatedExactDistance,
      orderInvariantDistance: reproducibility.orderInvariantDistance,
    },
    deterministicProviderComparison: exactProviderDistances,
    fixedSampleSchedule: {
      id: (seedMatrix["fixed-crn"][0].sampling as { scheduleId: string }).scheduleId,
      coverage: (seedMatrix["fixed-crn"][0].sampling as { coverage: unknown }).coverage,
      distanceToExact: seedMatrix["fixed-crn"][0].distanceToExact,
    },
    couplingTrajectory: confirmed.outerMetrics.map((metric) => ({ ...metric, runtimeMs: 0 })),
    gateMatrix: gates,
  };

  const manifest = await readJson<Record<string, unknown>>(resolve("solver/experiments/phase6-5-manifest.json"));
  const completedManifest = {
    ...manifest,
    implementationCommit: SOURCE_COMMIT,
    finishedAt: artifact.finishedAt,
    runs: [
      { id: "gate-a-revalidation", status: "completed", resultHash: hashValue(gateA) },
      { id: "exact-provider-comparison", status: "completed", resultHash: hashValue(exactProviderDistances) },
      { id: "sample-seed-matrix", status: "completed", resultHash: hashValue(seedMatrixStatistics) },
      { id: "sample-efficiency-curves", status: "completed", resultHash: hashValue(sampleEfficiency) },
      { id: "bucket-stability", status: "completed", resultHash: hashValue(bucketAudit) },
      { id: "range-sensitivity", status: "completed", resultHash: hashValue(sensitivity) },
      { id: "exact-future-card-ablation", status: "blocked", failure: exactFutureCardAblation.reason },
      { id: "coupling-damping-screen", status: "completed", resultHash: hashValue(screening) },
      { id: "coupling-confirmatory", status: confirmed.converged ? "completed" : "failed-gate", resultHash: hashValue(confirmedSummary) },
      { id: "outer-checkpoint-resume", status: "completed", resultHash: hashValue(checkpointResume) },
    ],
    finalGates: gates,
    releasePhase7,
  };

  await writeJson(resolve("solver/artifacts/phase6-5-deterministic-fixed-point-v0.5.0.json"), artifact);
  await writeJson(resolve("tests/golden/phase6-5-v0.5.0.json"), golden);
  await writeJson(resolve("solver/experiments/phase6-5-manifest.json"), completedManifest);
  process.stdout.write(JSON.stringify({
    sourceCommit: SOURCE_COMMIT,
    reference,
    gateA,
    exactRuntime: reproducibility.runtimeMs,
    solvedSeedDistance: officialSeedDistance,
    exactProviderDistances,
    separation: exactSeparation,
    sampledWinner,
    sampleSeedStatistics: seedMatrixStatistics,
    bucketStable: bucketAudit.stableUnderReversePermutation,
    sensitivity: { slopeVariation: sensitivity.slopeVariation, possibleDiscontinuity: sensitivity.possibleDiscontinuity },
    coupling: {
      bestAlpha,
      confirmedIterations: confirmed.outerMetrics.length,
      converged: confirmed.converged,
      final: confirmed.outerMetrics.at(-1),
      checkpointResume,
    },
    gates,
    releasePhase7,
    totalRuntimeMs: artifact.totalRuntimeMs,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});