import { performance } from "node:perf_hooks";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { preflightV3 } from "../resource-safe/resource-policy-v3";
import { compileWithDispatch } from "../generic/compiler-dispatch";
import { evaluateIndependentOracle } from "../generic/independent-oracle";
import { evaluateGenericCompactGame } from "../generic/generic-evaluation";
import { strategyArrayProbability } from "../compact/compact-tree";
import {
  createBuiltinProvider,
  validateProviderContract,
  type ExtensiveGameProviderV3,
} from "./provider-v3";
import type { ResearchExperimentConfigurationV1 } from "./contracts";
import { ResearchEngineError } from "./errors";

function regularConfiguration(configuration: ResearchExperimentConfigurationV1): SyntheticGameConfiguration | undefined {
  if (configuration.provider.id !== "regular-synthetic") return undefined;
  const values = configuration.provider.parameters ?? {};
  return {
    id: typeof values.id === "string" ? values.id : "research-regular",
    players: 2,
    privateStates: typeof values.privateStates === "number" ? values.privateStates : 2,
    publicSignals: typeof values.publicSignals === "number" ? values.publicSignals : 2,
    stages: typeof values.stages === "number" ? values.stages : 2,
    actionsPerDecision: typeof values.actionsPerDecision === "number" ? values.actionsPerDecision : 2,
    seed: typeof values.seed === "number" ? values.seed : 7000,
    zeroSum: true,
    perfectRecall: true,
    dependencyComplexity: values.dependencyComplexity === "independent" || values.dependencyComplexity === "stage-coupled"
      ? values.dependencyComplexity
      : "history-coupled",
  };
}

export type InternalCompilation = {
  provider: ExtensiveGameProviderV3<unknown, unknown>;
  tree: ReturnType<typeof compileWithDispatch>["compilation"]["tree"];
  compiler: { id: "compiler-v2" | "compiler-v3"; version: string; reason: string; structuralHash: string };
  profile: Readonly<Record<string, unknown>>;
  preflight: Readonly<Record<string, unknown>>;
};

export function preflightExperiment(configuration: ResearchExperimentConfigurationV1) {
  const regular = regularConfiguration(configuration);
  if (regular) {
    const result = preflightV3({
      configuration: regular,
      tier: configuration.budget.tier,
      iterations: configuration.budget.iterations,
      explicitLargeScaleAuthorization: configuration.budget.explicitLargeScaleAuthorization ?? false,
    });
    if (result.decision !== "ALLOW") {
      throw new ResearchEngineError("RESOURCE_LIMIT", "Resource Policy V3 rejected the experiment before compilation.", {
        decision: result.decision,
        reasons: result.reasons,
        estimate: result.estimate,
      });
    }
    if (result.estimate.estimatedPeakBytes > configuration.budget.memoryBytes || result.estimate.estimatedRuntimeMs > configuration.budget.runtimeMs) {
      throw new ResearchEngineError("RESOURCE_LIMIT", "Experiment-specific resource budget is smaller than the preflight estimate.", {
        estimate: result.estimate,
        budget: configuration.budget,
      });
    }
    return result;
  }
  if (configuration.budget.iterations > 20) {
    throw new ResearchEngineError("RESOURCE_LIMIT", "Generic Tier 0 exceeds the 20-iteration Resource Policy V3 limit.", {
      iterations: configuration.budget.iterations,
    });
  }
  if (configuration.budget.tier !== "tier0") {
    throw new ResearchEngineError("RESOURCE_LIMIT", "Generic providers are restricted to Tier 0 in Public API V1 without a persisted calibration contract.", {
      tier: configuration.budget.tier,
    });
  }
  return {
    version: "resource-policy-v3-generic-adapter-v1",
    decision: "ALLOW",
    reasons: ["provider-structural-limits", "tier0-public-api"],
    limits: {
      maximumNodes: 250_000,
      maximumRuntimeMs: Math.min(configuration.budget.runtimeMs, 30_000),
      maximumMemoryBytes: Math.min(configuration.budget.memoryBytes, 768 * 1024 * 1024),
      maximumIterations: 20,
    },
  } as const;
}

export function compileExperiment(configuration: ResearchExperimentConfigurationV1): InternalCompilation {
  const preflight = preflightExperiment(configuration);
  const provider = createBuiltinProvider(configuration.provider);
  const providerValidation = validateProviderContract(provider);
  if (!providerValidation.valid) throw new ResearchEngineError("VALIDATION_ERROR", "Provider V3 contract validation failed.", { issues: providerValidation.issues });
  const regular = regularConfiguration(configuration);
  const started = performance.now();
  try {
    const dispatch = compileWithDispatch(provider, {
      regularConfiguration: regular,
      maximumNodes: Math.min(provider.structuralLimits.maximumNodes, 250_000),
      maximumDepth: provider.structuralLimits.maximumDepth,
      maximumRuntimeMs: Math.min(configuration.budget.runtimeMs, 30_000),
      processingChunkSize: 4096,
    });
    const compilation = dispatch.compilation;
    return {
      provider,
      tree: compilation.tree,
      compiler: {
        id: dispatch.path === "fast-v2" ? "compiler-v2" : "compiler-v3",
        version: dispatch.path === "fast-v2" ? "fast-compiler-v2.0.0" : compilation.compilerVersion,
        reason: dispatch.reason,
        structuralHash: compilation.structuralHash,
      },
      profile: Object.freeze({
        runtimeMs: performance.now() - started,
        nodes: compilation.tree.kind.length,
        informationSets: compilation.tree.informationSetActionCount.length,
        topologyBytes: compilation.topologyBytes,
        registryBytes: compilation.registryBytes,
      }),
      preflight,
    };
  } catch (error) {
    if (error instanceof ResearchEngineError) throw error;
    throw new ResearchEngineError("COMPILATION_ERROR", error instanceof Error ? error.message : String(error), {
      provider: provider.identity,
    }, false, error instanceof Error ? { cause: error } : undefined);
  }
}

export function validateCompiledExperiment(configuration: ResearchExperimentConfigurationV1) {
  const compilation = compileExperiment(configuration);
  const tree = compilation.tree;
  const uniform = new Float64Array(tree.totalInformationSetActions);
  for (let informationSet = 0; informationSet < tree.informationSetActionCount.length; informationSet += 1) {
    const offset = tree.informationSetActionOffset[informationSet];
    const count = tree.informationSetActionCount[informationSet];
    for (let action = 0; action < count; action += 1) uniform[offset + action] = 1 / count;
  }
  const production = evaluateGenericCompactGame(tree, strategyArrayProbability(tree, uniform));
  let independent: ReturnType<typeof evaluateIndependentOracle> | null = null;
  let independentError: string | null = null;
  if (configuration.validation.independentEvaluation) {
    try { independent = evaluateIndependentOracle(compilation.provider); } catch (error) { independentError = error instanceof Error ? error.message : String(error); }
  }
  const delta = independent
    ? Math.max(
      Math.abs(independent.uniformUtilities[0] - production.utilities[0]),
      Math.abs(independent.bestResponseValues[0] - production.bestResponseValues[0]),
      Math.abs(independent.bestResponseValues[1] - production.bestResponseValues[1]),
      Math.abs(independent.nashConv - production.nashConv),
    )
    : null;
  return {
    valid: tree.validation.valid && (delta === null || delta <= 1e-12),
    provider: validateProviderContract(compilation.provider),
    structure: tree.validation,
    compiler: compilation.compiler,
    preflight: compilation.preflight,
    mathematicalAssumptions: {
      finite: true,
      players: 2,
      zeroSumMaximumError: tree.validation.maximumZeroSumError,
      perfectRecall: tree.validation.perfectRecall,
      chanceMaximumError: tree.validation.chanceMaximumError,
    },
    independentEvaluation: {
      requested: configuration.validation.independentEvaluation,
      performed: independent !== null,
      maximumDelta: delta,
      tolerance: independent ? 1e-12 : null,
      error: independentError,
    },
  } as const;
}
