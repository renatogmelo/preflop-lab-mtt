import { performance } from "node:perf_hooks";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { compileSyntheticGameV2 } from "./compiler-v2";
import { createStructuralCacheIdentity, loadStructuralCache, writeStructuralCacheAtomic } from "./structural-cache-v1";

export async function loadOrCompileStructuralTopology(options: {
  path: string;
  fallbackPath?: string;
  configuration: SyntheticGameConfiguration;
  chunkSize?: number;
  maximumNodes?: number;
}) {
  const identity = createStructuralCacheIdentity(options.configuration);
  const loadStarted = performance.now();
  const loaded = await loadStructuralCache(options.path, identity);
  const loadMs = performance.now() - loadStarted;
  if (loaded.hit && loaded.tree) return { source: "cache" as const, tree: loaded.tree, loadMs, compileMs: 0, writeMs: 0, cache: loaded };
  const target = loaded.reason === "not-found" ? options.path : options.fallbackPath;
  if (!target) throw new Error(`Structural cache ${loaded.reason} requires a distinct content-addressed fallback path.`);
  const compileStarted = performance.now();
  const compiled = compileSyntheticGameV2(options.configuration, { chunkSize: options.chunkSize, maximumNodes: options.maximumNodes });
  const compileMs = performance.now() - compileStarted;
  const writeStarted = performance.now();
  const written = await writeStructuralCacheAtomic(target, compiled.tree, identity);
  const writeMs = performance.now() - writeStarted;
  return { source: "compiled" as const, tree: compiled.tree, loadMs, compileMs, writeMs, missReason: loaded.reason, target, cache: written };
}