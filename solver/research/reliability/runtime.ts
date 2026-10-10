import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AlgorithmName } from "../../core/types";
import { COMPACT_CFR_VERSION, CompactCfrSolver, compactConfiguration } from "../compact/compact-cfr";
import { CompiledTreeProvider } from "../generic/compiler-v3";
import { compileGenericGame } from "../generic/compiler-v3";
import { VariableDepthHiddenInformationProvider } from "../generic/synthetic-families";
import { structuralHashCompactTree } from "../fast-compiler/compiler-v2";
import { createRunManifest, moveRunState, persistRunManifest } from "./manifest";

export function createReliabilitySolver(algorithm: AlgorithmName = "dcfr") {
  const provider = new VariableDepthHiddenInformationProvider();
  const compilation = compileGenericGame(provider);
  const compiledProvider = new CompiledTreeProvider(compilation.tree);
  const solver = new CompactCfrSolver(compiledProvider, compilation.tree, compactConfiguration(algorithm));
  return { solver, tree: compilation.tree, structuralHash: structuralHashCompactTree(compilation.tree) };
}

export async function initializeReliabilityRun(input: {
  runDirectory: string;
  runId: string;
  experimentId: string;
  commitSha: string;
  algorithm?: AlgorithmName;
  iterationTarget: number;
  maximumRssBytes?: number;
  maximumRuntimeMs?: number;
}) {
  await mkdir(input.runDirectory, { recursive: true });
  const { solver, tree, structuralHash } = createReliabilitySolver(input.algorithm);
  solver.initialize();
  let manifest = createRunManifest({
    runId: input.runId,
    experimentId: input.experimentId,
    commitSha: input.commitSha,
    algorithm: solver.configuration.algorithm,
    algorithmVersion: COMPACT_CFR_VERSION,
    algorithmParameters: solver.configuration,
    providerIdentity: tree.gameHash,
    structuralHash,
    cacheVersion: "structural-cache-v2.0.0",
    checkpointVersion: 5,
    iterationTarget: input.iterationTarget,
    resourceBudgets: {
      maximumRssBytes: input.maximumRssBytes ?? 256 * 1024 * 1024,
      maximumRuntimeMs: input.maximumRuntimeMs ?? 10_000,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      processIsolation: true,
    },
  });
  manifest = moveRunState(manifest, "PREFLIGHT", "preflight-started");
  manifest = moveRunState(manifest, "READY", "preflight-allowed");
  manifest = moveRunState(manifest, "RUNNING", "runner-started");
  await persistRunManifest(join(input.runDirectory, "manifest.json"), manifest);
  return { solver, tree, manifest, structuralHash };
}
