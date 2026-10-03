import { cpus, totalmem } from "node:os";

export type ComputeEstimate = {
  estimatedInfosets: number;
  averageActions: number;
  estimatedBytes: number;
  estimatedIterations: number;
  workUnits: number;
  runtimeClass: "small" | "medium" | "large" | "impractical-on-desktop";
};

export function estimateComputeBudget(estimatedInfosets: number, averageActions: number, iterations: number): ComputeEstimate {
  if (![estimatedInfosets, averageActions, iterations].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Compute estimates require positive finite inputs.");
  }
  const estimatedBytes = Math.ceil(estimatedInfosets * (64 + averageActions * 16));
  const workUnits = estimatedInfosets * averageActions * iterations;
  const runtimeClass = workUnits < 1e8 ? "small" : workUnits < 1e10 ? "medium" : workUnits < 1e12 ? "large" : "impractical-on-desktop";
  return { estimatedInfosets, averageActions, estimatedBytes, estimatedIterations: iterations, workUnits, runtimeClass };
}

export function hardwareProfile() {
  const logicalCores = cpus().length;
  const totalMemoryBytes = totalmem();
  return {
    logicalCores,
    totalMemoryBytes,
    safeMemoryBudgetBytes: Math.floor(totalMemoryBytes * 0.6),
    recommendedWorkerThreads: Math.max(1, logicalCores - 1),
    note: "Solver 0.1.0 remains single-threaded; recommendations are for a future profiled native worker.",
  };
}
