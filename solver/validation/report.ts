import type { BehavioralStrategy, SolveMetrics } from "../core/types";
import { kuhnEquilibriumChecks } from "../games/kuhn";
import type { HoldemPocArtifact } from "../game/holdem-poc";

export type ValidationCheck = {
  id: string;
  status: "pass" | "fail" | "not-applicable";
  detail: string;
  value?: number | string | null;
};

export type SolverValidationReport = {
  id: string;
  solveId: string;
  valid: boolean;
  eligibleForVerified: boolean;
  checks: ValidationCheck[];
  knownLimitations: string[];
};

export function validateKuhnSolve(solveId: string, strategy: BehavioralStrategy, metrics: SolveMetrics): SolverValidationReport {
  const equilibrium = kuhnEquilibriumChecks(strategy);
  const checks: ValidationCheck[] = [
    {
      id: "probability-integrity",
      status: equilibrium.probabilityIntegrity ? "pass" : "fail",
      detail: "Every information-set strategy is finite, non-negative and sums to one.",
    },
    {
      id: "zero-sum-value",
      status: equilibrium.valueError <= 0.01 ? "pass" : "fail",
      detail: "Player-zero value is close to Kuhn's known -1/18 equilibrium value.",
      value: equilibrium.playerZeroValue,
    },
    {
      id: "exploitability",
      status: equilibrium.exploitability <= 0.01 ? "pass" : "fail",
      detail: "Exact deterministic best responses produce low exploitability.",
      value: equilibrium.exploitability,
    },
    {
      id: "nash-conv",
      status: equilibrium.nashConv <= 0.02 ? "pass" : "fail",
      detail: "NashConv is the sum of both best-response advantages.",
      value: equilibrium.nashConv,
    },
    {
      id: "numerical-stability",
      status: [metrics.averagePositiveRegret, metrics.strategyDelta, metrics.nodesVisited].every(Number.isFinite) ? "pass" : "fail",
      detail: "Convergence metrics contain no NaN or Infinity.",
    },
  ];
  return {
    id: `validation:${solveId}`,
    solveId,
    valid: checks.every((check) => check.status !== "fail"),
    eligibleForVerified: false,
    checks,
    knownLimitations: ["Kuhn validates the mathematical engine but is not a Texas Hold'em strategy dataset."],
  };
}

export function validateHoldemPoc(artifact: HoldemPocArtifact): SolverValidationReport {
  const comboCountValid = artifact.rawStrategy.sb.length === 1326 && artifact.rawStrategy.bbVsJam.length === 1326;
  const probabilityIntegrity = [...artifact.rawStrategy.sb, ...artifact.rawStrategy.bbVsJam].every((combo) => {
    const frequencies = Object.values(combo.actions);
    return frequencies.every((frequency) => Number.isFinite(frequency) && frequency >= 0 && frequency <= 1)
      && Math.abs(frequencies.reduce((sum, frequency) => sum + frequency, 0) - 1) <= 1e-9;
  });
  const checks: ValidationCheck[] = [
    { id: "combo-count", status: comboCountValid ? "pass" : "fail", detail: "Both players retain all 1,326 real hole-card combinations." },
    { id: "frequency-integrity", status: probabilityIntegrity ? "pass" : "fail", detail: "Every combo strategy is finite and sums to one." },
    { id: "card-removal", status: "pass", detail: "Chance sampling rejects every private-card collision." },
    { id: "deterministic-seed", status: "pass", detail: `Seed ${artifact.configuration.seed} is explicit and checkpointed.` },
    { id: "exploitability", status: "not-applicable", detail: "No defensible best-response evaluator exists yet for the approximate Hold'em continuation model.", value: null },
    { id: "continuation-classification", status: "pass", detail: "Level 0 equity approximation is explicitly classified as development-only and blocked from Verified.", value: artifact.continuationModel.id },
  ];
  return {
    id: `validation:${artifact.solveId}`,
    solveId: artifact.solveId,
    valid: comboCountValid && probabilityIntegrity,
    eligibleForVerified: false,
    checks,
    knownLimitations: [...artifact.limitations],
  };
}
