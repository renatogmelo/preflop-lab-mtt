export const RELEASE_READINESS_CATEGORIES = [
  "mathematical-correctness",
  "numerical-stability",
  "convergence-evidence",
  "compiler-integrity",
  "cache-integrity",
  "checkpoint-durability",
  "crash-recovery",
  "resource-safety",
  "reproducibility",
  "test-coverage",
  "documentation",
  "known-limitations",
] as const;

export type ReadinessStatus = "PASS" | "FAIL" | "PARTIAL" | "NOT TESTED";
export type ReadinessEvidence = {
  category: (typeof RELEASE_READINESS_CATEGORIES)[number];
  status: ReadinessStatus;
  evidence: readonly string[];
  limitation: string | null;
};

export function buildReleaseReadinessMatrix(evidence: readonly ReadinessEvidence[]) {
  const categories = new Map(evidence.map((entry) => [entry.category, entry]));
  const matrix = RELEASE_READINESS_CATEGORIES.map((category) => categories.get(category) ?? {
    category,
    status: "NOT TESTED" as const,
    evidence: [],
    limitation: "No executed evidence was registered.",
  });
  const readyForSyntheticScope = matrix.every((entry) => entry.status === "PASS" || entry.status === "PARTIAL")
    && matrix.filter((entry) => entry.status === "PARTIAL").every((entry) => entry.category === "resource-safety" || entry.category === "reproducibility");
  return { matrix, readyForSyntheticScope, broaderScopeCertified: false };
}
