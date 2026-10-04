export type ValidationLevel =
  | "STRUCTURAL"
  | "MATHEMATICAL"
  | "CONVERGENCE"
  | "STRATEGIC"
  | "REPRODUCIBILITY";

export type ValidationMetric = {
  name: string;
  value: number | string | boolean | null;
  unit?: string;
};

export type ValidationThreshold =
  | { kind: "maximum"; value: number }
  | { kind: "minimum"; value: number }
  | { kind: "absolute-error"; expected: number; tolerance: number }
  | { kind: "equal"; value: number | string | boolean | null };

export type ValidationResult = {
  id: string;
  level: ValidationLevel;
  status: "pass" | "fail" | "not-applicable";
  description: string;
  metric?: ValidationMetric;
  threshold?: ValidationThreshold;
  evidence?: string;
};

export type ValidationReport = {
  id: string;
  createdAt: string;
  valid: boolean;
  results: ValidationResult[];
  summary: Record<ValidationLevel, { pass: number; fail: number; notApplicable: number }>;
};

export type ValidationCase = Omit<ValidationResult, "status"> & {
  status?: ValidationResult["status"];
};

function evaluateThreshold(metric: ValidationMetric, threshold: ValidationThreshold) {
  if (threshold.kind === "equal") return metric.value === threshold.value;
  if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) return false;
  if (threshold.kind === "maximum") return metric.value <= threshold.value;
  if (threshold.kind === "minimum") return metric.value >= threshold.value;
  return Math.abs(metric.value - threshold.expected) <= threshold.tolerance;
}

export class ValidationSuite {
  private readonly cases: ValidationCase[] = [];

  constructor(readonly id: string) {}

  add(validationCase: ValidationCase) {
    this.cases.push(validationCase);
    return this;
  }

  report(createdAt = new Date().toISOString()): ValidationReport {
    const results = this.cases.map((validationCase): ValidationResult => {
      const status = validationCase.status
        ?? (validationCase.metric && validationCase.threshold
          ? (evaluateThreshold(validationCase.metric, validationCase.threshold) ? "pass" : "fail")
          : "not-applicable");
      return { ...validationCase, status };
    });
    const levels: ValidationLevel[] = [
      "STRUCTURAL",
      "MATHEMATICAL",
      "CONVERGENCE",
      "STRATEGIC",
      "REPRODUCIBILITY",
    ];
    const summary = Object.fromEntries(levels.map((level) => {
      const relevant = results.filter((result) => result.level === level);
      return [level, {
        pass: relevant.filter((result) => result.status === "pass").length,
        fail: relevant.filter((result) => result.status === "fail").length,
        notApplicable: relevant.filter((result) => result.status === "not-applicable").length,
      }];
    })) as ValidationReport["summary"];
    return {
      id: this.id,
      createdAt,
      valid: results.every((result) => result.status !== "fail"),
      results,
      summary,
    };
  }
}
