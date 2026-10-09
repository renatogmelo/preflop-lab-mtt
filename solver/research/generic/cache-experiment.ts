import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { hashValue } from "../../core/stable";
import { CompactCfrSolver, compactConfiguration } from "../compact/compact-cfr";
import { SyntheticCompactProvider } from "../compact/synthetic-compact-provider";
import { FAST_COMPILER_VERSION, structuralHashCompactTree } from "../fast-compiler/compiler-v2";
import { createStructuralCacheIdentity } from "../fast-compiler/structural-cache-v1";
import type { IsolatedExperimentRequest, ProcessMemory, StageMetric } from "../resource-safe/types";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { CompiledTreeProvider } from "./compiler-v3";
import { createStructuralCacheIdentityV2, deserializeStructuralCacheV2 } from "./structural-cache-v2";

type Reporter = (metric: StageMetric) => void;

function memory(stage: string): ProcessMemory {
  const usage = process.memoryUsage();
  return {
    timestamp: new Date().toISOString(), stage, rss: usage.rss, heapUsed: usage.heapUsed, heapTotal: usage.heapTotal,
    external: usage.external, arrayBuffers: usage.arrayBuffers, peakRssSelfReported: process.resourceUsage().maxRSS * 1024,
  };
}

export function regularStructuralCacheIdentityV2(configuration: SyntheticGameConfiguration) {
  const provider = new SyntheticCompactProvider(configuration);
  return createStructuralCacheIdentityV2({
    gameId: provider.id,
    gameHash: provider.logicalGameHash,
    compilerVersion: FAST_COMPILER_VERSION,
    configurationHash: hashValue(configuration),
    actionOrdering: "stable-contiguous-numeric-v1",
    utilityModel: "synthetic-zero-sum-terminal-p0-v0.9.0",
  });
}

export async function runGenericCacheExperiment(request: IsolatedExperimentRequest, reporter: Reporter) {
  if (!request.configuration || !request.cachePath || !request.genericCacheFormat || !request.cacheLoadMode) throw new Error("Generic cache profile requires configuration, path, format and load mode.");
  if (!request.preflight || request.preflight.decision !== "ALLOW") throw new Error("STRUCTURAL_LIMIT: cache profile requires Resource Policy V3 authorization.");
  reporter({ stage: "cache-read", status: "started", timestamp: new Date().toISOString(), memory: memory("cache-read") });
  const started = performance.now();
  const readStarted = performance.now();
  const file = await readFile(request.cachePath);
  const readMs = performance.now() - readStarted;
  const decodeStarted = performance.now();
  const loaded = deserializeStructuralCacheV2(file, regularStructuralCacheIdentityV2(request.configuration), {
    mode: request.cacheLoadMode,
    trust: "persisted-local",
    integrityMode: request.cacheIntegrityMode ?? "whole-buffer",
    expectedV1Identity: request.genericCacheFormat === "v1" ? createStructuralCacheIdentity(request.configuration) : undefined,
    fileReadBytes: file.length,
  });
  const decodeMs = performance.now() - decodeStarted;
  const initializationStarted = performance.now();
  const provider = request.genericCacheFormat === "v1"
    ? new SyntheticCompactProvider(request.configuration)
    : new CompiledTreeProvider(loaded.tree);
  const solver = new CompactCfrSolver(provider, loaded.tree, compactConfiguration("dcfr"));
  solver.initialize();
  const initializationMs = performance.now() - initializationStarted;
  const startupMs = performance.now() - started;
  const result = {
    format: request.genericCacheFormat,
    loadMode: request.cacheLoadMode,
    integrityMode: request.cacheIntegrityMode ?? "whole-buffer",
    fileBytes: file.length,
    readMs,
    decodeMs,
    initializationMs,
    startupMs,
    structuralHash: structuralHashCompactTree(loaded.tree),
    copyAccounting: loaded.copyAccounting,
    validationTimings: loaded.timings,
    semanticResultHash: hashValue({ format: request.genericCacheFormat, structuralHash: structuralHashCompactTree(loaded.tree) }),
  };
  reporter({ stage: "cache-read", status: "completed", timestamp: new Date().toISOString(), runtimeMs: startupMs, details: result, memory: memory("cache-read-complete") });
  loaded.lease?.release();
  return result;
}
