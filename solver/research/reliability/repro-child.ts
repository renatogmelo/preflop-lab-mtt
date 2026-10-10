import type { AlgorithmName } from "../../core/types";
import { createReliabilitySolver } from "./runtime";

const prefix = "PHASE615REPRO:";
const encoded = process.argv[2];
if (!encoded) throw new Error("Missing reproducibility payload.");
const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { algorithm: AlgorithmName; iterations: number };
const { solver, structuralHash } = createReliabilitySolver(input.algorithm);
solver.initialize();
while (solver.iteration < input.iterations) solver.iterate();
const metric = solver.measure();
process.stdout.write(`${prefix}${JSON.stringify({
  configurationHash: solver.configurationHash,
  structuralHash,
  initialStateHash: createReliabilitySolver(input.algorithm).solver.stateHash,
  finalStateHash: solver.stateHash,
  regrets: Array.from(solver.regrets),
  strategySums: Array.from(solver.strategySums),
  averageStrategy: Array.from(solver.averageStrategyArray()),
  ev: metric.utilityP0,
  nashConv: metric.nashConv,
})}\n`);
