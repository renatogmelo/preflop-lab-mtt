import type { PrivateDealOutcome } from "../cards/private-chance";
import { RandomnessLedger } from "../core/randomness";
import { hashValue } from "../core/stable";

export type ChanceSamplingMode = "iid" | "fixed-crn" | "stratified" | "quasi-deterministic";

export type ChanceSample = {
  sample: number;
  dealIndex: number;
  targetProbability: number;
  proposalProbability: number;
  importanceWeight: number;
  unitPoint: number;
};

export type ChanceCoverage = {
  totalDeals: number;
  observedDeals: number;
  missingDeals: number[];
  minimumCount: number;
  maximumCount: number;
  coveredTargetMass: number;
  empiricalL1: number;
  effectiveSampleSize: number;
  counts: number[];
};

export type ChanceSampleSchedule = {
  id: string;
  mode: ChanceSamplingMode;
  masterSeed: number;
  samples: ChanceSample[];
  coverage: ChanceCoverage;
  randomnessLedger: ReturnType<RandomnessLedger["entries"]>;
};

function validateDistribution(distribution: PrivateDealOutcome[]) {
  if (!distribution.length) throw new Error("Chance schedule requires at least one private deal.");
  const total = distribution.reduce((sum, outcome) => sum + outcome.probability, 0);
  if (Math.abs(total - 1) > 1e-12) throw new Error("Chance schedule requires normalized target probabilities.");
  if (distribution.some((outcome) => !(outcome.probability > 0) || !Number.isFinite(outcome.probability))) {
    throw new Error("Chance schedule requires finite positive target probabilities.");
  }
}

function dealAt(distribution: PrivateDealOutcome[], unitPoint: number) {
  if (!(unitPoint >= 0 && unitPoint < 1)) throw new Error("Chance sample point must be in [0, 1).");
  let cumulative = 0;
  for (let index = 0; index < distribution.length; index += 1) {
    cumulative += distribution[index].probability;
    if (unitPoint < cumulative) return index;
  }
  return distribution.length - 1;
}

export function chanceCoverage(distribution: PrivateDealOutcome[], samples: ChanceSample[]): ChanceCoverage {
  validateDistribution(distribution);
  const counts = distribution.map(() => 0);
  samples.forEach((sample) => {
    if (!distribution[sample.dealIndex]) throw new Error("Chance schedule references an invalid deal index.");
    counts[sample.dealIndex] += 1;
  });
  const total = samples.length;
  const missingDeals = counts.flatMap((count, index) => count === 0 ? [index] : []);
  const weights = samples.map((sample) => sample.importanceWeight);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const squaredTotal = weights.reduce((sum, value) => sum + value * value, 0);
  return {
    totalDeals: distribution.length,
    observedDeals: distribution.length - missingDeals.length,
    missingDeals,
    minimumCount: Math.min(...counts),
    maximumCount: Math.max(...counts),
    coveredTargetMass: distribution.reduce((sum, outcome, index) => sum + (counts[index] > 0 ? outcome.probability : 0), 0),
    empiricalL1: distribution.reduce((sum, outcome, index) => sum + Math.abs((total > 0 ? counts[index] / total : 0) - outcome.probability), 0),
    effectiveSampleSize: squaredTotal > 0 ? (weightTotal * weightTotal) / squaredTotal : 0,
    counts,
  };
}

function finalize(
  mode: ChanceSamplingMode,
  masterSeed: number,
  distribution: PrivateDealOutcome[],
  dealIndices: number[],
  unitPoints: number[],
  ledger: RandomnessLedger,
): ChanceSampleSchedule {
  const counts = distribution.map(() => 0);
  dealIndices.forEach((index) => { counts[index] += 1; });
  const total = dealIndices.length;
  const samples = dealIndices.map((dealIndex, sample) => {
    const proposalProbability = mode === "iid" || mode === "fixed-crn"
      ? distribution[dealIndex].probability
      : counts[dealIndex] / total;
    const targetProbability = distribution[dealIndex].probability;
    return {
      sample,
      dealIndex,
      targetProbability,
      proposalProbability,
      importanceWeight: targetProbability / proposalProbability,
      unitPoint: unitPoints[sample],
    };
  });
  const coverage = chanceCoverage(distribution, samples);
  return {
    id: hashValue({ mode, masterSeed, deals: distribution.map((deal) => [deal.playerZero.id, deal.playerOne.id, deal.probability]), dealIndices }),
    mode,
    masterSeed,
    samples,
    coverage,
    randomnessLedger: ledger.entries(),
  };
}

export function createChanceSampleSchedule(
  distribution: PrivateDealOutcome[],
  sampleCount: number,
  mode: ChanceSamplingMode,
  masterSeed: number,
): ChanceSampleSchedule {
  validateDistribution(distribution);
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) throw new Error("Chance sample count must be a positive integer.");
  const ledger = new RandomnessLedger(masterSeed);
  const stream = ledger.stream(`preflop-chance:${mode}`, `Private-deal schedule for ${mode} traversal.`);
  const unitPoints: number[] = [];
  if (mode === "iid" || mode === "fixed-crn") {
    for (let sample = 0; sample < sampleCount; sample += 1) unitPoints.push(stream.next());
  } else if (mode === "stratified") {
    for (let sample = 0; sample < sampleCount; sample += 1) unitPoints.push((sample + stream.next()) / sampleCount);
    for (let index = unitPoints.length - 1; index > 0; index -= 1) {
      const selected = stream.integer(index + 1);
      [unitPoints[index], unitPoints[selected]] = [unitPoints[selected], unitPoints[index]];
    }
  } else {
    const radicalInverseBaseTwo = (value: number) => {
      let remaining = value;
      let fraction = 0.5;
      let result = 0;
      while (remaining > 0) {
        result += (remaining % 2) * fraction;
        remaining = Math.floor(remaining / 2);
        fraction *= 0.5;
      }
      return result;
    };
    for (let sample = 0; sample < sampleCount; sample += 1) unitPoints.push(radicalInverseBaseTwo(sample + 1));
  }
  const dealIndices = unitPoints.map((point) => dealAt(distribution, point));
  return finalize(mode, masterSeed, distribution, dealIndices, unitPoints, ledger);
}

export function validateImportanceWeighting(schedule: ChanceSampleSchedule, tolerance = 1e-12) {
  const errors = schedule.samples.map((sample) => Math.abs(
    sample.importanceWeight - sample.targetProbability / sample.proposalProbability,
  ));
  const recovered = new Map<number, number>();
  schedule.samples.forEach((sample) => {
    recovered.set(sample.dealIndex, (recovered.get(sample.dealIndex) ?? 0) + sample.importanceWeight / schedule.samples.length);
  });
  return {
    valid: errors.every((error) => error <= tolerance),
    maximumError: errors.reduce((maximum, error) => Math.max(maximum, error), 0),
    recoveredTargetMass: [...recovered.values()].reduce((sum, value) => sum + value, 0),
  };
}