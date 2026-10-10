import { hashValue } from "../../core/stable";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import {
  AsymmetricChanceProvider,
  IrregularBranchingProvider,
  VariableDepthHiddenInformationProvider,
  regularSyntheticProviderV2,
} from "../generic/synthetic-families";
import type { ExtensiveGameProviderV2 } from "../generic/provider-v2";
import { CAPABILITY_IDS, PROVIDER_CONTRACT_V3, type CapabilityId, type ProviderSelection } from "./contracts";
import { ResearchEngineError } from "./errors";

export type ProviderIdentityV3 = {
  id: string;
  version: string;
  semanticHash: string;
};

export interface ExtensiveGameProviderV3<State, Action> extends ExtensiveGameProviderV2<State, Action> {
  readonly contractVersion: typeof PROVIDER_CONTRACT_V3;
  readonly identity: ProviderIdentityV3;
  readonly researchCapabilities: readonly CapabilityId[];
  readonly structuralLimits: {
    maximumNodes: number;
    maximumDepth: number;
    maximumActionsPerNode: number;
  };
}

const BASE_CAPABILITIES = Object.freeze([
  "finite-game",
  "two-player",
  "zero-sum",
  "perfect-recall",
  "explicit-chance",
  "generic-compiler",
  "checkpoint-v5",
  "structural-cache-v2",
  "independent-evaluation",
  "isolated-execution",
  "resource-policy-v3",
] as const satisfies readonly CapabilityId[]);

export function adaptProviderV2<State, Action>(
  provider: ExtensiveGameProviderV2<State, Action>,
  options: { capabilities?: readonly CapabilityId[]; maximumNodes?: number; maximumActionsPerNode?: number } = {},
): ExtensiveGameProviderV3<State, Action> {
  const capabilities = new Set<CapabilityId>(options.capabilities ?? BASE_CAPABILITIES);
  if (provider.capabilities.fastPath) capabilities.add("compact-compiler");
  const identity = Object.freeze({ id: provider.id, version: provider.version, semanticHash: provider.semanticIdentity });
  return Object.freeze({
    id: provider.id,
    version: provider.version,
    semanticIdentity: provider.semanticIdentity,
    capabilities: provider.capabilities,
    initialState: () => provider.initialState(),
    stateKey: (state: State) => provider.stateKey(state),
    actor: (state: State) => provider.actor(state),
    legalActions: (state: State) => provider.legalActions(state),
    actionKey: (state: State, action: Action) => provider.actionKey(state, action),
    actionLabel: (state: State, action: Action) => provider.actionLabel(state, action),
    transition: (state: State, action: Action) => provider.transition(state, action),
    chanceProbability: (state: State, action: Action) => provider.chanceProbability(state, action),
    informationSetKey: (state: State) => provider.informationSetKey(state),
    ...(provider.informationSetAudit ? { informationSetAudit: (state: State) => provider.informationSetAudit!(state) } : {}),
    terminalUtility: (state: State) => provider.terminalUtility(state),
    contractVersion: PROVIDER_CONTRACT_V3,
    identity,
    researchCapabilities: Object.freeze([...capabilities].sort()),
    structuralLimits: Object.freeze({
      maximumNodes: options.maximumNodes ?? provider.capabilities.exactNodeCount ?? 250_000,
      maximumDepth: provider.capabilities.maximumDepth ?? 0xffff,
      maximumActionsPerNode: options.maximumActionsPerNode ?? 0xffff,
    }),
  });
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", `${label} must be an integer from ${minimum} to ${maximum}.`, { label, value });
  }
  return value as number;
}

function stringValue(value: unknown, label: string, fallback?: string) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) throw new ResearchEngineError("INVALID_CONFIGURATION", `${label} must be a non-empty string.`, { label });
  return value;
}

function parameters(selection: ProviderSelection) {
  return selection.parameters ?? {};
}

export function createBuiltinProvider(selection: ProviderSelection): ExtensiveGameProviderV3<unknown, unknown> {
  const input = parameters(selection);
  if (selection.id === "variable-depth-hidden") {
    const provider = new VariableDepthHiddenInformationProvider();
    return adaptProviderV2(provider) as ExtensiveGameProviderV3<unknown, unknown>;
  }
  if (selection.id === "asymmetric-chance") {
    const provider = new AsymmetricChanceProvider();
    return adaptProviderV2(provider) as ExtensiveGameProviderV3<unknown, unknown>;
  }
  if (selection.id === "irregular-branching") {
    const provider = new IrregularBranchingProvider({
      id: stringValue(input.id, "provider.parameters.id", "research-irregular"),
      seed: integer(input.seed ?? 7000, "provider.parameters.seed", 0, 0xffff_ffff),
      maximumDepth: integer(input.maximumDepth ?? 6, "provider.parameters.maximumDepth", 2, 12),
      minimumTerminalDepth: integer(input.minimumTerminalDepth ?? 2, "provider.parameters.minimumTerminalDepth", 1, 11),
      maximumBranching: integer(input.maximumBranching ?? 3, "provider.parameters.maximumBranching", 2, 6),
    });
    return adaptProviderV2(provider, { maximumNodes: 250_000, maximumActionsPerNode: 6 }) as ExtensiveGameProviderV3<unknown, unknown>;
  }
  const configuration: SyntheticGameConfiguration = {
    id: stringValue(input.id, "provider.parameters.id", "research-regular"),
    players: 2,
    privateStates: integer(input.privateStates ?? 2, "provider.parameters.privateStates", 1, 8),
    publicSignals: integer(input.publicSignals ?? 2, "provider.parameters.publicSignals", 1, 8),
    stages: integer(input.stages ?? 2, "provider.parameters.stages", 1, 8),
    actionsPerDecision: integer(input.actionsPerDecision ?? 2, "provider.parameters.actionsPerDecision", 2, 8),
    seed: integer(input.seed ?? 7000, "provider.parameters.seed", 0, 0xffff_ffff),
    zeroSum: true,
    perfectRecall: true,
    dependencyComplexity: input.dependencyComplexity === "independent" || input.dependencyComplexity === "stage-coupled"
      ? input.dependencyComplexity
      : "history-coupled",
  };
  const provider = regularSyntheticProviderV2(configuration);
  return adaptProviderV2(provider, {
    capabilities: [...BASE_CAPABILITIES, "compact-compiler", "structural-cache-v1"],
    maximumNodes: provider.capabilities.exactNodeCount,
    maximumActionsPerNode: Math.max(configuration.actionsPerDecision, configuration.publicSignals, configuration.privateStates ** 2),
  }) as ExtensiveGameProviderV3<unknown, unknown>;
}

export function validateProviderContract(provider: ExtensiveGameProviderV3<unknown, unknown>) {
  const issues: string[] = [];
  if (provider.contractVersion !== PROVIDER_CONTRACT_V3) issues.push("provider-contract-version");
  if (provider.identity.id !== provider.id || provider.identity.version !== provider.version || provider.identity.semanticHash !== provider.semanticIdentity) issues.push("provider-identity-mismatch");
  if (provider.identity.semanticHash !== hashValue(provider.identity.semanticHash) && provider.identity.semanticHash.length < 8) issues.push("provider-semantic-hash-invalid");
  const capabilities = new Set(provider.researchCapabilities);
  for (const required of ["finite-game", "two-player", "zero-sum", "perfect-recall"] as const) if (!capabilities.has(required)) issues.push(`missing-capability:${required}`);
  for (const capability of capabilities) if (!CAPABILITY_IDS.includes(capability)) issues.push(`unknown-capability:${capability}`);
  if (!provider.capabilities.deterministic || !provider.capabilities.twoPlayerZeroSum) issues.push("v2-semantics-incompatible");
  if (!Number.isInteger(provider.structuralLimits.maximumNodes) || provider.structuralLimits.maximumNodes < 1) issues.push("maximum-nodes-invalid");
  return {
    valid: issues.length === 0,
    contractVersion: provider.contractVersion,
    identity: provider.identity,
    capabilities: provider.researchCapabilities,
    issues,
    adapterCompatibility: "provider-contract-v2.0.0",
  } as const;
}
