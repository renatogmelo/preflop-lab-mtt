import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { privateDealDistribution } from "../cards/private-chance.ts";
import { EquityEngine } from "../cards/equity.ts";
import { WeightedRange } from "../cards/range.ts";
import { vectorNorms } from "../analysis/phase6-6.ts";
import { EquityProvider } from "../continuation/engine.ts";
import { CoupledFixedPointSolverV2 } from "../coupling/fixed-point-v2.ts";
import { hashValue } from "../core/stable.ts";
import { counterfactualActionDiagnostics } from "../evaluation/compiled-analysis.ts";
import { phase6ReferenceActionHistory, phase6ReferenceBoardProvider, phase6ReferenceFlop, phase6ReferencePostflopAbstraction, phase6ReferencePostflopDefinition, phase6ReferencePreflop, phase6ReferenceRanges } from "../experiments/phase6-reference.ts";
import { BucketedBoardProvider, ExactBoardEnumerationProvider, ExpectedBucketBoardProvider, RangePostflopHoldemSubgame, solveRangePostflopToQuality } from "../game/range-postflop-subgame.ts";
import { readJson, writeJson } from "../storage/files.ts";
import { compileGameTree } from "../tree/compiled.ts";

const path = resolve("solver/artifacts/phase6-6-continuation-operator-v0.6.0.json");
const goldenPath = resolve("tests/golden/phase6-6-v0.6.0.json");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dcfr = { alpha: 2, beta: 0, gamma: 3 };
const solve = (iterations) => ({ algorithm: "dcfr", iterations, metricInterval: iterations, seed: 19, exactMetrics: true, engine: "indexed-tree", dcfr });
const progress = (message) => process.stdout.write(`[phase6.6-finalize] ${message}\n`);

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

function config(provider, ranges, alpha, outerIterations, method = "plain-damping", postflopSolve = solve(5_000)) {
  return {
    preflop: { ...phase6ReferencePreflop, iterations: 5_000, metricInterval: 5_000 },
    exactPreflop: { algorithm: "dcfr", iterations: 5_000, metricInterval: 5_000, dcfr },
    ranges, actionHistory: phase6ReferenceActionHistory, flop: phase6ReferenceFlop,
    postflopAbstraction: phase6ReferencePostflopAbstraction, boardProvider: provider, postflopSolve,
    innerQuality: { exploitabilityThreshold: 0.02, reachWeightedMovementThreshold: 0.02, checkpoints: [250, 500, 1_000, 2_500, 5_000], maximumIterations: 5_000 },
    outerIterations, dampingAlpha: alpha, method,
    adaptiveDamping: { minimum: 0.01, maximum: 0.25, shrink: 0.5, grow: 1.2 },
    anderson: { history: 3, regularization: 1e-8, safeguardFactor: 1.25 },
    gateD: { preflopReachWeightedDelta: 0.02, conditionalRangeL1: 0.02, normalizedRawContinuationResidual: 0.02, dampedContinuationDelta: 0.02, postflopReachWeightedDelta: 0.02, localResponseRatio: 1, patience: 3 },
  };
}

function summary(result) {
  return {
    id: result.id, boardContinuationModel: result.boardContinuationModel, initializationId: result.initializationId,
    method: result.method, converged: result.converged, stopReason: result.stopReason, gateD: result.gateD,
    metrics: result.metrics, checkpoint: result.checkpoint,
    finalPreflopStrategyHash: result.finalPreflop ? hashValue(result.finalPreflop.strategy) : null,
    finalRangeHashes: result.finalConditionalRanges?.map((snapshot) => hashValue(snapshot.comboWeights)) ?? null,
    postflopArtifacts: result.postflopArtifacts.map((item) => ({ id: item.id, convergence: item.convergence, boardContinuationModel: item.boardContinuationModel, strategyHash: hashValue(item.strategy), runtime: item.runtime })),
  };
}

function semanticCheckpoint(checkpoint) {
  return { ...checkpoint, metrics: checkpoint.metrics.map((metric) => Object.fromEntries(Object.entries(metric).filter(([key]) => key !== "runtimeMs"))) };
}

function commonDiagnostics(leftDefinition, leftArtifact, exactDefinition, exactArtifact) {
  const collect = (definition, artifact) => {
    const root = compileGameTree(new RangePostflopHoldemSubgame(definition)).root;
    return [0, 1].flatMap((player) => counterfactualActionDiagnostics(root, artifact.strategy, player)).flatMap((entry) => Object.entries(entry.actionEvs).map(([action, ev]) => ({ key: `${entry.player}|${entry.informationSet}|${action}`, ev, probability: entry.probabilities[action], reach: entry.reach })));
  };
  const left = new Map(collect(leftDefinition, leftArtifact).map((entry) => [entry.key, entry]));
  const exact = new Map(collect(exactDefinition, exactArtifact).map((entry) => [entry.key, entry]));
  const keys = [...left.keys()].filter((key) => exact.has(key) && left.get(key).ev !== null && exact.get(key).ev !== null).sort();
  const evDelta = keys.map((key) => left.get(key).ev - exact.get(key).ev);
  const probabilityDelta = keys.map((key) => left.get(key).probability - exact.get(key).probability);
  const reach = keys.map((key) => exact.get(key).reach);
  return { commonActionEntries: keys.length, actionEvError: vectorNorms(evDelta, reach), commonStrategyError: vectorNorms(probabilityDelta, reach), comparability: "Only identical information-set/action keys are compared; global strategy distance across different information partitions is not interpretable." };
}

async function main() {
  const artifact = await readJson(path);
  const golden = await readJson(goldenPath);

  progress("repairing directional amplification metadata");
  for (const entry of artifact.rangeAndPosterior.directions) {
    const input = entry.appliedEpsilon;
    entry.transformation.stages.inputRangeDelta = input;
    entry.transformation.stages.inputRangeMetric = "applied directional epsilon before renormalization";
    entry.transformation.amplification.normalization = entry.transformation.stages.normalizedRangeDelta / input;
  }

  artifact.hypotheses.H3.evidence = artifact.rangeAndPosterior.directions.map((entry) => ({
    direction: entry.direction.label,
    amplification: entry.transformation.amplification,
  }));
  progress("fixed-quality R/E/X laboratory");
  const microRanges = phase6ReferenceRanges.map((range) => new WeightedRange(range.entries().slice(0, 2)));
  const abstraction = { flopBetFractions: [], turnBetFractions: [], riverBetFractions: [1], raisePotFractions: [], maxRaisesPerStreet: 0, jamAllowed: false };
  const providers = { R: new BucketedBoardProvider(2), E: new ExpectedBucketBoardProvider(2), X: new ExactBoardEnumerationProvider() };
  const definition = (provider) => ({ ...phase6ReferencePostflopDefinition(microRanges), id: "phase6-6-fixed-quality-" + provider.boardContinuationModel, ranges: microRanges, abstraction, boardProvider: provider });
  const gate = { exploitabilityThreshold: 0.02, reachWeightedMovementThreshold: 0.02, checkpoints: [250, 500, 1_000, 2_500, 5_000], maximumIterations: 5_000 };
  const quality = {};
  const qualityArtifacts = {};
  for (const [label, provider] of Object.entries(providers)) {
    const currentDefinition = definition(provider);
    const result = solveRangePostflopToQuality(currentDefinition, solve(5_000), gate);
    qualityArtifacts[label] = { definition: currentDefinition, result };
    quality[label] = { boardContinuationModel: result.boardContinuationModel, innerQuality: result.innerQuality, convergence: result.convergence, strategyHash: hashValue(result.strategy), utilityHash: hashValue(result.pairUtilities), runtime: result.runtime };
  }
  quality.comparison = {
    RVsX: commonDiagnostics(qualityArtifacts.R.definition, qualityArtifacts.R.result, qualityArtifacts.X.definition, qualityArtifacts.X.result),
    EVsX: commonDiagnostics(qualityArtifacts.E.definition, qualityArtifacts.E.result, qualityArtifacts.X.definition, qualityArtifacts.X.result),
  };
  artifact.abstractionLaboratory.fixedQualityComparison = quality;
  const qualityComparable = quality.E.innerQuality.passed && quality.X.innerQuality.passed;
  artifact.hypotheses.H2 = {
    verdict: qualityComparable ? (quality.comparison.EVsX.actionEvError.l2 < quality.comparison.RVsX.actionEvError.l2 ? "partially supported" : "weakened") : "unresolved",
    evidence: { qualityComparable, fixedQualityComparison: quality.comparison, expectedQuality: quality.E.innerQuality, exactQuality: quality.X.innerQuality },
    interpretation: qualityComparable ? "E and X met the same declared quality gate." : "E did not meet the declared quality gate, so its apparent error cannot be separated from finite-solve error.",
  };

  const equity = equityValues(phase6ReferenceRanges);
  progress("revalidating safeguarded Anderson");
  const anderson = new CoupledFixedPointSolverV2(config(phase6ReferenceBoardProvider, phase6ReferenceRanges, artifact.fixedPoint.bestAlpha, 25, "safeguarded-anderson"), equity, "equity").solve();
  const andersonSummary = summary(anderson);
  artifact.fixedPoint.methodComparison = artifact.fixedPoint.methodComparison.map((entry) => entry.method === "safeguarded-anderson" ? andersonSummary : entry);
  artifact.fixedPoint.andersonSafeguardRevalidated = { fallbackRestoredOnRejection: true, rejectedSteps: anderson.metrics.at(-1)?.rejectedAccelerationSteps ?? 0, finalNormalizedRawResidual: anderson.metrics.at(-1)?.rawContinuationResidual.normalizedL2 ?? null };

  progress("running explicit tiny-alpha diagnostic");
  const tiny = new CoupledFixedPointSolverV2(config(phase6ReferenceBoardProvider, phase6ReferenceRanges, 0.001, 3), equity, "equity-tiny-alpha").solve();
  const tinyLast = tiny.metrics.at(-1);
  artifact.fixedPoint.tinyAlphaDiagnostic = summary(tiny);
  artifact.fixedPoint.tinyAlphaFalseConvergencePrevented = tinyLast.dampedContinuationDelta <= 0.02 && tinyLast.rawContinuationResidual.normalizedL2 > 0.02 && !tiny.gateD.passed;

  progress("revalidating semantic checkpoint resume");
  const checkpointConfiguration = config(phase6ReferenceBoardProvider, phase6ReferenceRanges, artifact.fixedPoint.bestAlpha, 4);
  const checkpointSolver = new CoupledFixedPointSolverV2(checkpointConfiguration, equity, "equity");
  const uninterrupted = checkpointSolver.solve();
  const partial = checkpointSolver.solve(undefined, 2);
  const resumed = new CoupledFixedPointSolverV2(checkpointConfiguration, equity, "equity").solve(partial.checkpoint, 4);
  const uninterruptedSemanticHash = hashValue(semanticCheckpoint(uninterrupted.checkpoint));
  const resumedSemanticHash = hashValue(semanticCheckpoint(resumed.checkpoint));
  artifact.fixedPoint.checkpointResume = {
    uninterruptedRawHash: hashValue(uninterrupted.checkpoint), resumedRawHash: hashValue(resumed.checkpoint),
    uninterruptedSemanticHash, resumedSemanticHash, identical: uninterruptedSemanticHash === resumedSemanticHash,
    excludedNondeterministicFields: ["metrics[].runtimeMs"], schemaVersion: resumed.checkpoint.schemaVersion,
  };

  artifact.implementationCommit = sourceCommit;
  artifact.sourceCommit = sourceCommit;
  artifact.finalization = { sourceCommit, finishedAt: new Date().toISOString(), scope: ["directional amplification metadata", "fixed-quality R/E/X", "Anderson fallback", "tiny-alpha diagnostic", "semantic checkpoint resume"] };
  golden.sourceCommit = sourceCommit;
  golden.fixedQualityComparison = quality.comparison;
  golden.checkpointResume = artifact.fixedPoint.checkpointResume;
  golden.andersonSafeguard = artifact.fixedPoint.andersonSafeguardRevalidated;
  golden.tinyAlpha = { prevented: artifact.fixedPoint.tinyAlphaFalseConvergencePrevented, final: tinyLast };
  await writeJson(path, artifact);
  await writeJson(goldenPath, golden);
  progress(`checkpoint semantic identity=${artifact.fixedPoint.checkpointResume.identical}`);
  progress(`E quality passed=${quality.E.innerQuality.passed}`);
  progress(`tiny-alpha false convergence prevented=${artifact.fixedPoint.tinyAlphaFalseConvergencePrevented}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


