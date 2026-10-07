import type { BehavioralStrategy } from "../../core/types";
import { strategyDistance } from "../../comparison/strategy-distance";

export function researchStrategyDistance(left: BehavioralStrategy, right: BehavioralStrategy) {
  const result = strategyDistance(left, right);
  return {
    l1: result.l1,
    l2: result.l2,
    maximum: result.maxAbsoluteDelta,
    mean: result.meanAbsoluteDelta,
    jensenShannon: result.jensenShannonDivergence,
  };
}
