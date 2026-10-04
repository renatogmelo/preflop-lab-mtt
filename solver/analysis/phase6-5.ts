import { hashValue } from "../core/stable";

export type CycleDiagnostic = {
  detected: boolean;
  period: number | null;
  distance: number | null;
  amplitude: number;
};

function maxVectorDistance(left: number[], right: number[]) {
  if (left.length !== right.length) throw new Error("Cycle vectors must have equal length.");
  return left.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - right[index])), 0);
}

export function detectApproximateCycle(
  history: number[][],
  periods: number[] = [2, 3],
  tolerance = 1e-4,
  minimumAmplitude = tolerance * 4,
): CycleDiagnostic {
  for (const period of periods) {
    if (!Number.isInteger(period) || period < 2 || history.length < period * 2) continue;
    const current = history.at(-1)!;
    const previous = history[history.length - 1 - period];
    const distance = maxVectorDistance(current, previous);
    const amplitude = Math.max(...history.slice(-period).map((vector, index, values) => (
      index === 0 ? 0 : maxVectorDistance(vector, values[index - 1])
    )));
    if (distance <= tolerance && amplitude >= minimumAmplitude) return { detected: true, period, distance, amplitude };
  }
  return { detected: false, period: null, distance: null, amplitude: 0 };
}

export type SensitivityProbe = {
  epsilon: number;
  outputDelta: number[];
  derivative: number[];
  maxAbsoluteDerivative: number;
  l1Derivative: number;
};

export function finiteDifferenceSensitivity(
  baseline: number[],
  evaluate: (perturbed: number[]) => number[],
  index: number,
  epsilons = [1e-4, 1e-3, 1e-2, 5e-2],
) {
  if (!baseline[index] || baseline[index] <= 0) throw new Error("Sensitivity requires a positive baseline component.");
  const baseOutput = evaluate([...baseline]);
  const probes: SensitivityProbe[] = epsilons.map((epsilon) => {
    if (!(epsilon > 0) || baseline[index] + epsilon > 1) throw new Error("Sensitivity epsilon leaves the [0, 1] weight domain.");
    const perturbed = [...baseline];
    perturbed[index] += epsilon;
    const output = evaluate(perturbed);
    if (output.length !== baseOutput.length) throw new Error("Sensitivity output dimension changed.");
    const outputDelta = output.map((value, outputIndex) => value - baseOutput[outputIndex]);
    const derivative = outputDelta.map((value) => value / epsilon);
    return {
      epsilon,
      outputDelta,
      derivative,
      maxAbsoluteDerivative: derivative.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0),
      l1Derivative: derivative.reduce((sum, value) => sum + Math.abs(value), 0),
    };
  });
  const slopeVariation = probes.length < 2 ? 0 : probes.slice(1).reduce((maximum, probe, probeIndex) => (
    Math.max(maximum, maxVectorDistance(probe.derivative, probes[probeIndex].derivative))
  ), 0);
  return {
    id: hashValue({ baseline, index, epsilons, baseOutput, probes }),
    index,
    epsilons,
    baseOutput,
    probes,
    slopeVariation,
    possibleDiscontinuity: slopeVariation > Math.max(0.1, probes[0].maxAbsoluteDerivative * 0.5),
  };
}

export function dampingStep(previous: number[], solved: number[], alpha: number) {
  if (previous.length !== solved.length) throw new Error("Damping vectors must have equal length.");
  if (!(alpha > 0 && alpha <= 1)) throw new Error("Damping alpha must be in (0, 1].");
  return solved.map((value, index) => alpha * value + (1 - alpha) * previous[index]);
}

export function contractionRatios(deltas: number[]) {
  return deltas.slice(1).map((value, index) => ({
    fromIteration: index + 1,
    toIteration: index + 2,
    ratio: deltas[index] > 0 ? value / deltas[index] : null,
    contracting: deltas[index] > 0 && value < deltas[index],
  }));
}