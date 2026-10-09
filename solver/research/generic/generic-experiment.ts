import { performance } from "node:perf_hooks";
import { hashValue } from "../../core/stable";
import type { ProcessMemory, IsolatedExperimentRequest, StageMetric } from "../resource-safe/types";
import { compileGenericGame } from "./compiler-v3";
import { SCALE_CONFIGURATIONS } from "../scalability/experiment-runner";
import { createGenericFamily, regularSyntheticProviderV2, type GenericFamilyName } from "./synthetic-families";

type Reporter = (metric: StageMetric) => void;

function memory(stage: string): ProcessMemory {
  const usage = process.memoryUsage();
  return {
    timestamp: new Date().toISOString(), stage, rss: usage.rss, heapUsed: usage.heapUsed, heapTotal: usage.heapTotal,
    external: usage.external, arrayBuffers: usage.arrayBuffers, peakRssSelfReported: process.resourceUsage().maxRSS * 1024,
  };
}

export async function runGenericCompilerExperiment(request: IsolatedExperimentRequest, reporter: Reporter) {
  if (!request.genericFamily || request.genericScale === undefined || !request.genericGrowthPolicy) throw new Error("Generic compiler profile requires family, scale and growth policy.");
  if (!request.preflight || request.preflight.decision !== "ALLOW") throw new Error("STRUCTURAL_LIMIT: generic compiler requires Resource Policy V3 authorization.");
  const provider = request.genericFamily === "regular-synthetic"
    ? regularSyntheticProviderV2(SCALE_CONFIGURATIONS[request.genericScale]?.configuration ?? (() => { throw new Error("Unknown regular synthetic scale."); })())
    : createGenericFamily(request.genericFamily as GenericFamilyName, request.genericScale);
  reporter({ stage: "generic-preflight", status: "completed", timestamp: new Date().toISOString(), details: { authorizedNodeBudget: request.preflight.estimate.nodes, family: request.genericFamily }, memory: memory("generic-preflight") });
  const started = performance.now();
  reporter({ stage: "generic-compilation", status: "started", timestamp: new Date().toISOString(), memory: memory("generic-compilation") });
  let compilation;
  try {
    compilation = compileGenericGame(provider, {
      growthPolicy: request.genericGrowthPolicy,
    initialCapacity: request.genericInitialCapacity,
    segmentSize: request.chunkSize,
    processingChunkSize: request.chunkSize,
    maximumNodes: request.preflight.estimate.nodes,
    maximumRuntimeMs: request.limits.maximumRuntimeMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/budget|maximum nodes|depth|runtime/i.test(message)) throw new Error(`STRUCTURAL_LIMIT: ${message}`, { cause: error });
    throw error;
  }
  const runtimeMs = performance.now() - started;
  reporter({ stage: "generic-compilation", status: "completed", timestamp: new Date().toISOString(), runtimeMs, details: { nodes: compilation.tree.kind.length, informationSets: compilation.tree.informationSetActionCount.length, structuralHash: compilation.structuralHash, profile: compilation.profile }, memory: memory("generic-compilation-complete") });
  return {
    family: request.genericFamily,
    scale: request.genericScale,
    growthPolicy: request.genericGrowthPolicy,
    nodes: compilation.tree.kind.length,
    informationSets: compilation.tree.informationSetActionCount.length,
    maximumDepth: compilation.tree.maximumDepth,
    structuralHash: compilation.structuralHash,
    profile: compilation.profile,
    semanticResultHash: hashValue({ family: request.genericFamily, scale: request.genericScale, structuralHash: compilation.structuralHash }),
  };
}
