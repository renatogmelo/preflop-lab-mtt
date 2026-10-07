import type { BehavioralStrategy } from "../../core/types";
import { researchStrategyDistance } from "./strategy-distance";

type ComparableSolve = {
  strategy: BehavioralStrategy;
  strategyHash: string;
  evaluation?: { exploitability: number; nashConv: number; utilities: [number, number]; bestResponses: readonly [{ value: number }, { value: number }] };
  final?: { exploitability: number; nashConv: number; strategyEv: number; bestResponseEv: [number, number]; residual: { normalizedL2: number } };
  performance: { runtimeMs: number; nodesVisited: number };
};

export function compareSolveToGroundTruth(solve: ComparableSolve, groundTruth: { strategy: BehavioralStrategy; value: number }) {
  const exploitability = solve.evaluation?.exploitability ?? solve.final?.exploitability ?? Number.NaN;
  const nashConv = solve.evaluation?.nashConv ?? solve.final?.nashConv ?? Number.NaN;
  const strategyEv = solve.evaluation?.utilities[0] ?? solve.final?.strategyEv ?? Number.NaN;
  return {
    strategyHash: solve.strategyHash,
    strategyDistance: researchStrategyDistance(solve.strategy, groundTruth.strategy),
    strategyEv,
    bestResponseEv: solve.evaluation ? [solve.evaluation.bestResponses[0].value, solve.evaluation.bestResponses[1].value] as [number, number] : solve.final?.bestResponseEv ?? [Number.NaN, Number.NaN],
    valueError: Math.abs(strategyEv - groundTruth.value),
    exploitability,
    nashConv,
    fixedPointResidual: solve.final?.residual.normalizedL2 ?? null,
    runtimeMs: solve.performance.runtimeMs,
    nodesVisited: solve.performance.nodesVisited,
  };
}
