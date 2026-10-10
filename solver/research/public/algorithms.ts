import { COMPACT_CFR_VERSION, compactConfiguration } from "../compact/compact-cfr";
import type { AlgorithmName, SolverConfiguration } from "../../core/types";
import type { AlgorithmConfigurationV1 } from "./contracts";
import { ResearchEngineError } from "./errors";

export const ALGORITHM_DESCRIPTORS = Object.freeze([
  { id: "vanilla-cfr", version: COMPACT_CFR_VERSION, checkpointVersion: 5, validation: "phase6.13-differential" },
  { id: "cfr-plus", version: COMPACT_CFR_VERSION, checkpointVersion: 5, validation: "phase6.13-differential" },
  { id: "dcfr", version: COMPACT_CFR_VERSION, checkpointVersion: 5, validation: "phase6.13-differential" },
] as const);

export function algorithmDescriptor(id: AlgorithmName) {
  const descriptor = ALGORITHM_DESCRIPTORS.find((candidate) => candidate.id === id);
  if (!descriptor) throw new ResearchEngineError("INVALID_CONFIGURATION", `Unsupported algorithm ${String(id)}.`, { algorithm: id });
  return descriptor;
}

export function toSolverConfiguration(configuration: AlgorithmConfigurationV1): SolverConfiguration {
  const descriptor = algorithmDescriptor(configuration.id);
  if (configuration.version && configuration.version !== descriptor.version) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", "Requested algorithm version is incompatible with this engine.", {
      requested: configuration.version,
      supported: descriptor.version,
    });
  }
  const base = compactConfiguration(configuration.id);
  const result: SolverConfiguration = { ...base, seed: configuration.seed };
  if (configuration.id === "cfr-plus") result.cfrPlusAveragingDelay = configuration.cfrPlusAveragingDelay ?? 0;
  if (configuration.id === "dcfr" && configuration.dcfr) {
    const values = Object.values(configuration.dcfr);
    if (!values.every(Number.isFinite)) throw new ResearchEngineError("INVALID_CONFIGURATION", "DCFR parameters must be finite.");
    result.dcfr = configuration.dcfr;
  }
  return result;
}
