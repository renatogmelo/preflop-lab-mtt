import type { Player } from "../../core/types";

export type CompactActor = Player | "chance" | null;

export type CompactLevel = {
  kind: "root-chance" | "decision" | "public-chance" | "terminal" | "mixed";
  stage: number;
  offset: number;
  count: number;
};

export interface CompactGameProvider<State = number> {
  readonly id: string;
  readonly logicalGameHash: string;
  readonly nodeCount: number;
  readonly informationSetCount: number;
  readonly maximumDepth: number;
  readonly levels: readonly CompactLevel[];
  readonly validationClaims?: {
    readonly noInformationLeakage: boolean;
    readonly perfectRecall: boolean;
  };
  initialState(): State;
  stateAt(ordinal: number): State;
  actor(state: State): CompactActor;
  legalActions(state: State): readonly number[];
  transition(state: State, action: number): State;
  informationSet(state: State): number;
  informationSetKey(informationSet: number): string;
  informationSetActionCount(informationSet: number): number;
  actionLabel(informationSet: number, action: number): string;
  chanceProbability(state: State, action: number): number;
  terminalUtility(state: State): readonly [number, number] | null;
  terminalUtilityP0?(state: State): number | null;
}

export function assertUint32(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label} exceeds Uint32 capacity.`);
  }
}

export function assertCompactState(provider: CompactGameProvider<number>, state: number) {
  if (!Number.isInteger(state) || state < 0 || state >= provider.nodeCount) {
    throw new Error(`Invalid compact state ${state}.`);
  }
}

