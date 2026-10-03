import { resolve } from "node:path";
import { CfrPlus, Dcfr, VanillaCfr } from "../algorithms/cfr";
import { runKuhnBenchmarks } from "../benchmarks/run";
import { EquityApproximationProvider } from "../continuation/provider";
import { hashValue } from "../core/stable";
import type { SolverCheckpoint, SolverConfiguration } from "../core/types";
import { SOLVER_NAME, SOLVER_VERSION } from "../core/version";
import { exportHoldemPocDataset } from "../export/strategy-dataset";
import { HoldemPreflopPocSolver, type HoldemPocArtifact, type HoldemPocCheckpoint, type HoldemPocConfiguration } from "../game/holdem-poc";
import { KuhnPoker } from "../games/kuhn";
import { readJson, saveCheckpoint, writeJson } from "../storage/files";
import { validateHoldemPoc, validateKuhnSolve } from "../validation/report";

type KuhnConfig = {
  game: "kuhn";
  algorithm: SolverConfiguration["algorithm"];
  seed: number;
  iterations: number;
  metricInterval: number;
  targetExploitability?: number;
  output: string;
  checkpoint?: string;
};

type HoldemConfigFile = HoldemPocConfiguration & {
  game: "holdem-poc";
  output: string;
  datasetOutput: string;
  validationOutput: string;
  checkpoint?: string;
};

type SolveConfig = KuhnConfig | HoldemConfigFile;

function makeKuhnSolver(config: KuhnConfig) {
  const game = new KuhnPoker();
  if (config.algorithm === "vanilla-cfr") return new VanillaCfr(game, { seed: config.seed });
  if (config.algorithm === "cfr-plus") return new CfrPlus(game, { seed: config.seed, cfrPlusAveragingDelay: 100 });
  return new Dcfr(game, { seed: config.seed, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } });
}

async function solveKuhn(config: KuhnConfig) {
  const solver = makeKuhnSolver(config);
  const result = solver.solve({
    maxIterations: config.iterations,
    metricInterval: config.metricInterval,
    targetExploitability: config.targetExploitability,
  });
  const validation = validateKuhnSolve(solver.solveId, result.strategy, result.metrics);
  const artifact = {
    schemaVersion: 1,
    solverName: SOLVER_NAME,
    solverVersion: SOLVER_VERSION,
    solveId: solver.solveId,
    gameDefinitionHash: solver.gameDefinitionHash,
    gameDefinition: new KuhnPoker().definition,
    configuration: solver.configuration,
    iterations: result.metrics.iteration,
    infosets: result.metrics.infosets,
    runtimeMs: result.metrics.elapsedMs,
    estimatedMemoryBytes: Buffer.byteLength(JSON.stringify(solver.checkpoint())),
    convergenceMetrics: result.metrics,
    strategy: result.strategy,
    validation,
  };
  await writeJson(resolve(config.output), artifact);
  if (config.checkpoint) await saveCheckpoint(resolve(config.checkpoint), solver.checkpoint());
  return artifact;
}

async function solveHoldem(config: HoldemConfigFile) {
  const solver = new HoldemPreflopPocSolver(config, new EquityApproximationProvider());
  const artifact = solver.solve();
  const validation = validateHoldemPoc(artifact);
  const dataset = exportHoldemPocDataset(artifact, validation);
  await writeJson(resolve(config.output), artifact);
  await writeJson(resolve(config.validationOutput), validation);
  await writeJson(resolve(config.datasetOutput), dataset);
  if (config.checkpoint) await saveCheckpoint(resolve(config.checkpoint), solver.checkpoint());
  return {
    solveId: artifact.solveId,
    iterations: artifact.iterations,
    infosets: artifact.infosets,
    runtimeMs: artifact.runtimeMs,
    strategyDelta: artifact.convergenceHistory.at(-1)?.strategyDelta ?? null,
    validation,
    datasetId: dataset.metadata.id,
  };
}

async function solve(configPath: string) {
  const config = await readJson<SolveConfig>(resolve(configPath));
  return config.game === "kuhn" ? solveKuhn(config) : solveHoldem(config);
}

async function resume(checkpointPath: string, iterations: number, outputPath: string) {
  const checkpoint = await readJson<SolverCheckpoint | HoldemPocCheckpoint>(resolve(checkpointPath));
  if ("gameId" in checkpoint) {
    const config: KuhnConfig = {
      game: "kuhn",
      algorithm: checkpoint.configuration.algorithm,
      seed: checkpoint.configuration.seed,
      iterations,
      metricInterval: Math.max(1, Math.floor(iterations / 10)),
      output: outputPath,
    };
    const solver = makeKuhnSolver(config);
    solver.restore(checkpoint);
    const result = solver.solve({ maxIterations: iterations, metricInterval: config.metricInterval });
    await writeJson(resolve(outputPath), {
      solverName: SOLVER_NAME,
      solverVersion: SOLVER_VERSION,
      solveId: solver.solveId,
      strategy: result.strategy,
      metrics: result.metrics,
      validation: validateKuhnSolve(solver.solveId, result.strategy, result.metrics),
    });
    return result.metrics;
  }
  throw new Error("Hold'em resume requires the original solve config; use solve with its saved checkpoint in the programmatic API.");
}

async function reproduce(path: string) {
  const artifact = await readJson<Record<string, unknown>>(resolve(path));
  if (artifact.gameDefinition && (artifact.gameDefinition as { game?: string }).game === "Kuhn Poker") {
    const configuration = artifact.configuration as SolverConfiguration;
    const originalIterations = artifact.iterations as number;
    const config: KuhnConfig = {
      game: "kuhn",
      algorithm: configuration.algorithm,
      seed: configuration.seed,
      iterations: originalIterations,
      metricInterval: originalIterations,
      output: resolve(path) + ".reproduced.json",
    };
    const reproduced = await solveKuhn(config);
    return { match: hashValue(reproduced.strategy) === hashValue(artifact.strategy), solveId: reproduced.solveId };
  }
  const holdem = artifact as unknown as HoldemPocArtifact;
  const solver = new HoldemPreflopPocSolver(holdem.configuration, new EquityApproximationProvider());
  const reproduced = solver.solve();
  return {
    match: hashValue(reproduced.rawStrategy) === hashValue(holdem.rawStrategy),
    solveId: reproduced.solveId,
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  let result: unknown;
  if (command === "solve" && args[0]) result = await solve(args[0]);
  else if (command === "resume" && args[0] && args[1] && args[2]) result = await resume(args[0], Number(args[1]), args[2]);
  else if (command === "inspect" && args[0]) {
    const artifact = await readJson<Record<string, unknown>>(resolve(args[0]));
    result = Object.fromEntries(["solverName", "solverVersion", "solveId", "iterations", "infosets", "runtimeMs", "validation"].map((key) => [key, artifact[key]]));
  } else if (command === "validate" && args[0]) {
    const artifact = await readJson<Record<string, unknown>>(resolve(args[0]));
    result = artifact.validation ?? validateHoldemPoc(artifact as unknown as HoldemPocArtifact);
  } else if (command === "reproduce" && args[0]) result = await reproduce(args[0]);
  else if (command === "benchmark") result = runKuhnBenchmarks(args[0] ? Number(args[0]) : 20_000);
  else {
    throw new Error("Usage: preflop-solver solve <config> | resume <checkpoint> <iterations> <output> | inspect <artifact> | validate <artifact> | reproduce <artifact> | benchmark [iterations]");
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
