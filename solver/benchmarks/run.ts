import { performance } from "node:perf_hooks";
import { CfrPlus, Dcfr, VanillaCfr } from "../algorithms/cfr";
import { KuhnPoker } from "../games/kuhn";

export type BenchmarkEntry = {
  algorithm: string;
  iterations: number;
  runtimeMs: number;
  iterationsPerSecond: number;
  nodesPerSecond: number;
  infosets: number;
  exploitability: number | null;
  nashConv: number | null;
  heapDeltaBytes: number;
  checkpointBytes: number;
};

export function runKuhnBenchmarks(iterations = 20_000): BenchmarkEntry[] {
  const game = new KuhnPoker();
  const solvers = [
    new VanillaCfr(game, { seed: 7 }),
    new CfrPlus(game, { seed: 7, cfrPlusAveragingDelay: 100 }),
    new Dcfr(game, { seed: 7, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } }),
  ];
  return solvers.map((solver) => {
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const result = solver.solve({ maxIterations: iterations, metricInterval: iterations });
    const runtimeMs = performance.now() - started;
    const heapAfter = process.memoryUsage().heapUsed;
    return {
      algorithm: solver.configuration.algorithm,
      iterations,
      runtimeMs,
      iterationsPerSecond: iterations / (runtimeMs / 1000),
      nodesPerSecond: result.metrics.nodesVisited / (runtimeMs / 1000),
      infosets: result.metrics.infosets,
      exploitability: result.metrics.exploitability,
      nashConv: result.metrics.nashConv,
      heapDeltaBytes: Math.max(0, heapAfter - heapBefore),
      checkpointBytes: Buffer.byteLength(JSON.stringify(solver.checkpoint())),
    };
  });
}
