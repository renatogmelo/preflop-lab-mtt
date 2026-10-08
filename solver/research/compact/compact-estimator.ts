import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { estimateSyntheticGame } from "../scalability/tree-size-estimator";

export const COMPACT_RESOURCE_BUDGET = {
  maximumNodes: 250_000,
  maximumEstimatedPeakBytes: 768 * 1024 * 1024,
  maximumEstimatedRuntimeMs: 30_000,
  maximumIterations: 20,
} as const;

export type CompactEstimateV2 = {
  nodes: number;
  informationSets: number;
  informationSetActions: number;
  topologyBytes: number;
  registryBytes: number;
  solverStateBytes: number;
  compilationTemporaryBytes: number;
  evaluationTemporaryBytes: number;
  fixedRuntimeAllowanceBytes: number;
  estimatedResidentBytes: number;
  estimatedPeakBytes: number;
  estimatedOneIterationMs: number;
  estimatedFullValidationMs: number;
};

export type CompactPreflightV2 = {
  allowed: boolean;
  reasons: string[];
  estimate: CompactEstimateV2;
  budget: typeof COMPACT_RESOURCE_BUDGET;
};

export function estimateCompactGameV2(configuration: SyntheticGameConfiguration, nodesPerSecond = 2_000_000): CompactEstimateV2 {
  const logical = estimateSyntheticGame(configuration);
  const informationSetActions = logical.informationSets * configuration.actionsPerDecision;
  const topologyBytes = logical.nodes * 28;
  const registryBytes = (logical.informationSets + 1) * 4 + logical.informationSets * 2;
  const solverStateBytes = informationSetActions * 16;
  const compilationTemporaryBytes = logical.nodes;
  const evaluationTemporaryBytes = logical.nodes * 16 + informationSetActions * 8 + logical.informationSets * 2;
  const fixedRuntimeAllowanceBytes = 64 * 1024 * 1024;
  const estimatedResidentBytes = topologyBytes + registryBytes + solverStateBytes;
  const estimatedPeakBytes = estimatedResidentBytes
    + Math.max(compilationTemporaryBytes, evaluationTemporaryBytes)
    + fixedRuntimeAllowanceBytes;
  const traversalMs = logical.nodes / Math.max(1, nodesPerSecond) * 1000;
  return {
    nodes: logical.nodes,
    informationSets: logical.informationSets,
    informationSetActions,
    topologyBytes,
    registryBytes,
    solverStateBytes,
    compilationTemporaryBytes,
    evaluationTemporaryBytes,
    fixedRuntimeAllowanceBytes,
    estimatedResidentBytes,
    estimatedPeakBytes,
    estimatedOneIterationMs: traversalMs * 2,
    estimatedFullValidationMs: traversalMs * 7,
  };
}

export function compactPreflightV2(configuration: SyntheticGameConfiguration, nodesPerSecond?: number): CompactPreflightV2 {
  const estimate = estimateCompactGameV2(configuration, nodesPerSecond);
  const reasons: string[] = [];
  if (estimate.nodes > COMPACT_RESOURCE_BUDGET.maximumNodes) reasons.push("node-budget");
  if (estimate.estimatedPeakBytes > COMPACT_RESOURCE_BUDGET.maximumEstimatedPeakBytes) reasons.push("memory-budget");
  if (estimate.estimatedFullValidationMs > COMPACT_RESOURCE_BUDGET.maximumEstimatedRuntimeMs) reasons.push("runtime-budget");
  return { allowed: reasons.length === 0, reasons, estimate, budget: COMPACT_RESOURCE_BUDGET };
}
