import { privateDealDistribution, type PrivateDealOutcome } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import { distributionDistance, normalizeDistribution } from "./phase6-6";
import {
  deriveConditionalJointDealSnapshot,
  deriveConditionalRangeSnapshots,
  weightedRangeFromSnapshot,
  type ConditionalRangeInput,
} from "../ranges/conditional";

function dealKey(deal: PrivateDealOutcome) {
  return deal.playerZero.id + "|" + deal.playerOne.id;
}

function alignedDistribution(
  left: readonly PrivateDealOutcome[],
  right: readonly PrivateDealOutcome[],
) {
  const leftMap = new Map(left.map((deal) => [dealKey(deal), deal.probability]));
  const rightMap = new Map(right.map((deal) => [dealKey(deal), deal.probability]));
  const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  return {
    keys,
    left: keys.map((key) => leftMap.get(key) ?? 0),
    right: keys.map((key) => rightMap.get(key) ?? 0),
  };
}

function rangeWeights(range: WeightedRange) {
  return range.entries().filter((entry) => entry.weight > 0).sort((left, right) => left.combo.id.localeCompare(right.combo.id));
}

function alignedRangeDistribution(left: WeightedRange, right: WeightedRange) {
  const leftEntries = rangeWeights(left);
  const rightEntries = rangeWeights(right);
  const leftMap = new Map(leftEntries.map((entry) => [entry.combo.id, entry.weight]));
  const rightMap = new Map(rightEntries.map((entry) => [entry.combo.id, entry.weight]));
  const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  return {
    keys,
    leftRaw: keys.map((key) => leftMap.get(key) ?? 0),
    rightRaw: keys.map((key) => rightMap.get(key) ?? 0),
    left: normalizeDistribution(keys.map((key) => leftMap.get(key) ?? 0)),
    right: normalizeDistribution(keys.map((key) => rightMap.get(key) ?? 0)),
  };
}

export function auditRangeTransformation(
  baselineInput: ConditionalRangeInput,
  perturbedRanges: [WeightedRange, WeightedRange],
  epsilon: number,
) {
  const perturbedInput: ConditionalRangeInput = {
    ...baselineInput,
    ranges: perturbedRanges,
    sourceSolveId: baselineInput.sourceSolveId + ":perturbed",
  };
  const baselineNormalized = baselineInput.ranges.map((range, player) => (
    alignedRangeDistribution(range, perturbedRanges[player as 0 | 1])
  ));
  const inputRangeDelta = Math.max(...baselineNormalized.map((entry) => distributionDistance(entry.leftRaw, entry.rightRaw).l1));
  const normalizedRangeDelta = Math.max(...baselineNormalized.map((entry) => distributionDistance(entry.left, entry.right).l1));

  const board = baselineInput.board ?? baselineInput.configuration.continuationBoard;
  const baselinePrior = privateDealDistribution(baselineInput.ranges[0], baselineInput.ranges[1], board);
  const perturbedPrior = privateDealDistribution(perturbedRanges[0], perturbedRanges[1], board);
  const priorAligned = alignedDistribution(baselinePrior, perturbedPrior);
  const jointCompatibleDelta = distributionDistance(priorAligned.left, priorAligned.right);

  const baselineJoint = deriveConditionalJointDealSnapshot(baselineInput);
  const perturbedJoint = deriveConditionalJointDealSnapshot(perturbedInput);
  const posteriorAligned = alignedDistribution(baselineJoint.deals, perturbedJoint.deals);
  const conditionalPosteriorDelta = distributionDistance(posteriorAligned.left, posteriorAligned.right);

  const baselineMarginals = deriveConditionalRangeSnapshots(baselineInput);
  const perturbedMarginals = deriveConditionalRangeSnapshots(perturbedInput);
  const baselineConditioned: [WeightedRange, WeightedRange] = [
    weightedRangeFromSnapshot(baselineMarginals[0], baselineInput.ranges[0]),
    weightedRangeFromSnapshot(baselineMarginals[1], baselineInput.ranges[1]),
  ];
  const perturbedConditioned: [WeightedRange, WeightedRange] = [
    weightedRangeFromSnapshot(perturbedMarginals[0], perturbedRanges[0]),
    weightedRangeFromSnapshot(perturbedMarginals[1], perturbedRanges[1]),
  ];
  const baselineProductChance = privateDealDistribution(baselineConditioned[0], baselineConditioned[1], board);
  const perturbedProductChance = privateDealDistribution(perturbedConditioned[0], perturbedConditioned[1], board);
  const chanceAligned = alignedDistribution(baselineProductChance, perturbedProductChance);
  const postflopChanceDelta = distributionDistance(chanceAligned.left, chanceAligned.right);

  const inputScale = Math.max(1e-15, normalizedRangeDelta);
  const nearZero = posteriorAligned.keys.map((key, index) => ({
    pairKey: key,
    baselineReach: posteriorAligned.left[index],
    perturbedReach: posteriorAligned.right[index],
    absoluteDelta: Math.abs(posteriorAligned.right[index] - posteriorAligned.left[index]),
    derivative: Math.abs(posteriorAligned.right[index] - posteriorAligned.left[index]) / Math.max(1e-15, epsilon),
  })).filter((entry) => entry.baselineReach <= 1e-6 || entry.perturbedReach <= 1e-6)
    .sort((left, right) => right.derivative - left.derivative);

  return {
    epsilon,
    stages: {
      inputRangeDelta,
      normalizedRangeDelta,
      jointCompatibleDeals: jointCompatibleDelta,
      conditionalPosterior: conditionalPosteriorDelta,
      postflopChanceWeights: postflopChanceDelta,
    },
    amplification: {
      normalization: normalizedRangeDelta / Math.max(1e-15, inputRangeDelta),
      jointCompatibility: jointCompatibleDelta.l1 / inputScale,
      conditionalBayes: conditionalPosteriorDelta.l1 / inputScale,
      postflopChance: postflopChanceDelta.l1 / inputScale,
    },
    normalizationMass: {
      baselinePosterior: baselineJoint.normalization,
      perturbedPosterior: perturbedJoint.normalization,
    },
    posteriorVsProductOfMarginals: {
      baseline: distributionDistance(
        alignedDistribution(baselineJoint.deals, baselineProductChance).left,
        alignedDistribution(baselineJoint.deals, baselineProductChance).right,
      ),
      perturbed: distributionDistance(
        alignedDistribution(perturbedJoint.deals, perturbedProductChance).left,
        alignedDistribution(perturbedJoint.deals, perturbedProductChance).right,
      ),
      interpretation: "Measures correlation lost when a joint posterior is reconstructed as the product of marginal ranges.",
    },
    nearZeroMass: nearZero,
    explicitJointDeals: {
      baseline: baselineJoint.deals,
      perturbed: perturbedJoint.deals,
    },
  };
}
