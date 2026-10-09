import type { CompactActor } from "../compact/provider";

export const PROVIDER_CONTRACT_V2 = "provider-contract-v2.0.0";

export type ProviderCapabilities = {
  readonly deterministic: true;
  readonly twoPlayerZeroSum: true;
  readonly exactNodeCount?: number;
  readonly maximumDepth?: number;
  readonly fastPath?: {
    readonly family: "synthetic-regular-v2";
    readonly configurationHash: string;
  };
};

export type InformationSetAudit = {
  readonly ownObservation: string;
  readonly publicHistory: string;
  readonly opponentPrivateState?: string;
};

export interface ExtensiveGameProviderV2<State, Action> {
  readonly id: string;
  readonly version: string;
  readonly semanticIdentity: string;
  readonly capabilities: ProviderCapabilities;
  initialState(): State;
  stateKey(state: State): string;
  actor(state: State): CompactActor;
  legalActions(state: State): readonly Action[];
  actionKey(state: State, action: Action): string;
  actionLabel(state: State, action: Action): string;
  transition(state: State, action: Action): State;
  chanceProbability(state: State, action: Action): number;
  informationSetKey(state: State): string;
  informationSetAudit?(state: State): InformationSetAudit;
  terminalUtility(state: State): readonly [number, number] | null;
}
