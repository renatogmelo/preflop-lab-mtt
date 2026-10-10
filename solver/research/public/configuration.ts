import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { AlgorithmName } from "../../core/types";
import {
  EXPERIMENT_SCHEMA_VERSION,
  type ResearchExperimentConfigurationV1,
} from "./contracts";
import { ResearchEngineError } from "./errors";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchEngineError("INVALID_CONFIGURATION", `${label} must be an object.`, { label });
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new ResearchEngineError("INVALID_CONFIGURATION", `${label} must be a non-empty string.`, { label });
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", `${label} must be an integer from ${minimum} to ${maximum}.`, { label, value });
  }
  return value as number;
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new ResearchEngineError("INVALID_CONFIGURATION", `${label} must be boolean.`, { label, value });
  return value;
}

export function validateExperimentConfiguration(value: unknown): ResearchExperimentConfigurationV1 {
  const root = record(value, "configuration");
  if (root.schemaVersion !== EXPERIMENT_SCHEMA_VERSION) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", `schemaVersion must be ${EXPERIMENT_SCHEMA_VERSION}.`, { schemaVersion: root.schemaVersion });
  }
  const provider = record(root.provider, "provider");
  const supportedProviders = ["variable-depth-hidden", "asymmetric-chance", "irregular-branching", "regular-synthetic"] as const;
  if (typeof provider.id !== "string" || !supportedProviders.includes(provider.id as (typeof supportedProviders)[number])) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", "Provider is not registered.", { providerId: provider.id });
  }
  if (provider.parameters !== undefined) record(provider.parameters, "provider.parameters");
  const algorithm = record(root.algorithm, "algorithm");
  const algorithms = ["vanilla-cfr", "cfr-plus", "dcfr"] as const;
  if (typeof algorithm.id !== "string" || !algorithms.includes(algorithm.id as AlgorithmName)) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", "Algorithm is not supported.", { algorithm: algorithm.id });
  }
  const budget = record(root.budget, "budget");
  const evaluation = record(root.evaluation, "evaluation");
  const checkpoint = record(root.checkpoint, "checkpoint");
  const validation = record(root.validation, "validation");
  const outputDirectory = requiredString(root.outputDirectory, "outputDirectory");
  if (isAbsolute(outputDirectory) || outputDirectory.split(/[\\/]+/).includes("..")) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", "outputDirectory must be a safe relative path inside the engine workspace.", { outputDirectory });
  }
  const tier = budget.tier;
  if (tier !== "tier0" && tier !== "tier1" && tier !== "tier2") throw new ResearchEngineError("INVALID_CONFIGURATION", "budget.tier is invalid.", { tier });
  const iterations = integer(budget.iterations, "budget.iterations", 1, 1_000_000_000);
  const interval = integer(evaluation.interval, "evaluation.interval", 1, iterations);
  const checkpointInterval = integer(checkpoint.interval, "checkpoint.interval", 1, iterations);
  const id = root.experimentId === undefined ? undefined : requiredString(root.experimentId, "experimentId");
  const dcfr = algorithm.dcfr === undefined ? undefined : record(algorithm.dcfr, "algorithm.dcfr");
  const normalized: ResearchExperimentConfigurationV1 = {
    schemaVersion: EXPERIMENT_SCHEMA_VERSION,
    ...(id ? { experimentId: id } : {}),
    provider: {
      id: provider.id as ResearchExperimentConfigurationV1["provider"]["id"],
      ...(typeof provider.version === "string" ? { version: provider.version } : {}),
      ...(provider.parameters ? { parameters: provider.parameters as Readonly<Record<string, unknown>> } : {}),
    },
    algorithm: {
      id: algorithm.id as AlgorithmName,
      ...(typeof algorithm.version === "string" ? { version: algorithm.version } : {}),
      seed: integer(algorithm.seed, "algorithm.seed", 0, 0xffff_ffff),
      ...(algorithm.cfrPlusAveragingDelay !== undefined ? { cfrPlusAveragingDelay: integer(algorithm.cfrPlusAveragingDelay, "algorithm.cfrPlusAveragingDelay", 0, 1_000_000_000) } : {}),
      ...(dcfr ? {
        dcfr: {
          alpha: Number(dcfr.alpha),
          beta: Number(dcfr.beta),
          gamma: Number(dcfr.gamma),
        },
      } : {}),
    },
    budget: {
      iterations,
      runtimeMs: integer(budget.runtimeMs, "budget.runtimeMs", 1, 30_000),
      memoryBytes: integer(budget.memoryBytes, "budget.memoryBytes", 64 * 1024 * 1024, 768 * 1024 * 1024),
      tier,
      ...(budget.explicitLargeScaleAuthorization === undefined ? {} : { explicitLargeScaleAuthorization: boolean(budget.explicitLargeScaleAuthorization, "budget.explicitLargeScaleAuthorization") }),
    },
    evaluation: { interval, exact: boolean(evaluation.exact, "evaluation.exact") },
    checkpoint: {
      interval: checkpointInterval,
      retain: integer(checkpoint.retain, "checkpoint.retain", 1, 16),
    },
    outputDirectory,
    validation: {
      structural: boolean(validation.structural, "validation.structural"),
      independentEvaluation: boolean(validation.independentEvaluation, "validation.independentEvaluation"),
    },
  };
  if (normalized.algorithm.id === "dcfr" && normalized.algorithm.dcfr && !Object.values(normalized.algorithm.dcfr).every(Number.isFinite)) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", "algorithm.dcfr values must be finite.");
  }
  if (normalized.budget.tier !== "tier0" && !normalized.budget.explicitLargeScaleAuthorization) {
    throw new ResearchEngineError("RESOURCE_LIMIT", "Tier 1 and Tier 2 require explicitLargeScaleAuthorization in Public API V1.", { tier: normalized.budget.tier });
  }
  return Object.freeze(normalized);
}

export function assignExperimentIdentity(configuration: ResearchExperimentConfigurationV1) {
  const experimentId = configuration.experimentId ?? `experiment-${randomUUID()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(experimentId)) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", "experimentId contains unsafe characters.", { experimentId });
  }
  return { experimentId, runId: `${experimentId}-${randomUUID()}` };
}
