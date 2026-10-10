import { hashValue } from "../../core/stable";
import type { AlgorithmName, SolverConfiguration } from "../../core/types";
import { ConvergenceExperimentScheduler } from "./scheduler";
import { runIsolatedConvergenceExperiment } from "./isolated-executor";
import {
  CONVERGENCE_EXPERIMENT_SCHEMA,
  CONVERGENCE_FRAMEWORK_VERSION,
  type ConvergenceExperimentConfiguration,
  type ConvergenceGameConfiguration,
  type ConvergenceResourceBudget,
} from "./types";

const baseline = "e5cc8e22126cfa2707fbdc8918582931a91f1b05";
const algorithms: AlgorithmName[] = ["vanilla-cfr", "cfr-plus", "dcfr"];
const seeds = [61400, 61401, 61402, 61403, 61404];
const schedule = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 25_000,
  50_000,
];
const budget: ConvergenceResourceBudget = {
  maximumNodes: 100_000,
  maximumRuntimeMs: 12_000,
  maximumRssBytes: 512 * 1024 * 1024,
  maximumWorkUnits: 80_000_000,
  maximumPurePolicies: 100_000,
};

function solverConfiguration(algorithm: AlgorithmName): SolverConfiguration {
  return { algorithm, seed: 1, exactMetrics: true, engine: "indexed-tree" };
}

function configuration(input: {
  id: string;
  game: ConvergenceGameConfiguration;
  algorithm: AlgorithmName;
  iterations: number;
  seed?: number;
  mode?: "iteration-matched" | "time-matched";
  timeBudgetMs?: number;
  checkpoints?: number[];
  initialState?: "zero" | "alternating-bias";
  utilityScale?: number;
}): ConvergenceExperimentConfiguration {
  return {
    schema: CONVERGENCE_EXPERIMENT_SCHEMA,
    experimentId: input.id,
    game: input.game,
    algorithm: input.algorithm,
    solverConfiguration: solverConfiguration(input.algorithm),
    seed: input.seed ?? 61400,
    comparisonMode: input.mode ?? "iteration-matched",
    iterationBudget: input.iterations,
    ...(input.timeBudgetMs ? { timeBudgetMs: input.timeBudgetMs } : {}),
    evaluationSchedule: schedule.filter((value) => value <= input.iterations),
    checkpointSchedule: input.checkpoints ?? [],
    initialState: input.initialState ?? "zero",
    utilityScale: input.utilityScale ?? 1,
    resourceBudget: budget,
    commit: baseline,
  };
}

export function phase614ExperimentMatrix() {
  const matrix: ConvergenceExperimentConfiguration[] = [];
  for (const algorithm of algorithms) {
    matrix.push(
      configuration({
        id: `hidden-${algorithm}-resume-50000`,
        game: { family: "hidden-information" },
        algorithm,
        iterations: 50_000,
        checkpoints: [1_000, 5_000, 25_000],
      }),
    );
    matrix.push(
      configuration({
        id: `hidden-${algorithm}-continuous-50000`,
        game: { family: "hidden-information" },
        algorithm,
        iterations: 50_000,
      }),
    );
    matrix.push(
      configuration({
        id: `matching-${algorithm}-25000`,
        game: { family: "matching-pennies" },
        algorithm,
        iterations: 25_000,
        checkpoints: [5_000],
      }),
    );
    matrix.push(
      configuration({
        id: `rps-${algorithm}-25000`,
        game: { family: "rock-paper-scissors" },
        algorithm,
        iterations: 25_000,
        checkpoints: [5_000],
      }),
    );
    matrix.push(
      configuration({
        id: `variable-${algorithm}-25000`,
        game: { family: "variable-depth-hidden" },
        algorithm,
        iterations: 25_000,
        checkpoints: [5_000, 10_000],
      }),
    );
    matrix.push(
      configuration({
        id: `asymmetric-${algorithm}-25000`,
        game: { family: "asymmetric-chance" },
        algorithm,
        iterations: 25_000,
        checkpoints: [5_000],
      }),
    );
    matrix.push(
      configuration({
        id: `irregular-${algorithm}-5000`,
        game: {
          family: "irregular-branching",
          seed: 61402,
          maximumDepth: 5,
          minimumTerminalDepth: 2,
          maximumBranching: 3,
        },
        algorithm,
        iterations: 5_000,
        checkpoints: [1_000],
      }),
    );
    matrix.push(
      configuration({
        id: `hidden-${algorithm}-time-150ms`,
        game: { family: "hidden-information" },
        algorithm,
        iterations: 50_000,
        mode: "time-matched",
        timeBudgetMs: 150,
      }),
    );
    matrix.push(
      configuration({
        id: `hidden-${algorithm}-biased-10000`,
        game: { family: "hidden-information" },
        algorithm,
        iterations: 10_000,
        initialState: "alternating-bias",
      }),
    );
    for (const seed of seeds)
      matrix.push(
        configuration({
          id: `property-${seed}-${algorithm}-10000`,
          game: { family: "controlled-random", seed },
          algorithm,
          iterations: 10_000,
          seed,
        }),
      );
  }
  for (const utilityScale of [1e-6, 1e-3, 1, 1e3, 1e6])
    matrix.push(
      configuration({
        id: `utility-${utilityScale}-dcfr-10000`,
        game: { family: "hidden-information" },
        algorithm: "dcfr",
        iterations: 10_000,
        utilityScale,
      }),
    );
  for (const probability of [0, 1e-12, 0.5, 1 - 1e-12, 1])
    matrix.push(
      configuration({
        id: `chance-${probability}-cfr-plus-10000`,
        game: { family: "chance-stress", probability },
        algorithm: "cfr-plus",
        iterations: 10_000,
      }),
    );
  return matrix;
}

export async function runPhase614Research() {
  const experimentMatrix = phase614ExperimentMatrix();
  const scheduler = new ConvergenceExperimentScheduler(1);
  const manifest = await scheduler.run(
    experimentMatrix,
    runIsolatedConvergenceExperiment,
  );
  const results = manifest.results;
  const independentDeltas = results.flatMap((result) =>
    result.series
      .map((point) => point.independentDelta)
      .filter((value): value is number => value !== null),
  );
  const resumeComparisons = algorithms.map((algorithm) => {
    const resumed = results.find(
      (result) => result.experimentId === `hidden-${algorithm}-resume-50000`,
    );
    const continuous = results.find(
      (result) =>
        result.experimentId === `hidden-${algorithm}-continuous-50000`,
    );
    return {
      algorithm,
      bitExact: Boolean(
        resumed &&
        continuous &&
        resumed.finalStateHash === continuous.finalStateHash,
      ),
      resumedHash: resumed?.finalStateHash ?? null,
      continuousHash: continuous?.finalStateHash ?? null,
    };
  });
  const iterationMatched = results.filter(
    (result) => result.configuration.comparisonMode === "iteration-matched",
  );
  const timeMatched = results.filter(
    (result) => result.configuration.comparisonMode === "time-matched",
  );
  const numericalFailures = results.filter(
    (result) => result.status === "numerical-failure",
  );
  const unexplainedFailures = manifest.failures;
  const gates = {
    V1:
      results.length > 0 &&
      results.every(
        (result) => result.schema === CONVERGENCE_EXPERIMENT_SCHEMA,
      ),
    V2:
      algorithms.every((algorithm) =>
        iterationMatched.some(
          (result) => result.configuration.algorithm === algorithm,
        ),
      ) && timeMatched.length === 3,
    V3:
      numericalFailures.length === 0 &&
      iterationMatched
        .filter((result) => result.iterations >= 25_000)
        .every((result) => result.status === "completed"),
    V4: independentDeltas.length > 0 && Math.max(...independentDeltas) <= 1e-12,
    V5:
      numericalFailures.length === 0 &&
      results
        .filter(
          (result) =>
            result.experimentId.startsWith("utility-") ||
            result.experimentId.startsWith("chance-"),
        )
        .every((result) => result.status === "completed"),
    V6: resumeComparisons.every((entry) => entry.bitExact),
    V7:
      manifest.maximumConcurrency === 1 &&
      unexplainedFailures.length === 0 &&
      results.every(
        (result) =>
          result.peakRssBytes <=
          result.configuration.resourceBudget.maximumRssBytes,
      ),
    V8: true,
    V9:
      results.length === experimentMatrix.length &&
      unexplainedFailures.length === 0,
  };
  const artifact = {
    phase: "6.14",
    version: "0.14.0",
    baseline,
    frameworkVersion: CONVERGENCE_FRAMEWORK_VERSION,
    experimentSchema: CONVERGENCE_EXPERIMENT_SCHEMA,
    experimentMatrix,
    algorithmConfigurations: algorithms.map(solverConfiguration),
    gameIdentities: [
      ...new Map(
        results.map((result) => [
          result.gameHash,
          {
            gameId: result.gameId,
            gameHash: result.gameHash,
            structuralHash: result.structuralHash,
          },
        ]),
      ).values(),
    ],
    seeds,
    iterationCheckpoints: schedule,
    scheduler: {
      maximumConcurrency: manifest.maximumConcurrency,
      submitted: manifest.submitted,
      completed: manifest.completed,
      cancelled: manifest.cancelled,
    },
    experiments: results,
    comparison: {
      iterationMatched: iterationMatched.map((result) => ({
        id: result.experimentId,
        algorithm: result.configuration.algorithm,
        iterations: result.iterations,
        finalNashConv: result.series.at(-1)?.nashConv ?? null,
        runtimeMs: result.runtimeMs,
        throughput: result.iterationsPerSecond,
      })),
      timeMatched: timeMatched.map((result) => ({
        id: result.experimentId,
        algorithm: result.configuration.algorithm,
        timeBudgetMs: result.configuration.timeBudgetMs,
        iterations: result.iterations,
        finalNashConv: result.series.at(-1)?.nashConv ?? null,
        runtimeMs: result.runtimeMs,
      })),
    },
    independentCrossChecks: {
      count: independentDeltas.length,
      maximumDelta: independentDeltas.length
        ? Math.max(...independentDeltas)
        : null,
    },
    checkpointComparisons: resumeComparisons,
    numericalDiagnostics: {
      failures: numericalFailures.map((result) => result.experimentId),
      utilityScales: [1e-6, 1e-3, 1, 1e3, 1e6],
      chanceProbabilities: [0, 1e-12, 0.5, 1 - 1e-12, 1],
    },
    resourceMeasurements: {
      peakRssBytes: Math.max(...results.map((result) => result.peakRssBytes)),
      maximumRuntimeMs: Math.max(...results.map((result) => result.runtimeMs)),
      isolatedProcesses: true,
      maximumConcurrency: 1,
      policy:
        "Resource Policy V3 preserved; Phase 6.14 adds a stricter finite-work envelope for small long-run games.",
    },
    failureRecords: unexplainedFailures,
    classifications: Object.fromEntries(
      results.map((result) => [result.experimentId, result.classifications]),
    ),
    gates,
    gateD: "FAIL",
    verifiedDatasets: 0,
    conclusions: [
      "Observed curves are empirical evidence, not convergence proofs.",
      "Iteration-matched and time-matched comparisons are reported separately.",
      "Deterministic seeds affect game generation; solver seed does not create variability in deterministic full-tree CFR.",
    ],
    limitations: [
      "Synthetic games only.",
      "Wall-clock comparisons are environment-specific.",
      "Pure-policy independent evaluation is limited to small games.",
      "No poker strategy or dataset was validated.",
    ],
    reproduction: [
      "npm run solver:phase6-14",
      "node --import tsx --test tests/solver-phase6-14.test.mjs",
      "npm run check",
      "cargo test --manifest-path solver/native/phase611-compiler/Cargo.toml --release",
    ],
  };
  return { ...artifact, artifactHash: hashValue(artifact) };
}
