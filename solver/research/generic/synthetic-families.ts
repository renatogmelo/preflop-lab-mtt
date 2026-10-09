import { hashValue } from "../../core/stable";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { SyntheticCompactProvider } from "../compact/synthetic-compact-provider";
import { compilerIdentity } from "../fast-compiler/compiler-v2";
import type { ExtensiveGameProviderV2, InformationSetAudit } from "./provider-v2";

export type GenericFamilyName = "irregular-branching" | "variable-depth-hidden" | "asymmetric-chance";

function stableUnit(seed: number, value: string) {
  let state = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x1_0000_0000;
}

export function regularSyntheticProviderV2(configuration: SyntheticGameConfiguration): ExtensiveGameProviderV2<number, number> {
  const base = new SyntheticCompactProvider(configuration);
  return {
    id: base.id,
    version: "synthetic-regular-provider-v2.0.0",
    semanticIdentity: base.logicalGameHash,
    capabilities: {
      deterministic: true,
      twoPlayerZeroSum: true,
      exactNodeCount: base.nodeCount,
      maximumDepth: base.maximumDepth,
      fastPath: {
        family: "synthetic-regular-v2",
        configurationHash: hashValue(compilerIdentity(configuration)),
      },
    },
    initialState: () => base.initialState(),
    stateKey: (state) => `regular:${state}`,
    actor: (state) => base.actor(state),
    legalActions: (state) => base.legalActions(state),
    actionKey: (_state, action) => String(action),
    actionLabel: (_state, action) => String(action),
    transition: (state, action) => base.transition(state, action),
    chanceProbability: (state, action) => base.chanceProbability(state, action),
    informationSetKey: (state) => base.actor(state) === 0 || base.actor(state) === 1
      ? `regular-info:${String(base.informationSet(state)).padStart(12, "0")}`
      : "",
    informationSetAudit: (state) => {
      const key = `regular-info:${String(base.informationSet(state)).padStart(12, "0")}`;
      return { ownObservation: key, publicHistory: "regular-synthetic" };
    },
    terminalUtility: (state) => base.terminalUtility(state),
  };
}

export type IrregularBranchingConfiguration = {
  id: string;
  seed: number;
  maximumDepth: number;
  minimumTerminalDepth: number;
  maximumBranching: number;
};

type IrregularState = { path: readonly number[] };

export class IrregularBranchingProvider implements ExtensiveGameProviderV2<IrregularState, number> {
  readonly version = "irregular-branching-v1.0.0";
  readonly semanticIdentity: string;
  readonly capabilities;

  constructor(readonly configuration: IrregularBranchingConfiguration) {
    if (!Number.isInteger(configuration.maximumDepth) || configuration.maximumDepth < 2 || configuration.maximumDepth > 40) throw new Error("Invalid irregular maximum depth.");
    if (!Number.isInteger(configuration.minimumTerminalDepth) || configuration.minimumTerminalDepth < 1 || configuration.minimumTerminalDepth >= configuration.maximumDepth) throw new Error("Invalid irregular minimum terminal depth.");
    if (!Number.isInteger(configuration.maximumBranching) || configuration.maximumBranching < 2 || configuration.maximumBranching > 12) throw new Error("Invalid irregular maximum branching.");
    this.semanticIdentity = hashValue({ family: this.version, configuration });
    this.capabilities = {
      deterministic: true,
      twoPlayerZeroSum: true,
      maximumDepth: configuration.maximumDepth,
    } as const;
  }

  get id() { return this.configuration.id; }
  initialState(): IrregularState { return { path: [] }; }
  stateKey(state: IrregularState) { return `i:${state.path.join(".")}`; }
  private terminal(state: IrregularState) {
    if (state.path.length >= this.configuration.maximumDepth) return true;
    if (state.path.length < this.configuration.minimumTerminalDepth) return false;
    return stableUnit(this.configuration.seed, `${this.stateKey(state)}:terminal`) < 0.24;
  }
  actor(state: IrregularState) { return this.terminal(state) ? null : (state.path.length % 2) as 0 | 1; }
  legalActions(state: IrregularState) {
    if (this.terminal(state)) return [];
    const variable = Math.floor(stableUnit(this.configuration.seed, `${this.stateKey(state)}:branch`) * (this.configuration.maximumBranching - 1));
    return Object.freeze(Array.from({ length: 2 + variable }, (_, index) => index));
  }
  actionKey(_state: IrregularState, action: number) { return `a${action}`; }
  actionLabel(state: IrregularState, action: number) { return this.actionKey(state, action); }
  transition(state: IrregularState, action: number): IrregularState {
    if (!(this.legalActions(state) as readonly number[]).includes(action)) throw new Error("Illegal irregular action.");
    return { path: [...state.path, action] };
  }
  chanceProbability() { return 0; }
  informationSetKey(state: IrregularState) { return `perfect:${this.stateKey(state)}`; }
  informationSetAudit(state: IrregularState): InformationSetAudit {
    return { ownObservation: this.stateKey(state), publicHistory: this.stateKey(state) };
  }
  terminalUtility(state: IrregularState): readonly [number, number] | null {
    if (!this.terminal(state)) return null;
    const raw = stableUnit(this.configuration.seed, `${this.stateKey(state)}:utility`) * 2 - 1;
    const utility = Math.round(raw * 1_000_000) / 1_000_000;
    return [utility, -utility];
  }
}

type HiddenDeal = readonly [0 | 1, 0 | 1];
type HiddenState =
  | { phase: "root" }
  | { phase: "p0"; deal: HiddenDeal }
  | { phase: "p1"; deal: HiddenDeal; p0Action: 0 | 1 }
  | { phase: "p0-response"; deal: HiddenDeal }
  | { phase: "terminal"; deal: HiddenDeal; history: "cc" | "bf" | "bc" | "cbf" | "cbc" };

const hiddenDeals: readonly HiddenDeal[] = [[0, 0], [0, 1], [1, 0], [1, 1]];

export class VariableDepthHiddenInformationProvider implements ExtensiveGameProviderV2<HiddenState, number> {
  readonly id = "variable-depth-hidden-information";
  readonly version = "variable-depth-hidden-v1.0.0";
  readonly semanticIdentity = hashValue({ family: this.version, payoff: "binary-showdown-v1" });
  readonly capabilities = { deterministic: true, twoPlayerZeroSum: true, maximumDepth: 4 } as const;
  initialState(): HiddenState { return { phase: "root" }; }
  stateKey(state: HiddenState) {
    if (state.phase === "root") return "h:root";
    const deal = state.deal.join("");
    if (state.phase === "p1") return `h:p1:${deal}:${state.p0Action}`;
    if (state.phase === "terminal") return `h:t:${deal}:${state.history}`;
    return `h:${state.phase}:${deal}`;
  }
  actor(state: HiddenState) {
    if (state.phase === "root") return "chance" as const;
    if (state.phase === "p0" || state.phase === "p0-response") return 0 as const;
    if (state.phase === "p1") return 1 as const;
    return null;
  }
  legalActions(state: HiddenState) {
    if (state.phase === "root") return [0, 1, 2, 3] as const;
    if (state.phase === "terminal") return [];
    return [0, 1] as const;
  }
  actionKey(state: HiddenState, action: number) {
    if (state.phase === "root") return `deal-${action}`;
    if (state.phase === "p0") return action === 0 ? "check" : "bet";
    if (state.phase === "p1" && state.p0Action === 0) return action === 0 ? "check" : "bet";
    return action === 0 ? "fold" : "call";
  }
  actionLabel(state: HiddenState, action: number) { return this.actionKey(state, action); }
  transition(state: HiddenState, action: number): HiddenState {
    if (!(this.legalActions(state) as readonly number[]).includes(action)) throw new Error("Illegal hidden-information action.");
    if (state.phase === "root") return { phase: "p0", deal: hiddenDeals[action] };
    if (state.phase === "p0") return { phase: "p1", deal: state.deal, p0Action: action as 0 | 1 };
    if (state.phase === "p1") {
      if (state.p0Action === 0 && action === 0) return { phase: "terminal", deal: state.deal, history: "cc" };
      if (state.p0Action === 0) return { phase: "p0-response", deal: state.deal };
      return { phase: "terminal", deal: state.deal, history: action === 0 ? "bf" : "bc" };
    }
    if (state.phase === "p0-response") return { phase: "terminal", deal: state.deal, history: action === 0 ? "cbf" : "cbc" };
    throw new Error("Terminal state has no transition.");
  }
  chanceProbability(state: HiddenState, action: number) { return state.phase === "root" && action >= 0 && action < 4 ? 0.25 : 0; }
  informationSetKey(state: HiddenState) {
    if (state.phase === "p0") return `p0:start:own-${state.deal[0]}`;
    if (state.phase === "p1") return `p1:${state.p0Action === 0 ? "check" : "bet"}:own-${state.deal[1]}`;
    if (state.phase === "p0-response") return `p0:check-bet:own-${state.deal[0]}`;
    return "";
  }
  informationSetAudit(state: HiddenState): InformationSetAudit {
    if (state.phase === "p0") return { ownObservation: String(state.deal[0]), opponentPrivateState: String(state.deal[1]), publicHistory: "start" };
    if (state.phase === "p1") return { ownObservation: String(state.deal[1]), opponentPrivateState: String(state.deal[0]), publicHistory: state.p0Action === 0 ? "check" : "bet" };
    if (state.phase === "p0-response") return { ownObservation: String(state.deal[0]), opponentPrivateState: String(state.deal[1]), publicHistory: "check-bet" };
    throw new Error("Information audit requested outside a decision state.");
  }
  terminalUtility(state: HiddenState): readonly [number, number] | null {
    if (state.phase !== "terminal") return null;
    const showdown = state.deal[0] === state.deal[1] ? 0 : state.deal[0] > state.deal[1] ? 1 : -1;
    const utility = state.history === "bf" ? 1 : state.history === "cbf" ? -1 : showdown * (state.history === "cc" ? 1 : 2);
    return [utility, -utility];
  }
}

type ChanceState =
  | { phase: "root" }
  | { phase: "p0"; branch: 1 | 2 }
  | { phase: "second-chance" }
  | { phase: "p1"; signal: 0 | 1 }
  | { phase: "terminal"; key: string; utility: number };

export class AsymmetricChanceProvider implements ExtensiveGameProviderV2<ChanceState, number> {
  readonly id = "asymmetric-chance";
  readonly version = "asymmetric-chance-v1.0.0";
  readonly semanticIdentity = hashValue({ family: this.version, probabilities: [0.1, 0.3, 0.6, 0.25, 0.75] });
  readonly capabilities = { deterministic: true, twoPlayerZeroSum: true, maximumDepth: 3 } as const;
  initialState(): ChanceState { return { phase: "root" }; }
  stateKey(state: ChanceState) {
    if (state.phase === "terminal") return `a:t:${state.key}`;
    if (state.phase === "p0") return `a:p0:${state.branch}`;
    if (state.phase === "p1") return `a:p1:${state.signal}`;
    return `a:${state.phase}`;
  }
  actor(state: ChanceState) {
    if (state.phase === "root" || state.phase === "second-chance") return "chance" as const;
    if (state.phase === "p0") return 0 as const;
    if (state.phase === "p1") return 1 as const;
    return null;
  }
  legalActions(state: ChanceState) {
    if (state.phase === "root") return [0, 1, 2] as const;
    if (state.phase === "second-chance" || state.phase === "p0") return [0, 1] as const;
    if (state.phase === "p1") return state.signal === 0 ? [0, 1] as const : [0, 1, 2] as const;
    return [];
  }
  actionKey(state: ChanceState, action: number) { return `${state.phase}-${action}`; }
  actionLabel(state: ChanceState, action: number) { return this.actionKey(state, action); }
  transition(state: ChanceState, action: number): ChanceState {
    if (!(this.legalActions(state) as readonly number[]).includes(action)) throw new Error("Illegal asymmetric-chance action.");
    if (state.phase === "root") {
      if (action === 0) return { phase: "terminal", key: "root-0", utility: -0.4 };
      if (action === 1) return { phase: "p0", branch: 1 };
      return { phase: "second-chance" };
    }
    if (state.phase === "p0") return { phase: "terminal", key: `p0-${action}`, utility: action === 0 ? -0.2 : 0.8 };
    if (state.phase === "second-chance") return { phase: "p1", signal: action as 0 | 1 };
    if (state.phase === "p1") return { phase: "terminal", key: `p1-${state.signal}-${action}`, utility: (state.signal ? 0.6 : -0.6) + action * 0.25 };
    throw new Error("Terminal state has no transition.");
  }
  chanceProbability(state: ChanceState, action: number) {
    if (state.phase === "root") return [0.1, 0.3, 0.6][action] ?? 0;
    if (state.phase === "second-chance") return [0.25, 0.75][action] ?? 0;
    return 0;
  }
  informationSetKey(state: ChanceState) { return state.phase === "p0" ? "asym:p0" : state.phase === "p1" ? `asym:p1:${state.signal}` : ""; }
  informationSetAudit(state: ChanceState): InformationSetAudit {
    return { ownObservation: state.phase, publicHistory: state.phase === "p1" ? `signal-${state.signal}` : "branch-1" };
  }
  terminalUtility(state: ChanceState): readonly [number, number] | null { return state.phase === "terminal" ? [state.utility, -state.utility] : null; }
}

export function createGenericFamily(name: GenericFamilyName, scale = 1): ExtensiveGameProviderV2<unknown, unknown> {
  if (name === "variable-depth-hidden") return new VariableDepthHiddenInformationProvider() as ExtensiveGameProviderV2<unknown, unknown>;
  if (name === "asymmetric-chance") return new AsymmetricChanceProvider() as ExtensiveGameProviderV2<unknown, unknown>;
  return new IrregularBranchingProvider({
    id: `irregular-branching-s${scale}`,
    seed: 6_120 + scale,
    maximumDepth: 4 + Math.max(1, scale),
    minimumTerminalDepth: 2,
    maximumBranching: Math.min(5, 2 + scale),
  }) as ExtensiveGameProviderV2<unknown, unknown>;
}
