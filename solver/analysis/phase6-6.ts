import { hashValue } from "../core/stable";

export type VectorNorms = {
  l1: number;
  l2: number;
  lInfinity: number;
  reachWeighted: number;
};

function assertSameLength(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) throw new Error("Vectors must have equal length.");
}

export function normalizeDistribution(values: readonly number[]) {
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Distribution values must be finite and non-negative.");
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new Error("Distribution must have positive mass.");
  return values.map((value) => value / total);
}

export function vectorNorms(
  vector: readonly number[],
  reachWeights: readonly number[] = vector.map(() => 1),
): VectorNorms {
  assertSameLength(vector, reachWeights);
  if (reachWeights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new Error("Reach weights must be finite and non-negative.");
  }
  const l1 = vector.reduce((sum, value) => sum + Math.abs(value), 0);
  const l2 = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  const lInfinity = vector.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  const reachMass = reachWeights.reduce((sum, value) => sum + value, 0);
  const reachWeighted = reachMass > 0
    ? vector.reduce((sum, value, index) => sum + reachWeights[index] * Math.abs(value), 0) / reachMass
    : 0;
  return { l1, l2, lInfinity, reachWeighted };
}

export function residualNorms(
  state: readonly number[],
  mapped: readonly number[],
  reachWeights?: readonly number[],
) {
  assertSameLength(state, mapped);
  const residual = mapped.map((value, index) => value - state[index]);
  const norms = vectorNorms(residual, reachWeights);
  const scale = Math.max(1, vectorNorms(state, reachWeights).l2, vectorNorms(mapped, reachWeights).l2);
  return {
    residual,
    ...norms,
    normalizedL2: norms.l2 / scale,
    scale,
  };
}

export function distributionDistance(left: readonly number[], right: readonly number[]) {
  assertSameLength(left, right);
  const delta = right.map((value, index) => value - left[index]);
  return {
    delta,
    ...vectorNorms(delta),
    totalVariation: vectorNorms(delta).l1 / 2,
  };
}

export type PerturbationDirection = {
  id: string;
  label: string;
  vector: number[];
  source: "structured" | "coupling-aligned" | "deterministic-random";
};

function canonicalDirection(vector: readonly number[]) {
  if (vector.length < 2 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Perturbation direction must contain at least two finite values.");
  }
  const mean = vector.reduce((sum, value) => sum + value, 0) / vector.length;
  const centered = vector.map((value) => value - mean);
  const positive = centered.reduce((sum, value) => sum + Math.max(0, value), 0);
  const negative = centered.reduce((sum, value) => sum + Math.max(0, -value), 0);
  const scale = Math.max(positive, negative);
  if (!(scale > 1e-15)) throw new Error("Perturbation direction must move probability mass.");
  return centered.map((value) => value / scale);
}

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function deterministicPerturbationDirections(
  size: number,
  couplingAligned?: readonly number[],
  seed = 0x660,
): PerturbationDirection[] {
  if (!Number.isInteger(size) || size < 3) throw new Error("At least three range components are required.");
  const structured: Array<{ label: string; vector: number[]; source: PerturbationDirection["source"] }> = [
    { label: "phase6-5-last-weight", vector: Array.from({ length: size }, (_, index) => index === size - 1 ? 1 : index === 0 ? -1 : 0), source: "structured" },
    { label: "within-class", vector: Array.from({ length: size }, (_, index) => index === 1 ? 1 : index === 2 ? -1 : 0), source: "structured" },
    { label: "strong-to-medium", vector: Array.from({ length: size }, (_, index) => index < Math.ceil(size / 3) ? -1 : index < Math.ceil(2 * size / 3) ? 1 : 0), source: "structured" },
    { label: "medium-to-weak", vector: Array.from({ length: size }, (_, index) => index < Math.ceil(size / 3) ? 0 : index < Math.ceil(2 * size / 3) ? -1 : 1), source: "structured" },
  ];
  if (couplingAligned && couplingAligned.length === size && couplingAligned.some((value) => Math.abs(value) > 1e-15)) {
    structured.push({ label: "coupling-aligned", vector: [...couplingAligned], source: "coupling-aligned" });
  }
  const random = lcg(seed);
  for (let direction = 0; direction < 4; direction += 1) {
    structured.push({
      label: `deterministic-random-${direction}`,
      vector: Array.from({ length: size }, () => random() * 2 - 1),
      source: "deterministic-random",
    });
  }
  return structured.map((entry) => {
    const vector = canonicalDirection(entry.vector);
    return { ...entry, vector, id: hashValue({ label: entry.label, vector }) };
  });
}

export function perturbDistribution(
  baselineValues: readonly number[],
  direction: PerturbationDirection | readonly number[],
  epsilon: number,
) {
  if (!(epsilon > 0)) throw new Error("Perturbation epsilon must be positive.");
  const baseline = normalizeDistribution(baselineValues);
  const vector = canonicalDirection("vector" in direction ? direction.vector : direction);
  assertSameLength(baseline, vector);
  let maximumStep = epsilon;
  vector.forEach((value, index) => {
    if (value < 0) maximumStep = Math.min(maximumStep, baseline[index] / -value);
  });
  if (!(maximumStep > 0)) throw new Error("Perturbation cannot preserve non-negative mass.");
  const appliedEpsilon = Math.min(epsilon, maximumStep * (1 - 1e-12));
  const perturbed = normalizeDistribution(baseline.map((value, index) => Math.max(0, value + appliedEpsilon * vector[index])));
  return {
    baseline,
    perturbed,
    requestedEpsilon: epsilon,
    appliedEpsilon,
    clipped: appliedEpsilon < epsilon * (1 - 1e-10),
    inputDelta: distributionDistance(baseline, perturbed),
  };
}

export function sensitivityMetrics(
  baselineOutput: readonly number[],
  perturbedOutput: readonly number[],
  appliedEpsilon: number,
  reachWeights?: readonly number[],
) {
  assertSameLength(baselineOutput, perturbedOutput);
  if (!(appliedEpsilon > 0)) throw new Error("Applied epsilon must be positive.");
  const outputDelta = perturbedOutput.map((value, index) => value - baselineOutput[index]);
  const derivative = outputDelta.map((value) => value / appliedEpsilon);
  const deltaNorms = vectorNorms(outputDelta, reachWeights);
  const derivativeNorms = vectorNorms(derivative, reachWeights);
  return {
    outputDelta,
    derivative,
    utilityVectorL1: deltaNorms.l1,
    utilityVectorL2: deltaNorms.l2,
    maxUtilityDelta: deltaNorms.lInfinity,
    maxDerivative: derivativeNorms.lInfinity,
    meanDerivative: derivativeNorms.l1 / Math.max(1, derivative.length),
    weightedDerivative: derivativeNorms.reachWeighted,
  };
}

export function localResponseRatio(
  inputLeft: readonly number[],
  inputRight: readonly number[],
  outputLeft: readonly number[],
  outputRight: readonly number[],
  reachWeights?: readonly number[],
) {
  const input = distributionDistance(inputLeft, inputRight);
  assertSameLength(outputLeft, outputRight);
  const outputDelta = outputRight.map((value, index) => value - outputLeft[index]);
  const output = vectorNorms(outputDelta, reachWeights);
  return {
    inputNorm: input.l2,
    outputNorm: output.l2,
    ratio: input.l2 > 0 ? output.l2 / input.l2 : null,
    label: "LocalResponseRatio",
    interpretation: "Diagnostic finite response ratio; not a proof of Lipschitz continuity or contraction.",
  };
}

export function summarizeRatios(values: readonly number[]) {
  const finite = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return { count: 0, min: null, median: null, mean: null, p90: null, max: null };
  const percentile = (p: number) => finite[Math.min(finite.length - 1, Math.ceil(p * finite.length) - 1)];
  return {
    count: finite.length,
    min: finite[0],
    median: percentile(0.5),
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
    p90: percentile(0.9),
    max: finite.at(-1)!,
  };
}

function solveLinearSystem(matrix: number[][], values: number[]) {
  const n = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-14) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry <= n; entry += 1) augmented[column][entry] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= n; entry += 1) augmented[row][entry] -= factor * augmented[column][entry];
    }
  }
  return augmented.map((row) => row[n]);
}

export type AndersonRecord = {
  state: number[];
  mapped: number[];
  residual: number[];
  residualNorm: number;
};

export class SafeguardedAnderson {
  private readonly records: AndersonRecord[] = [];
  rejectedSteps = 0;
  restarts = 0;

  constructor(
    readonly historySize: 2 | 3 | 5,
    readonly regularization = 1e-8,
    readonly safeguardFactor = 1.25,
  ) {}

  reset() {
    this.records.length = 0;
    this.restarts += 1;
  }

  propose(state: readonly number[], mapped: readonly number[], baseline: readonly number[]) {
    const residual = mapped.map((value, index) => value - state[index]);
    const record = { state: [...state], mapped: [...mapped], residual, residualNorm: vectorNorms(residual).l2 };
    this.records.push(record);
    while (this.records.length > this.historySize) this.records.shift();
    if (this.records.length < 2) return { candidate: [...baseline], accelerated: false, coefficients: [1] };
    const gram = this.records.map((left, row) => this.records.map((right, column) => (
      left.residual.reduce((sum, value, index) => sum + value * right.residual[index], 0)
      + (row === column ? this.regularization : 0)
    )));
    const size = this.records.length;
    const kkt = Array.from({ length: size + 1 }, (_, row) => Array.from({ length: size + 1 }, (_, column) => {
      if (row < size && column < size) return gram[row][column];
      if (row === size && column === size) return 0;
      return 1;
    }));
    const solution = solveLinearSystem(kkt, [...Array(size).fill(0), 1]);
    if (!solution || solution.slice(0, size).some((value) => !Number.isFinite(value))) {
      this.reset();
      return { candidate: [...baseline], accelerated: false, coefficients: [1] };
    }
    const coefficients = solution.slice(0, size);
    const candidate = state.map((_, index) => this.records.reduce(
      (sum, item, recordIndex) => sum + coefficients[recordIndex] * item.mapped[index],
      0,
    ));
    if (candidate.some((value) => !Number.isFinite(value))) {
      this.reset();
      return { candidate: [...baseline], accelerated: false, coefficients: [1] };
    }
    return { candidate, accelerated: true, coefficients };
  }

  safeguard(candidateResidual: number, referenceResidual: number) {
    const accepted = Number.isFinite(candidateResidual)
      && candidateResidual <= Math.max(1e-15, referenceResidual) * this.safeguardFactor;
    if (!accepted) {
      this.rejectedSteps += 1;
      this.reset();
    }
    return accepted;
  }

  checkpoint() {
    return {
      historySize: this.historySize,
      regularization: this.regularization,
      safeguardFactor: this.safeguardFactor,
      records: this.records.map((record) => ({ ...record, state: [...record.state], mapped: [...record.mapped], residual: [...record.residual] })),
      rejectedSteps: this.rejectedSteps,
      restarts: this.restarts,
    };
  }

  restore(checkpoint: ReturnType<SafeguardedAnderson["checkpoint"]>) {
    if (checkpoint.historySize !== this.historySize || checkpoint.regularization !== this.regularization || checkpoint.safeguardFactor !== this.safeguardFactor) {
      throw new Error("Anderson checkpoint configuration mismatch.");
    }
    this.records.length = 0;
    checkpoint.records.forEach((record) => this.records.push({
      state: [...record.state],
      mapped: [...record.mapped],
      residual: [...record.residual],
      residualNorm: record.residualNorm,
    }));
    this.rejectedSteps = checkpoint.rejectedSteps;
    this.restarts = checkpoint.restarts;
  }
}
