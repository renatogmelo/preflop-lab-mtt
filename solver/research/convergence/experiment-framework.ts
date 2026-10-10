import { cpus, platform, release } from "node:os";
import { performance } from "node:perf_hooks";
import { hashValue } from "../../core/stable";
import type { BehavioralStrategy } from "../../core/types";
import { COMPACT_CFR_VERSION, CompactCfrSolver } from "../compact/compact-cfr";
import { strategyArrayProbability } from "../compact/compact-tree";
import { compileGenericGame } from "../generic/compiler-v3";
import { evaluateGenericCompactGame } from "../generic/generic-evaluation";
import { scaleProviderUtilities } from "../generic/metamorphic-v2";
import type { ExtensiveGameProviderV2 } from "../generic/provider-v2";
import {
  AsymmetricChanceProvider,
  IrregularBranchingProvider,
  VariableDepthHiddenInformationProvider,
} from "../generic/synthetic-families";
import {
  chanceStressProvider,
  controlledRandomGame,
  hiddenInformationProvider,
  matchingPenniesProvider,
  rockPaperScissorsProvider,
} from "../mathematical/analytical-games";
import { evaluateIndependentBestResponses } from "../mathematical/independent-evaluation";
import {
  deserializeBinaryCheckpointV5,
  restoreBinaryCheckpointV5,
  serializeBinaryCheckpointV5,
} from "../resource-safe/binary-checkpoint-v5";
import { RESOURCE_POLICY_V3_VERSION } from "../resource-safe/resource-policy-v3";
import {
  detectPlateau,
  fitEmpiricalRate,
  numericalDiagnostics,
  regretStatistics,
} from "./diagnostics";
import {
  CONVERGENCE_EXPERIMENT_SCHEMA,
  CONVERGENCE_FRAMEWORK_VERSION,
  type ConvergenceClassification,
  type ConvergenceExperimentConfiguration,
  type ConvergenceExperimentResult,
  type ConvergenceGameConfiguration,
  type ConvergencePointV1,
} from "./types";

export const DEFAULT_EVALUATION_SCHEDULE = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 25_000,
  50_000,
];

export function validateExperimentConfiguration(
  configuration: ConvergenceExperimentConfiguration,
) {
  if (configuration.schema !== CONVERGENCE_EXPERIMENT_SCHEMA)
    throw new Error("Unsupported convergence experiment schema.");
  if (!configuration.experimentId)
    throw new Error("Experiment ID is required.");
  if (
    !Number.isInteger(configuration.iterationBudget) ||
    configuration.iterationBudget < 1
  )
    throw new Error("Iteration budget must be a positive integer.");
  if (
    configuration.comparisonMode === "time-matched" &&
    (!configuration.timeBudgetMs || configuration.timeBudgetMs <= 0)
  )
    throw new Error("Time-matched experiment requires a positive time budget.");
  if (
    !Number.isFinite(configuration.utilityScale) ||
    configuration.utilityScale <= 0
  )
    throw new Error("Utility scale must be positive and finite.");
  if (
    configuration.evaluationSchedule.some(
      (value, index, values) =>
        !Number.isInteger(value) ||
        value < 1 ||
        (index > 0 && value <= values[index - 1]),
    )
  )
    throw new Error(
      "Evaluation schedule must be strictly increasing positive integers.",
    );
  if (
    configuration.checkpointSchedule.some(
      (value) =>
        !Number.isInteger(value) ||
        value < 1 ||
        value > configuration.iterationBudget,
    )
  )
    throw new Error("Checkpoint schedule is invalid.");
  const budget = configuration.resourceBudget;
  if (
    Object.values(budget).some((value) => !Number.isFinite(value) || value <= 0)
  )
    throw new Error("Resource budget values must be positive and finite.");
  if (configuration.solverConfiguration.algorithm !== configuration.algorithm)
    throw new Error("Solver configuration algorithm mismatch.");
  return true;
}

export function createConvergenceProvider(
  game: ConvergenceGameConfiguration,
): ExtensiveGameProviderV2<unknown, unknown> {
  if (game.family === "matching-pennies")
    return matchingPenniesProvider() as ExtensiveGameProviderV2<
      unknown,
      unknown
    >;
  if (game.family === "rock-paper-scissors")
    return rockPaperScissorsProvider() as ExtensiveGameProviderV2<
      unknown,
      unknown
    >;
  if (game.family === "hidden-information")
    return hiddenInformationProvider() as ExtensiveGameProviderV2<
      unknown,
      unknown
    >;
  if (game.family === "variable-depth-hidden")
    return new VariableDepthHiddenInformationProvider() as ExtensiveGameProviderV2<
      unknown,
      unknown
    >;
  if (game.family === "asymmetric-chance")
    return new AsymmetricChanceProvider() as ExtensiveGameProviderV2<
      unknown,
      unknown
    >;
  if (game.family === "controlled-random")
    return controlledRandomGame(game.seed) as ExtensiveGameProviderV2<
      unknown,
      unknown
    >;
  if (game.family === "chance-stress")
    return chanceStressProvider(game.probability) as ExtensiveGameProviderV2<
      unknown,
      unknown
    >;
  if (game.family === "irregular-branching")
    return new IrregularBranchingProvider({
      id: `phase614-irregular-${game.seed}`,
      seed: game.seed,
      maximumDepth: game.maximumDepth,
      minimumTerminalDepth: game.minimumTerminalDepth,
      maximumBranching: game.maximumBranching,
    }) as ExtensiveGameProviderV2<unknown, unknown>;
  throw new Error("Unsupported convergence game family.");
}

function semanticStrategy<State, Action>(
  provider: ExtensiveGameProviderV2<State, Action>,
  informationSetKeys: readonly string[],
  values: Float64Array,
  offsets: Uint32Array,
): BehavioralStrategy {
  const actionKeys = new Map<string, string[]>();
  const visit = (state: State) => {
    const actor = provider.actor(state);
    if (actor === null) return;
    const actions = provider.legalActions(state);
    if (actor !== "chance") {
      const key = provider.informationSetKey(state);
      if (!actionKeys.has(key))
        actionKeys.set(
          key,
          actions.map((action) => provider.actionKey(state, action)),
        );
    }
    for (const action of actions) visit(provider.transition(state, action));
  };
  visit(provider.initialState());
  return Object.fromEntries(
    informationSetKeys.map((key, info) => [
      key,
      Object.fromEntries(
        actionKeys
          .get(key)!
          .map((action, index) => [action, values[offsets[info] + index]]),
      ),
    ]),
  );
}

function environment() {
  const cpu = cpus()[0];
  return {
    node: process.version,
    platform: platform(),
    osRelease: release(),
    architecture: process.arch,
    cpu: cpu
      ? { model: cpu.model, speedMHz: cpu.speed, logicalCount: cpus().length }
      : null,
    execArgv: process.execArgv,
    resourcePolicy: RESOURCE_POLICY_V3_VERSION,
  };
}

function initialBias(
  solver: CompactCfrSolver,
  mode: ConvergenceExperimentConfiguration["initialState"],
) {
  if (mode === "zero") return;
  for (let index = 0; index < solver.regrets.length; index += 1)
    solver.regrets[index] = index % 2 === 0 ? 1e-3 : -1e-3;
}

export async function runConvergenceExperiment(
  configuration: ConvergenceExperimentConfiguration,
  signal: AbortSignal = new AbortController().signal,
): Promise<ConvergenceExperimentResult> {
  validateExperimentConfiguration(configuration);
  const rawProvider = createConvergenceProvider(configuration.game);
  const provider =
    configuration.utilityScale === 1
      ? rawProvider
      : scaleProviderUtilities(rawProvider, configuration.utilityScale);
  const compilation = compileGenericGame(provider, {
    maximumNodes: configuration.resourceBudget.maximumNodes,
  });
  const estimatedWork =
    compilation.tree.kind.length * configuration.iterationBudget * 2;
  if (estimatedWork > configuration.resourceBudget.maximumWorkUnits) {
    return {
      schema: CONVERGENCE_EXPERIMENT_SCHEMA,
      frameworkVersion: CONVERGENCE_FRAMEWORK_VERSION,
      experimentId: configuration.experimentId,
      configuration,
      gameId: provider.id,
      gameHash: provider.semanticIdentity,
      structuralHash: compilation.structuralHash,
      algorithmVersion: COMPACT_CFR_VERSION,
      environment: environment(),
      status: "budget-limited",
      stopReason: "work-budget",
      iterations: 0,
      runtimeMs: 0,
      peakRssBytes: process.memoryUsage().rss,
      iterationsPerSecond: 0,
      series: [],
      checkpointHashes: [],
      classifications: ["BUDGET LIMITED"],
      plateau: detectPlateau([]),
      empiricalRate: fitEmpiricalRate([]),
      finalStateHash: "",
      failureReason: `estimated work ${estimatedWork} exceeds ${configuration.resourceBudget.maximumWorkUnits}`,
    };
  }
  let solver = new CompactCfrSolver(
    compilation.provider,
    compilation.tree,
    configuration.solverConfiguration,
  );
  solver.initialize();
  initialBias(solver, configuration.initialState);
  const started = performance.now();
  let traversalMs = 0;
  let evaluationMs = 0;
  let checkpointMs = 0;
  let peakRss = process.memoryUsage().rss;
  const series: ConvergencePointV1[] = [];
  const checkpointHashes: string[] = [];
  const evaluationSet = new Set(
    configuration.evaluationSchedule.filter(
      (value) => value <= configuration.iterationBudget,
    ),
  );
  const checkpointSet = new Set(configuration.checkpointSchedule);
  let status: ConvergenceExperimentResult["status"] = "completed";
  let stopReason: ConvergenceExperimentResult["stopReason"] =
    "iteration-budget";
  let failureReason: string | null = null;

  const evaluate = () => {
    const evaluationStarted = performance.now();
    const average = solver.averageStrategyArray();
    const current = solver.currentStrategyArray();
    const production = evaluateGenericCompactGame(
      compilation.tree,
      strategyArrayProbability(compilation.tree, average),
    );
    let independentNashConv: number | null = null;
    let independentDelta: number | null = null;
    try {
      const strategy = semanticStrategy(
        provider,
        compilation.informationSetKeys,
        average,
        compilation.tree.informationSetActionOffset,
      );
      const independent = evaluateIndependentBestResponses(
        provider,
        strategy,
        configuration.resourceBudget.maximumPurePolicies,
      );
      independentNashConv = independent.nashConv;
      independentDelta = Math.abs(independent.nashConv - production.nashConv);
    } catch (error) {
      if (!(error instanceof Error) || !/budget exceeded/.test(error.message))
        throw error;
    }
    const numerical = numericalDiagnostics(
      compilation.tree,
      solver.regrets,
      solver.strategySums,
      current,
      average,
      production.utilities,
    );
    if (production.nashConv < -1e-12)
      numerical.anomalies.push("negative-nashconv");
    evaluationMs += performance.now() - evaluationStarted;
    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss);
    const point: ConvergencePointV1 = {
      iteration: solver.iteration,
      elapsedMs: performance.now() - started,
      traversalMs,
      evaluationMs,
      checkpointMs,
      nashConv: production.nashConv,
      exploitability: production.exploitability,
      utilities: production.utilities,
      bestResponseValues: production.bestResponseValues,
      independentNashConv,
      independentDelta,
      averageStrategyHash: hashValue(Array.from(average)),
      regret: regretStatistics(
        solver.regrets,
        solver.iteration,
        configuration.utilityScale,
      ),
      numerical,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    };
    series.push(point);
    return point;
  };

  evaluate();
  while (solver.iteration < configuration.iterationBudget) {
    if (signal.aborted) {
      status = "cancelled";
      stopReason = "cancelled";
      break;
    }
    const elapsed = performance.now() - started;
    if (
      configuration.comparisonMode === "time-matched" &&
      elapsed >= configuration.timeBudgetMs!
    ) {
      status = "budget-limited";
      stopReason = "runtime-budget";
      break;
    }
    if (elapsed >= configuration.resourceBudget.maximumRuntimeMs) {
      status = "budget-limited";
      stopReason = "runtime-budget";
      break;
    }
    const traversalStarted = performance.now();
    solver.iterate();
    traversalMs += performance.now() - traversalStarted;
    if (checkpointSet.has(solver.iteration)) {
      const checkpointStarted = performance.now();
      const serialized = serializeBinaryCheckpointV5(solver);
      checkpointHashes.push(serialized.semanticStateHash);
      const restored = new CompactCfrSolver(
        compilation.provider,
        compilation.tree,
        configuration.solverConfiguration,
      );
      restoreBinaryCheckpointV5(
        restored,
        deserializeBinaryCheckpointV5(serialized.buffer),
      );
      solver = restored;
      checkpointMs += performance.now() - checkpointStarted;
    }
    if (evaluationSet.has(solver.iteration)) {
      const point = evaluate();
      if (point.numerical.anomalies.length) {
        status = "numerical-failure";
        stopReason = "numerical-failure";
        failureReason = point.numerical.anomalies.join(",");
        break;
      }
    }
    const rss = process.memoryUsage().rss;
    peakRss = Math.max(peakRss, rss);
    if (rss > configuration.resourceBudget.maximumRssBytes) {
      status = "budget-limited";
      stopReason = "memory-budget";
      break;
    }
  }
  if (series.at(-1)?.iteration !== solver.iteration) evaluate();
  const runtimeMs = performance.now() - started;
  const plateau = detectPlateau(series.map((point) => point.nashConv));
  const empiricalRate = fitEmpiricalRate(series);
  const classifications = new Set<ConvergenceClassification>();
  if (
    series.some(
      (point) =>
        point.independentDelta !== null && point.independentDelta <= 1e-12,
    )
  )
    classifications.add("ANALYTICALLY CROSS-CHECKED");
  if (status === "numerical-failure")
    classifications.add("NUMERICAL INSTABILITY");
  else if (status === "budget-limited") classifications.add("BUDGET LIMITED");
  if (
    plateau.classification === "plateau" ||
    plateau.classification === "oscillation"
  )
    classifications.add("OBSERVED PLATEAU");
  else if (series.length >= 2 && series.at(-1)!.nashConv < series[0].nashConv)
    classifications.add("OBSERVED IMPROVEMENT");
  else classifications.add("INCONCLUSIVE");
  return {
    schema: CONVERGENCE_EXPERIMENT_SCHEMA,
    frameworkVersion: CONVERGENCE_FRAMEWORK_VERSION,
    experimentId: configuration.experimentId,
    configuration,
    gameId: provider.id,
    gameHash: provider.semanticIdentity,
    structuralHash: compilation.structuralHash,
    algorithmVersion: COMPACT_CFR_VERSION,
    environment: environment(),
    status,
    stopReason,
    iterations: solver.iteration,
    runtimeMs,
    peakRssBytes: peakRss,
    iterationsPerSecond: solver.iteration / Math.max(1e-9, traversalMs / 1_000),
    series,
    checkpointHashes,
    classifications: [...classifications],
    plateau,
    empiricalRate,
    finalStateHash: solver.stateHash,
    failureReason,
  };
}
