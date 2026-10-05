import { execFileSync } from "node:child_process";
import { cpus, platform, totalmem } from "node:os";
import { resolve } from "node:path";
import { privateDealDistribution } from "../cards/private-chance.ts";
import { EquityEngine } from "../cards/equity.ts";
import { WeightedRange } from "../cards/range.ts";
import { deterministicPerturbationDirections, localResponseRatio, normalizeDistribution, perturbDistribution, sensitivityMetrics, summarizeRatios, vectorNorms } from "../analysis/phase6-6.ts";
import { auditRangeTransformation } from "../analysis/range-pipeline.ts";
import { strategyDistance } from "../comparison/strategy-distance.ts";
import { EquityProvider } from "../continuation/engine.ts";
import { CoupledFixedPointSolverV2, FixedPointPairContinuationProvider } from "../coupling/fixed-point-v2.ts";
import { hashValue } from "../core/stable.ts";
import { SOLVER_VERSION } from "../core/version.ts";
import { assertPhase6ReferenceGame, phase6ReferenceActionHistory, phase6ReferenceBoardProvider, phase6ReferenceFlop, phase6ReferenceGameHash, phase6ReferencePostflopAbstraction, phase6ReferencePostflopDefinition, phase6ReferencePreflop, phase6ReferenceRanges } from "../experiments/phase6-reference.ts";
import { ExactHoldemPreflopSolver } from "../game/holdem-preflop-exact.ts";
import { BucketedBoardProvider, ExactBoardEnumerationProvider, ExpectedBucketBoardProvider, RangePostflopHoldemSubgame, solveRangePostflopSubgame, solveRangePostflopToQuality } from "../game/range-postflop-subgame.ts";
import { readJson, writeJson } from "../storage/files.ts";

const SOURCE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const BASELINE_COMMIT = "ef0b0b06971d86a06446cecff93d036fe34873f9";
const ARTIFACT = resolve("solver/artifacts/phase6-6-continuation-operator-v0.6.0.json");
const GOLDEN = resolve("tests/golden/phase6-6-v0.6.0.json");
const startedAt = new Date().toISOString();
const started = performance.now();
const dcfr = { alpha: 2, beta: 0, gamma: 3 };
const solveConfiguration = (iterations) => ({ algorithm: "dcfr", iterations, metricInterval: iterations, seed: 19, exactMetrics: true, engine: "indexed-tree", dcfr });
const progress = (message) => process.stdout.write(`[phase6.6] ${message}\n`);

function mapUtilities(artifact) {
  return new Map(artifact.pairUtilities.map((entry) => [entry.pairKey, entry.utilities]));
}

function alignedUtilities(baseline, perturbation) {
  const left = mapUtilities(baseline);
  const right = mapUtilities(perturbation);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return { keys, baseline: keys.map((key) => left.get(key)?.[0] ?? 0), perturbation: keys.map((key) => right.get(key)?.[0] ?? 0) };
}

function reachForKeys(ranges, keys) {
  const byKey = new Map(privateDealDistribution(ranges[0], ranges[1], phase6ReferenceFlop).map((deal) => [deal.playerZero.id + "|" + deal.playerOne.id, deal.probability]));
  return keys.map((key) => byKey.get(key) ?? 0);
}

function weightedRangeFromProbabilities(range, probabilities) {
  return new WeightedRange(range.entries().map((entry, index) => ({ combo: entry.combo, weight: probabilities[index] })));
}

function perturbPlayerZero(direction, epsilon, ranges = phase6ReferenceRanges) {
  const perturbation = perturbDistribution(ranges[0].entries().map((entry) => entry.weight), direction, epsilon);
  return { perturbation, ranges: [weightedRangeFromProbabilities(ranges[0], perturbation.perturbed), ranges[1]] };
}

function sensitivityPoint(baseline, perturbed, epsilon, ranges) {
  const aligned = alignedUtilities(baseline, perturbed);
  return {
    ...sensitivityMetrics(aligned.baseline, aligned.perturbation, epsilon, reachForKeys(ranges, aligned.keys)),
    postflopStrategyDistance: strategyDistance(baseline.strategy, perturbed.strategy),
    baselineQuality: { exploitability: baseline.convergence.exploitability, nashConv: baseline.convergence.nashConv },
    perturbedQuality: { exploitability: perturbed.convergence.exploitability, nashConv: perturbed.convergence.nashConv },
    hashes: {
      baselineStrategy: hashValue(baseline.strategy), perturbedStrategy: hashValue(perturbed.strategy),
      baselineUtilities: hashValue(baseline.pairUtilities), perturbedUtilities: hashValue(perturbed.pairUtilities),
      baselineRanges: baseline.rangeHashes, perturbedRanges: perturbed.rangeHashes, abstraction: hashValue(baseline.chanceAbstraction),
    },
  };
}

function couplingConfiguration(provider, ranges, alpha, outerIterations, method = "plain-damping", solve = solveConfiguration(5_000)) {
  return {
    preflop: { ...phase6ReferencePreflop, iterations: 5_000, metricInterval: 5_000 },
    exactPreflop: { algorithm: "dcfr", iterations: 5_000, metricInterval: 5_000, dcfr },
    ranges, actionHistory: phase6ReferenceActionHistory, flop: phase6ReferenceFlop,
    postflopAbstraction: phase6ReferencePostflopAbstraction, boardProvider: provider, postflopSolve: solve,
    innerQuality: { exploitabilityThreshold: 0.02, reachWeightedMovementThreshold: 0.02, checkpoints: [250, 500, 1_000, 2_500, 5_000], maximumIterations: 5_000 },
    outerIterations, dampingAlpha: alpha, method,
    adaptiveDamping: { minimum: 0.01, maximum: 0.25, shrink: 0.5, grow: 1.2 },
    anderson: { history: 3, regularization: 1e-8, safeguardFactor: 1.25 },
    gateD: { preflopReachWeightedDelta: 0.02, conditionalRangeL1: 0.02, normalizedRawContinuationResidual: 0.02, dampedContinuationDelta: 0.02, postflopReachWeightedDelta: 0.02, localResponseRatio: 1, patience: 3 },
  };
}

function summarizeCoupling(result) {
  return {
    id: result.id, boardContinuationModel: result.boardContinuationModel, initializationId: result.initializationId,
    method: result.method, converged: result.converged, stopReason: result.stopReason, gateD: result.gateD,
    metrics: result.metrics, checkpoint: result.checkpoint,
    finalPreflopStrategyHash: result.finalPreflop ? hashValue(result.finalPreflop.strategy) : null,
    finalRangeHashes: result.finalConditionalRanges?.map((snapshot) => hashValue(snapshot.comboWeights)) ?? null,
    postflopArtifacts: result.postflopArtifacts.map((item) => ({ id: item.id, convergence: item.convergence, boardContinuationModel: item.boardContinuationModel, strategyHash: hashValue(item.strategy), runtime: item.runtime })),
  };
}

function phase65Values(artifact) {
  const last = artifact.coupling.confirmatory.continuationValueHistory.at(-1).damped;
  return new Map(last.map((entry) => [entry.pairKey, [entry.utilityP0, -entry.utilityP0]]));
}

function equityValues(ranges) {
  const provider = new EquityProvider(new EquityEngine(), { exactThreshold: 2_000, seed: 17 });
  const values = new Map();
  for (const deal of privateDealDistribution(ranges[0], ranges[1], phase6ReferenceFlop)) {
    const utilities = provider.evaluate({
      state: { street: "flop", board: phase6ReferenceFlop, pot: 4, stacks: [8, 8], contributions: [2, 2], actingPlayer: 1, inPositionPlayer: 0, actionHistory: phase6ReferenceActionHistory },
      ranges: { playerZero: ranges[0], playerOne: ranges[1], fixedCombos: [deal.playerZero, deal.playerOne] },
      context: { abstractionId: "phase6-6-equity-initialization" },
    }).utilities;
    values.set(deal.playerZero.id + "|" + deal.playerOne.id, utilities);
  }
  return values;
}

function zeroValues(ranges) {
  return new Map(privateDealDistribution(ranges[0], ranges[1], phase6ReferenceFlop).map((deal) => [deal.playerZero.id + "|" + deal.playerOne.id, [0, 0]]));
}

function finalDistance(left, right) {
  const leftState = new Map(left.checkpoint.stateValues);
  const rightState = new Map(right.checkpoint.stateValues);
  const keys = [...leftState.keys()].sort();
  return {
    continuationL2: vectorNorms(keys.map((key) => (leftState.get(key)?.[0] ?? 0) - (rightState.get(key)?.[0] ?? 0))).l2,
    preflopStrategy: left.finalPreflop && right.finalPreflop ? strategyDistance(left.finalPreflop.strategy, right.finalPreflop.strategy) : null,
    rangeL1: left.finalConditionalRanges && right.finalConditionalRanges ? Math.max(...left.finalConditionalRanges.map((snapshot, player) => {
      const byId = new Map(right.finalConditionalRanges[player].comboWeights.map((entry) => [entry.comboId, entry.weight]));
      return snapshot.comboWeights.reduce((sum, entry) => sum + Math.abs(entry.weight - (byId.get(entry.comboId) ?? 0)), 0);
    })) : null,
  };
}

async function main() {
  const manifest = await readJson(resolve("solver/experiments/phase6-6-manifest.json"));
  const phase65 = await readJson(resolve("solver/artifacts/phase6-5-deterministic-fixed-point-v0.5.0.json"));
  const reference = assertPhase6ReferenceGame();
  progress(`source ${SOURCE_COMMIT.slice(0, 8)}, reference ${reference.hash}`);

  progress("revalidating Gate A/B/C");
  const gateAPostflop = solveRangePostflopSubgame(phase6ReferencePostflopDefinition(), solveConfiguration(5_000));
  const solvedValues = mapUtilities(gateAPostflop);
  const solvedProvider = new FixedPointPairContinuationProvider(solvedValues, "representative-bucket");
  const exactSolvedA = new ExactHoldemPreflopSolver(phase6ReferencePreflop, phase6ReferenceRanges, solvedProvider, { algorithm: "dcfr", iterations: 5_000, metricInterval: 5_000, dcfr, provenanceSeed: 1 }, phase6ReferenceFlop).solve();
  const exactSolvedB = new ExactHoldemPreflopSolver(phase6ReferencePreflop, phase6ReferenceRanges, solvedProvider, { algorithm: "dcfr", iterations: 5_000, metricInterval: 5_000, dcfr, provenanceSeed: 99 }, phase6ReferenceFlop).solve();
  const equityInitial = equityValues(phase6ReferenceRanges);
  const exactEquity = new ExactHoldemPreflopSolver(phase6ReferencePreflop, phase6ReferenceRanges, new FixedPointPairContinuationProvider(equityInitial, "representative-bucket"), { algorithm: "dcfr", iterations: 5_000, metricInterval: 5_000, dcfr, provenanceSeed: 19 }, phase6ReferenceFlop).solve();
  const seedDistance = strategyDistance(exactSolvedA.strategy, exactSolvedB.strategy);
  const equitySolvedDistance = strategyDistance(exactEquity.strategy, exactSolvedA.strategy);
  const gatesABC = {
    A: { exploitability: gateAPostflop.convergence.exploitability, threshold: 0.02, passed: gateAPostflop.convergence.exploitability < 0.02 },
    B: { seedDistance, threshold: 0.005, passed: seedDistance.weightedMeanAbsoluteDelta === 0 },
    C: { equityVsSolvedDistance: equitySolvedDistance, seedNoise: 0, passed: equitySolvedDistance.weightedMeanAbsoluteDelta > 0.005 },
  };

  const budgets = manifest.finiteSolve.iterationBudgets;
  const epsilons = manifest.finiteSolve.epsilons;
  const lastDirection = deterministicPerturbationDirections(phase6ReferenceRanges[0].entries().length)[0];
  const sensitivityMatrix = [];
  for (const iterations of budgets) {
    progress(`finite sensitivity iterations=${iterations}`);
    const baseline = solveRangePostflopSubgame(phase6ReferencePostflopDefinition(), solveConfiguration(iterations));
    for (const requestedEpsilon of epsilons) {
      const { perturbation, ranges } = perturbPlayerZero(lastDirection, requestedEpsilon);
      const perturbed = solveRangePostflopSubgame(phase6ReferencePostflopDefinition(ranges), solveConfiguration(iterations));
      sensitivityMatrix.push({ mode: "fixed-iterations", iterations, requestedEpsilon, appliedEpsilon: perturbation.appliedEpsilon, ...sensitivityPoint(baseline, perturbed, perturbation.appliedEpsilon, phase6ReferenceRanges) });
    }
  }

  progress("fixed-quality sensitivity");
  const fixedQuality = [];
  for (const target of manifest.finiteSolve.qualityTargets) {
    const gate = { exploitabilityThreshold: target, reachWeightedMovementThreshold: 0.02, checkpoints: [250, 500, 1_000, 2_500, 5_000, 10_000], maximumIterations: 10_000 };
    const { perturbation, ranges } = perturbPlayerZero(lastDirection, 0.001);
    const baseline = solveRangePostflopToQuality(phase6ReferencePostflopDefinition(), solveConfiguration(10_000), gate);
    const perturbed = solveRangePostflopToQuality(phase6ReferencePostflopDefinition(ranges), solveConfiguration(10_000), gate);
    fixedQuality.push({ target, baselineGate: baseline.innerQuality, perturbedGate: perturbed.innerQuality, sensitivity: sensitivityPoint(baseline, perturbed, perturbation.appliedEpsilon, phase6ReferenceRanges) });
  }

  progress("range/posterior audit and deterministic directions");
  const conditionalInput = { configuration: phase6ReferencePreflop, ranges: phase6ReferenceRanges, strategy: exactSolvedA.strategy, actionHistory: phase6ReferenceActionHistory, board: phase6ReferenceFlop, sourceSolveId: exactSolvedA.id };
  const baselineProbabilities = normalizeDistribution(phase6ReferenceRanges[0].entries().map((entry) => entry.weight));
  const phase65ById = new Map(phase65.coupling.confirmatory.finalConditionalRanges[0].comboWeights.map((entry) => [entry.comboId, entry.weight]));
  const couplingAligned = phase6ReferenceRanges[0].entries().map((entry, index) => (phase65ById.get(entry.combo.id) ?? 0) - baselineProbabilities[index]);
  const directions = deterministicPerturbationDirections(phase6ReferenceRanges[0].entries().length, couplingAligned, 19);
  const perturbationStudy = [];
  const directionBaseline = solveRangePostflopSubgame(phase6ReferencePostflopDefinition(), solveConfiguration(1_000));
  for (const direction of directions) {
    const { perturbation, ranges } = perturbPlayerZero(direction, 0.01);
    const transformed = auditRangeTransformation(conditionalInput, ranges, perturbation.appliedEpsilon);
    const response = solveRangePostflopSubgame(phase6ReferencePostflopDefinition(ranges), solveConfiguration(1_000));
    const sensitivity = sensitivityPoint(directionBaseline, response, perturbation.appliedEpsilon, phase6ReferenceRanges);
    const aligned = alignedUtilities(directionBaseline, response);
    perturbationStudy.push({
      direction: { id: direction.id, label: direction.label, source: direction.source }, requestedEpsilon: 0.01, appliedEpsilon: perturbation.appliedEpsilon,
      transformation: transformed, sensitivity,
      localResponse: localResponseRatio(perturbation.baseline, perturbation.perturbed, aligned.baseline, aligned.perturbation),
    });
  }
  const worstDirection = [...perturbationStudy].sort((a, b) => b.sensitivity.weightedDerivative - a.sensitivity.weightedDerivative)[0];

  progress("R/E/X exact-future microgame");
  const microRanges = phase6ReferenceRanges.map((range) => new WeightedRange(range.entries().slice(0, 2)));
  const microAbstraction = { flopBetFractions: [], turnBetFractions: [], riverBetFractions: [1], raisePotFractions: [], maxRaisesPerStreet: 0, jamAllowed: false };
  const providers = { R: new BucketedBoardProvider(2), E: new ExpectedBucketBoardProvider(2), X: new ExactBoardEnumerationProvider() };
  const microDefinition = (provider, ranges = microRanges) => ({ ...phase6ReferencePostflopDefinition(ranges), id: "phase6-6-micro-" + provider.boardContinuationModel, ranges, abstraction: microAbstraction, boardProvider: provider });
  const micro = {};
  const microArtifacts = {};
  for (const [label, provider] of Object.entries(providers)) {
    const definition = microDefinition(provider);
    const tree = new RangePostflopHoldemSubgame(definition).estimateTree();
    const solve = solveRangePostflopSubgame(definition, solveConfiguration(250));
    const direction = deterministicPerturbationDirections(3)[0].vector.slice(0, 2);
    const perturbation = perturbDistribution(microRanges[0].entries().map((entry) => entry.weight), direction, 0.01);
    const changedRanges = [weightedRangeFromProbabilities(microRanges[0], perturbation.perturbed), microRanges[1]];
    const changed = solveRangePostflopSubgame(microDefinition(provider, changedRanges), solveConfiguration(250));
    microArtifacts[label] = { solve, changed };
    micro[label] = {
      tree,
      solve: { boardContinuationModel: solve.boardContinuationModel, convergence: solve.convergence, strategyHash: hashValue(solve.strategy), utilityHash: hashValue(solve.pairUtilities), utilities: solve.utilities, pairUtilities: solve.pairUtilities, runtime: solve.runtime },
      perturbed: { convergence: changed.convergence, strategyHash: hashValue(changed.strategy), utilityHash: hashValue(changed.pairUtilities) },
      sensitivity: sensitivityPoint(solve, changed, perturbation.appliedEpsilon, microRanges),
    };
  }
  const modelComparison = {};
  for (const label of ["R", "E"]) {
    const left = microArtifacts[label].solve;
    const exact = microArtifacts.X.solve;
    const leftUtilities = new Map(left.pairUtilities.map((entry) => [entry.pairKey, entry.utilities[0]]));
    const exactUtilities = new Map(exact.pairUtilities.map((entry) => [entry.pairKey, entry.utilities[0]]));
    const keys = [...new Set([...leftUtilities.keys(), ...exactUtilities.keys()])];
    modelComparison[label + "VsX"] = {
      strategyDistance: strategyDistance(left.strategy, exact.strategy),
      aggregateUtilityError: vectorNorms(left.utilities.map((value, index) => value - exact.utilities[index])),
      pairUtilityError: vectorNorms(keys.map((key) => (leftUtilities.get(key) ?? 0) - (exactUtilities.get(key) ?? 0))),
      exploitabilityDelta: Math.abs((left.convergence.exploitability ?? 0) - (exact.convergence.exploitability ?? 0)),
      sensitivityDelta: Math.abs(micro[label].sensitivity.weightedDerivative - micro.X.sensitivity.weightedDerivative),
    };
  }

  progress("C-R damping screening");
  const screening = [];
  for (const alpha of manifest.couplingV2.dampingAlphas) {
    progress(`C-R alpha=${alpha}`);
    const result = new CoupledFixedPointSolverV2(couplingConfiguration(phase6ReferenceBoardProvider, phase6ReferenceRanges, alpha, 10), equityInitial, "equity").solve();
    screening.push(summarizeCoupling(result));
  }
  const scored = [...screening].sort((left, right) => (left.metrics.at(-1)?.rawContinuationResidual.normalizedL2 ?? Infinity) - (right.metrics.at(-1)?.rawContinuationResidual.normalizedL2 ?? Infinity));
  const bestAlpha = scored[0].metrics.at(-1)?.alpha ?? 0.05;

  progress("confirmatory C-R with checkpointed early stopping");
  const confirmatory = [];
  let resume = null;
  for (const budget of [25, 50, 100, 200]) {
    const solver = new CoupledFixedPointSolverV2(couplingConfiguration(phase6ReferenceBoardProvider, phase6ReferenceRanges, bestAlpha, 200), equityInitial, "equity");
    const result = solver.solve(resume, budget);
    confirmatory.push({ requestedBudget: budget, ...summarizeCoupling(result) });
    resume = result.checkpoint;
    const recent = result.metrics.slice(-10).map((metric) => metric.rawContinuationResidual.normalizedL2);
    const noMaterialImprovement = recent.length === 10 && Math.min(...recent) > recent[0] * 0.98 && result.metrics.at(-1)?.localResponseRatio > 1;
    if (result.converged || result.stopReason === "inner-quality-failed" || noMaterialImprovement) {
      confirmatory.push({ requestedBudget: "early-stop", reason: result.converged ? "converged" : result.stopReason === "inner-quality-failed" ? "inner-quality-failed" : "raw residual did not improve by 2% over ten iterations while LocalResponseRatio exceeded one", skippedBudgets: [25, 50, 100, 200].filter((item) => item > budget) });
      break;
    }
  }

  progress("plain/adaptive/Anderson comparison");
  const methodComparison = [];
  for (const method of ["plain-damping", "adaptive-damping", "safeguarded-anderson"]) {
    const result = new CoupledFixedPointSolverV2(couplingConfiguration(phase6ReferenceBoardProvider, phase6ReferenceRanges, bestAlpha, 25, method), equityInitial, "equity").solve();
    methodComparison.push(summarizeCoupling(result));
  }

  progress("multiple initializations");
  const initializations = { equity: equityInitial, "neutral-zero": zeroValues(phase6ReferenceRanges), "phase6-5": phase65Values(phase65), "frozen-range-solved": solvedValues };
  const initializationRuns = [];
  for (const [id, values] of Object.entries(initializations)) {
    const result = new CoupledFixedPointSolverV2(couplingConfiguration(phase6ReferenceBoardProvider, phase6ReferenceRanges, bestAlpha, 25), values, id).solve();
    initializationRuns.push({ raw: result, summary: summarizeCoupling(result) });
  }
  const basinDistances = [];
  for (let left = 0; left < initializationRuns.length; left += 1) {
    for (let right = left + 1; right < initializationRuns.length; right += 1) {
      basinDistances.push({ left: initializationRuns[left].summary.initializationId, right: initializationRuns[right].summary.initializationId, ...finalDistance(initializationRuns[left].raw, initializationRuns[right].raw) });
    }
  }

  progress("microgame C-R/C-E/C-X");
  const microInitial = equityValues(microRanges);
  const microCoupling = {};
  for (const [label, provider] of Object.entries(providers)) {
    const configuration = {
      ...couplingConfiguration(provider, microRanges, bestAlpha, 25, "plain-damping", solveConfiguration(250)),
      postflopAbstraction: microAbstraction,
      preflop: { ...phase6ReferencePreflop, iterations: 1_000, metricInterval: 1_000 },
      exactPreflop: { algorithm: "dcfr", iterations: 1_000, metricInterval: 1_000, dcfr },
      innerQuality: { exploitabilityThreshold: 0.1, reachWeightedMovementThreshold: 0.05, checkpoints: [50, 100, 250], maximumIterations: 250 },
    };
    const result = new CoupledFixedPointSolverV2(configuration, microInitial, "equity-micro").solve();
    microCoupling[label] = summarizeCoupling(result);
  }
  const fullExpectedEstimate = { nodes: phase65.sensitivity.exactFutureCardAblation.projectedNodes, source: "Phase 6.5 frozen-topology projection" };
  const fullExpected = { status: "blocked-by-predeclared-node-cap", estimatedNodes: fullExpectedEstimate.nodes, cap: manifest.resourceCaps.maximumMaterializedNodes, implication: "The 5.5M scale is a materialization/topology cost, not proof that exact enumeration is mathematically impossible. Streaming/lazy traversal requires profiling before Phase 7." };

  progress("checkpoint/resume reproduction");
  const checkpointConfiguration = couplingConfiguration(phase6ReferenceBoardProvider, phase6ReferenceRanges, bestAlpha, 4);
  const checkpointSolver = new CoupledFixedPointSolverV2(checkpointConfiguration, equityInitial, "equity");
  const uninterrupted = checkpointSolver.solve();
  const partial = checkpointSolver.solve(undefined, 2);
  const resumed = new CoupledFixedPointSolverV2(checkpointConfiguration, equityInitial, "equity").solve(partial.checkpoint, 4);
const semanticCheckpoint = (checkpoint) => ({
    ...checkpoint,
    metrics: checkpoint.metrics.map((metric) => Object.fromEntries(Object.entries(metric).filter(([key]) => key !== "runtimeMs"))),
  });
  const uninterruptedSemanticHash = hashValue(semanticCheckpoint(uninterrupted.checkpoint));
  const resumedSemanticHash = hashValue(semanticCheckpoint(resumed.checkpoint));
  const checkpointResume = {
    uninterruptedRawHash: hashValue(uninterrupted.checkpoint), resumedRawHash: hashValue(resumed.checkpoint),
    uninterruptedSemanticHash, resumedSemanticHash, identical: uninterruptedSemanticHash === resumedSemanticHash,
    excludedNondeterministicFields: ["metrics[].runtimeMs"], schemaVersion: resumed.checkpoint.schemaVersion,
  };

  const derivativeByBudget = budgets.map((iterations) => ({
    iterations,
    maxAt1e3: sensitivityMatrix.find((point) => point.iterations === iterations && point.requestedEpsilon === 0.001)?.maxDerivative ?? null,
    weightedAt1e3: sensitivityMatrix.find((point) => point.iterations === iterations && point.requestedEpsilon === 0.001)?.weightedDerivative ?? null,
  }));
  const finiteSolveRatio = derivativeByBudget.at(-1).weightedAt1e3 / Math.max(1e-15, derivativeByBudget[0].weightedAt1e3);
  const responseRatios = {
    directions: summarizeRatios(perturbationStudy.map((item) => item.localResponse.ratio).filter((value) => value !== null)),
    R: summarizeRatios(microCoupling.R.metrics.map((item) => item.localResponseRatio).filter((value) => value !== null)),
    E: summarizeRatios(microCoupling.E.metrics.map((item) => item.localResponseRatio).filter((value) => value !== null)),
    X: summarizeRatios(microCoupling.X.metrics.map((item) => item.localResponseRatio).filter((value) => value !== null)),
  };
  const bestFull = confirmatory.filter((item) => typeof item.requestedBudget === "number").at(-1);
  const gateD = bestFull?.gateD ?? { version: 2, passed: false, reason: "No valid confirmatory run." };
  const expectedCloser = modelComparison.EVsX.pairUtilityError.l2 < modelComparison.RVsX.pairUtilityError.l2;
  const hypotheses = {
    H1: { verdict: finiteSolveRatio < 0.5 ? "supported" : finiteSolveRatio < 0.8 ? "partially supported" : "weakened", evidence: { weightedDerivativeRatio50To5000: finiteSolveRatio, derivativeByBudget } },
    H2: { verdict: expectedCloser ? "partially supported" : "weakened", evidence: { expectedCloserToExact: expectedCloser, modelComparison } },
    H3: { verdict: perturbationStudy.some((item) => item.transformation.amplification.conditionalBayes > 1.1) ? "supported" : "weakened", evidence: perturbationStudy.map((item) => ({ direction: item.direction.label, amplification: item.transformation.amplification })) },
    H4: { verdict: fixedQuality.some((item) => item.baselineGate.passed && item.perturbedGate.passed && item.sensitivity.weightedDerivative > 1) ? "partially supported" : "unresolved", evidence: "Sensitivity remaining after matched declared quality is a reduced-game response; it is not proof of full-poker sensitivity." },
    H5: { verdict: gateD.passed ? "weakened" : (responseRatios.R.max ?? 0) > 1 ? "supported" : "partially supported", evidence: { gateD, responseRatios, rawResidualRequired: true } },
  };

  const artifact = {
    schemaVersion: 1, phase: "6.6", solverVersion: SOLVER_VERSION,
    baselineCommit: BASELINE_COMMIT, implementationCommit: SOURCE_COMMIT, sourceCommit: SOURCE_COMMIT,
    startedAt, finishedAt: new Date().toISOString(), trust: "Experimental", verifiedDatasets: 0,
    referenceGame: { id: reference.id, hash: phase6ReferenceGameHash, frozen: true },
    environment: { platform: platform(), cpuCount: cpus().length, totalMemoryBytes: totalmem(), node: process.version },
    manifest,
    gates: { ...gatesABC, D: gateD },
    finiteSolveSensitivity: { perturbationTarget: lastDirection.label, matrix: sensitivityMatrix, fixedQuality, trend: { derivativeByBudget, weightedDerivativeRatio50To5000: finiteSolveRatio } },
    rangeAndPosterior: { directions: perturbationStudy, worstDirection, jointPosteriorPreservedInCouplingV2: true },
    abstractionLaboratory: { purpose: "Controlled structural ablation only; not a replacement for the reference game.", privateCombosPerPlayer: 2, bettingReduction: microAbstraction, models: micro, comparison: modelComparison, fullExpected },
    fixedPoint: {
      residualDefinition: "R(S)=F(S)-S", normalizedUtilityResidual: "L2(R)/max(1,L2(S),L2(F(S)))",
      dampingScreening: screening, bestAlpha, confirmatory, methodComparison,
      initializations: initializationRuns.map((item) => item.summary), basinDistances, microCoupling, responseRatios, checkpointResume,
      tinyAlphaFalseConvergencePrevented: screening.some((item) => { const metric = item.metrics.at(-1); return metric && metric.dampedContinuationDelta <= 0.02 && metric.rawContinuationResidual.normalizedL2 > 0.02; }),
    },
    hypotheses,
    performance: { totalRuntimeMs: performance.now() - started, fullExpectedEstimate, materializationAssessment: fullExpected },
    release: { phase7Recommended: gatesABC.A.passed && gatesABC.B.passed && gatesABC.C.passed && gateD.passed, verifiedDatasets: 0, productExpansion: false },
    limitations: [
      "All results concern the frozen reduced reference game or the explicitly labeled microgame.",
      "LocalResponseRatio is a finite local diagnostic, not a contraction proof.",
      "Expected-bucket keeps exact physical chance probabilities while merging information by deterministic bucket; it is not full exact poker.",
      "No external solver dataset was imported, so Verified remains zero.",
    ],
  };
  const golden = {
    schemaVersion: 1, solverVersion: SOLVER_VERSION, sourceCommit: SOURCE_COMMIT, referenceGameHash: phase6ReferenceGameHash,
    sensitivityMatrix: sensitivityMatrix.map((point) => ({ iterations: point.iterations, epsilon: point.requestedEpsilon, maxDerivative: point.maxDerivative, weightedDerivative: point.weightedDerivative, exploitability: point.baselineQuality.exploitability, nashConv: point.baselineQuality.nashConv })),
    exactMicrogame: { tree: micro.X.tree, convergence: micro.X.solve.convergence, strategyHash: micro.X.solve.strategyHash, utilityHash: micro.X.solve.utilityHash },
    comparison: modelComparison,
    baselineCouplingTrajectory: screening.find((item) => item.metrics[0]?.alpha === 0.05)?.metrics ?? [],
    bestTrajectory: bestFull?.metrics ?? [],
    gateMatrix: { A: gatesABC.A.passed, B: gatesABC.B.passed, C: gatesABC.C.passed, D: gateD.passed },
  };
  await writeJson(ARTIFACT, artifact);
  await writeJson(GOLDEN, golden);
  progress(`artifact ${ARTIFACT}`);
  progress(`golden ${GOLDEN}`);
  progress(`done in ${Math.round(performance.now() - started)}ms`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

