import { hashValue } from "../../core/stable";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { compileSyntheticGameV2, compilerIdentity } from "../fast-compiler/compiler-v2";
import { compileGenericGame, type GenericCompilerOptions } from "./compiler-v3";
import type { ExtensiveGameProviderV2 } from "./provider-v2";

export type CompilerDispatchResult =
  | { path: "fast-v2"; reason: string; compilation: ReturnType<typeof compileSyntheticGameV2> }
  | { path: "generic-v3"; reason: string; compilation: ReturnType<typeof compileGenericGame> };

export function compileWithDispatch<State, Action>(
  provider: ExtensiveGameProviderV2<State, Action>,
  options: GenericCompilerOptions & { regularConfiguration?: SyntheticGameConfiguration } = {},
): CompilerDispatchResult {
  const fast = provider.capabilities.fastPath;
  if (!fast) {
    return { path: "generic-v3", reason: "provider-did-not-declare-fast-path", compilation: compileGenericGame(provider, options) };
  }
  if (fast.family !== "synthetic-regular-v2" || !options.regularConfiguration) throw new Error("Provider declared an unsupported or incomplete fast-path capability.");
  const expected = hashValue(compilerIdentity(options.regularConfiguration));
  if (fast.configurationHash !== expected) throw new Error("Provider fast-path configuration capability is inconsistent.");
  const compilation = compileSyntheticGameV2(options.regularConfiguration, {
    chunkSize: options.processingChunkSize,
    maximumNodes: options.maximumNodes,
    maximumRuntimeMs: options.maximumRuntimeMs,
    signal: options.signal,
  });
  if (provider.capabilities.exactNodeCount !== compilation.tree.kind.length || provider.semanticIdentity !== compilation.tree.gameHash) {
    throw new Error("Provider fast-path result does not match declared semantic capabilities.");
  }
  return { path: "fast-v2", reason: "validated-synthetic-regular-capability", compilation };
}
