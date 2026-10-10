import type { CompactIndexedTree } from "../compact/compact-tree";
import type {
  EmpiricalRateDiagnostic,
  NumericalDiagnostics,
  PlateauDiagnostic,
  RegretStatistics,
} from "./types";

export function regretStatistics(
  regrets: Float64Array,
  iteration: number,
  utilityScale: number,
): RegretStatistics {
  let positiveMass = 0;
  let negativeMass = 0;
  let maximumAbsolute = 0;
  let absoluteMass = 0;
  for (const value of regrets) {
    if (value >= 0) positiveMass += value;
    else negativeMass += -value;
    const absolute = Math.abs(value);
    maximumAbsolute = Math.max(maximumAbsolute, absolute);
    absoluteMass += absolute;
  }
  const denominator = Math.max(
    Number.MIN_VALUE,
    Math.abs(utilityScale) * Math.max(1, iteration),
  );
  return {
    positiveMass,
    negativeMass,
    maximumAbsolute,
    meanAbsolute: absoluteMass / Math.max(1, regrets.length),
    normalizedPositiveMass: positiveMass / denominator,
    normalizedMaximumAbsolute: maximumAbsolute / denominator,
  };
}

function normalizationError(tree: CompactIndexedTree, strategy: Float64Array) {
  let maximum = 0;
  for (let info = 0; info < tree.informationSetActionCount.length; info += 1) {
    const offset = tree.informationSetActionOffset[info];
    const count = tree.informationSetActionCount[info];
    let sum = 0;
    for (let action = 0; action < count; action += 1)
      sum += strategy[offset + action];
    maximum = Math.max(maximum, Math.abs(1 - sum));
  }
  return maximum;
}

export function numericalDiagnostics(
  tree: CompactIndexedTree,
  regrets: Float64Array,
  strategySums: Float64Array,
  current: Float64Array,
  average: Float64Array,
  utilities: readonly number[],
): NumericalDiagnostics {
  const finiteRegrets = [...regrets].every(Number.isFinite);
  const finiteStrategySums = [...strategySums].every(Number.isFinite);
  const finiteUtilities = utilities.every(Number.isFinite);
  const currentNormalizationError = normalizationError(tree, current);
  const averageNormalizationError = normalizationError(tree, average);
  const positives = [...current, ...average].filter((value) => value > 0);
  const anomalies: string[] = [];
  if (!finiteRegrets) anomalies.push("non-finite-regret");
  if (!finiteStrategySums) anomalies.push("non-finite-strategy-sum");
  if (!finiteUtilities) anomalies.push("non-finite-utility");
  if (currentNormalizationError > 1e-12)
    anomalies.push("current-strategy-not-normalized");
  if (averageNormalizationError > 1e-12)
    anomalies.push("average-strategy-not-normalized");
  return {
    finiteRegrets,
    finiteStrategySums,
    finiteUtilities,
    currentNormalizationError,
    averageNormalizationError,
    minimumNonZeroReachProxy: positives.length ? Math.min(...positives) : null,
    anomalies,
  };
}

export function detectPlateau(
  values: readonly number[],
  window = 4,
  relativeTolerance = 1e-3,
): PlateauDiagnostic {
  if (values.length < window)
    return {
      classification: "insufficient-data",
      window,
      relativeImprovement: null,
      signChanges: 0,
      evidence: "fewer points than the declared window",
    };
  const sample = values.slice(-window);
  const first = sample[0];
  const last = sample.at(-1)!;
  const relativeImprovement = (first - last) / Math.max(1e-15, Math.abs(first));
  const deltas = sample.slice(1).map((value, index) => value - sample[index]);
  let signChanges = 0;
  for (let index = 1; index < deltas.length; index += 1)
    if (
      Math.sign(deltas[index]) !== 0 &&
      Math.sign(deltas[index - 1]) !== 0 &&
      Math.sign(deltas[index]) !== Math.sign(deltas[index - 1])
    )
      signChanges += 1;
  if (last > first * (1 + relativeTolerance))
    return {
      classification: "divergence",
      window,
      relativeImprovement,
      signChanges,
      evidence: "metric increased across the analysis window",
    };
  if (signChanges >= 2)
    return {
      classification: "oscillation",
      window,
      relativeImprovement,
      signChanges,
      evidence: "metric increments changed sign repeatedly",
    };
  if (Math.abs(relativeImprovement) <= relativeTolerance)
    return {
      classification: "plateau",
      window,
      relativeImprovement,
      signChanges,
      evidence: "relative movement stayed within the predeclared tolerance",
    };
  return {
    classification: "improving",
    window,
    relativeImprovement,
    signChanges,
    evidence: "metric decreased beyond the predeclared tolerance",
  };
}

export function fitEmpiricalRate(
  points: readonly { iteration: number; nashConv: number }[],
): EmpiricalRateDiagnostic {
  const usable = points.filter(
    (point) =>
      point.iteration > 0 &&
      point.nashConv > 0 &&
      Number.isFinite(point.nashConv),
  );
  const limitation =
    "Empirical log-log fit only; it is not a theorem or a certified asymptotic rate.";
  if (usable.length < 3)
    return {
      method: "log-log-ols",
      sampleCount: usable.length,
      slope: null,
      intercept: null,
      rSquared: null,
      interval: null,
      limitation,
    };
  const x = usable.map((point) => Math.log(point.iteration));
  const y = usable.map((point) => Math.log(point.nashConv));
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const covariance = x.reduce(
    (sum, value, index) => sum + (value - meanX) * (y[index] - meanY),
    0,
  );
  const variance = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const slope = variance > 0 ? covariance / variance : 0;
  const intercept = meanY - slope * meanX;
  const residual = y.reduce(
    (sum, value, index) => sum + (value - (intercept + slope * x[index])) ** 2,
    0,
  );
  const total = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  return {
    method: "log-log-ols",
    sampleCount: usable.length,
    slope,
    intercept,
    rSquared: total > 0 ? 1 - residual / total : 1,
    interval: [usable[0].iteration, usable.at(-1)!.iteration],
    limitation,
  };
}
