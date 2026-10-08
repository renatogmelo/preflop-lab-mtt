import type { TreeSizeEstimate } from "./tree-size-estimator";

export type ResearchResourceBudget = {
  maximumNodes: number;
  maximumEstimatedBytes: number;
  maximumRuntimeMs: number;
  maximumIterations: number;
  checkpointInterval: number;
};

export const DEFAULT_RESEARCH_BUDGET: ResearchResourceBudget = {
  maximumNodes: 250_000,
  maximumEstimatedBytes: 768 * 1024 * 1024,
  maximumRuntimeMs: 30_000,
  maximumIterations: 25_000,
  checkpointInterval: 500,
};

export type ResourceDecision = {
  allowed: boolean;
  reasons: string[];
  projectedTraversalNodes: number;
  budget: ResearchResourceBudget;
};

export function assessResourceBudget(estimate: TreeSizeEstimate, iterations: number, budget = DEFAULT_RESEARCH_BUDGET): ResourceDecision {
  const reasons: string[] = [];
  if (estimate.nodes > budget.maximumNodes) reasons.push(`node-budget:${estimate.nodes}>${budget.maximumNodes}`);
  if (estimate.estimatedDefinitionBytes + estimate.estimatedCompiledBytes > budget.maximumEstimatedBytes) reasons.push("memory-budget");
  if (iterations > budget.maximumIterations) reasons.push(`iteration-budget:${iterations}>${budget.maximumIterations}`);
  return { allowed: reasons.length === 0, reasons, projectedTraversalNodes: estimate.traversalNodesPerIteration * iterations, budget };
}

export function safeAbortArtifact(level: string, estimate: TreeSizeEstimate, decision: ResourceDecision) {
  return {
    level,
    status: "safe-abort" as const,
    estimate,
    reasons: decision.reasons,
    budget: decision.budget,
    executed: false,
  };
}
