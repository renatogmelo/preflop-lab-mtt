import { hashValue } from "../../core/stable";
import type { CompactActor } from "../compact/provider";
import type { ExtensiveGameProviderV2, InformationSetAudit } from "../generic/provider-v2";

type Terminal = { kind: "terminal"; utility: number };
type Chance = { kind: "chance"; actions: string[]; probabilities: number[]; children: string[] };
type Decision = { kind: "decision"; player: 0 | 1; informationSet: string; actions: string[]; children: string[]; observation?: string };
export type TableNode = Terminal | Chance | Decision;

export class TableGameProvider implements ExtensiveGameProviderV2<string, string> {
  readonly version = "analytical-table-v0.13.0";
  readonly semanticIdentity: string;
  readonly capabilities = { deterministic: true, twoPlayerZeroSum: true } as const;
  constructor(readonly id: string, readonly nodes: Readonly<Record<string, TableNode>>, readonly root = "root") {
    this.semanticIdentity = hashValue({ id, nodes, root });
  }
  initialState() { return this.root; }
  stateKey(state: string) { return state; }
  actor(state: string): CompactActor {
    const node = this.nodes[state];
    if (!node) throw new Error(`Unknown state ${state}.`);
    return node.kind === "terminal" ? null : node.kind === "chance" ? "chance" : node.player;
  }
  legalActions(state: string) { const node = this.nodes[state]; return node.kind === "terminal" ? [] : node.actions; }
  actionKey(_state: string, action: string) { return action; }
  actionLabel(_state: string, action: string) { return action; }
  transition(state: string, action: string) {
    const node = this.nodes[state];
    if (node.kind === "terminal") throw new Error("Terminal transition.");
    const index = node.actions.indexOf(action);
    if (index < 0) throw new Error("Illegal action.");
    return node.children[index];
  }
  chanceProbability(state: string, action: string) {
    const node = this.nodes[state];
    if (node.kind !== "chance") return 0;
    return node.probabilities[node.actions.indexOf(action)];
  }
  informationSetKey(state: string) { const node = this.nodes[state]; return node.kind === "decision" ? node.informationSet : ""; }
  informationSetAudit(state: string): InformationSetAudit {
    const node = this.nodes[state];
    const observation = node.kind === "decision" ? node.observation ?? node.informationSet : "";
    return { ownObservation: observation, publicHistory: observation };
  }
  terminalUtility(state: string): readonly [number, number] | null { const node = this.nodes[state]; return node.kind === "terminal" ? [node.utility, -node.utility] : null; }
}

function simultaneousMatrix(id: string, actions: string[], payoff: number[][]) {
  const nodes: Record<string, TableNode> = { root: { kind: "decision", player: 0, informationSet: `${id}:p0`, actions, children: actions.map((_, index) => `p1:${index}`) } };
  actions.forEach((_, row) => {
    nodes[`p1:${row}`] = { kind: "decision", player: 1, informationSet: `${id}:p1`, observation: "hidden-p0-action", actions, children: actions.map((__, column) => `t:${row}:${column}`) };
    actions.forEach((__, column) => { nodes[`t:${row}:${column}`] = { kind: "terminal", utility: payoff[row][column] }; });
  });
  return new TableGameProvider(id, nodes);
}

export function matchingPenniesProvider() { return simultaneousMatrix("matching-pennies", ["H", "T"], [[1, -1], [-1, 1]]); }
export function rockPaperScissorsProvider() { return simultaneousMatrix("rock-paper-scissors", ["R", "P", "S"], [[0, -1, 1], [1, 0, -1], [-1, 1, 0]]); }

export function sequentialPerfectInformationProvider() {
  return new TableGameProvider("sequential-perfect-information", {
    root: { kind: "decision", player: 0, informationSet: "seq:p0", actions: ["L", "R"], children: ["after:L", "after:R"] },
    "after:L": { kind: "decision", player: 1, informationSet: "seq:p1:L", actions: ["x", "y"], children: ["tlx", "tly"] },
    "after:R": { kind: "decision", player: 1, informationSet: "seq:p1:R", actions: ["x", "y"], children: ["trx", "try"] },
    tlx: { kind: "terminal", utility: 2 }, tly: { kind: "terminal", utility: -1 },
    trx: { kind: "terminal", utility: 0 }, try: { kind: "terminal", utility: 1 },
  });
}

export function hiddenInformationProvider() {
  return new TableGameProvider("hidden-information", {
    root: { kind: "chance", actions: ["strong", "weak"], probabilities: [0.5, 0.5], children: ["p0:s", "p0:w"] },
    "p0:s": { kind: "decision", player: 0, informationSet: "hidden:p0:strong", actions: ["bet", "check"], children: ["p1:s", "tsc"] },
    "p0:w": { kind: "decision", player: 0, informationSet: "hidden:p0:weak", actions: ["bet", "check"], children: ["p1:w", "twc"] },
    "p1:s": { kind: "decision", player: 1, informationSet: "hidden:p1", observation: "bet-only", actions: ["call", "fold"], children: ["tscall", "tsfold"] },
    "p1:w": { kind: "decision", player: 1, informationSet: "hidden:p1", observation: "bet-only", actions: ["call", "fold"], children: ["twcall", "twfold"] },
    tsc: { kind: "terminal", utility: 1 }, twc: { kind: "terminal", utility: -1 },
    tscall: { kind: "terminal", utility: 2 }, tsfold: { kind: "terminal", utility: 0.5 },
    twcall: { kind: "terminal", utility: -2 }, twfold: { kind: "terminal", utility: 0.5 },
  });
}

export function nonuniformChanceProvider() {
  return new TableGameProvider("nonuniform-chance", {
    root: { kind: "chance", actions: ["common", "rare"], probabilities: [0.8, 0.2], children: ["common", "rare"] },
    common: { kind: "decision", player: 0, informationSet: "nonuniform:p0", observation: "hidden-outcome", actions: ["A", "B"], children: ["tca", "tcb"] },
    rare: { kind: "decision", player: 0, informationSet: "nonuniform:p0", observation: "hidden-outcome", actions: ["A", "B"], children: ["tra", "trb"] },
    tca: { kind: "terminal", utility: 1 }, tcb: { kind: "terminal", utility: 0 },
    tra: { kind: "terminal", utility: -3 }, trb: { kind: "terminal", utility: 2 },
  });
}

export function chanceStressProvider(probability: number) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("Chance stress probability must be in [0,1].");
  return new TableGameProvider(`chance-stress-${probability}`, {
    root: { kind: "chance", actions: ["left", "right"], probabilities: [probability, 1 - probability], children: ["left", "right"] },
    left: { kind: "decision", player: 0, informationSet: "chance-stress:p0", observation: "hidden-branch", actions: ["A", "B"], children: ["tla", "tlb"] },
    right: { kind: "decision", player: 0, informationSet: "chance-stress:p0", observation: "hidden-branch", actions: ["A", "B"], children: ["tra", "trb"] },
    tla: { kind: "terminal", utility: 1 }, tlb: { kind: "terminal", utility: -1 },
    tra: { kind: "terminal", utility: -1 }, trb: { kind: "terminal", utility: 1 },
  });
}
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function controlledRandomGame(seed: number) {
  if (!Number.isInteger(seed) || seed < 0) throw new Error("Property seed must be a non-negative integer.");
  const random = seeded(seed);
  const chance = 0.1 + random() * 0.8;
  const utility = () => Math.round((random() * 8 - 4) * 4) / 4;
  return new TableGameProvider(`property-${seed}`, {
    root: { kind: "chance", actions: ["c0", "c1"], probabilities: [chance, 1 - chance], children: ["p0:0", "p0:1"] },
    "p0:0": { kind: "decision", player: 0, informationSet: "property:p0:0", actions: ["a", "b"], children: ["p1:0:a", "p1:0:b"] },
    "p0:1": { kind: "decision", player: 0, informationSet: "property:p0:1", actions: ["a", "b"], children: ["p1:1:a", "p1:1:b"] },
    "p1:0:a": { kind: "decision", player: 1, informationSet: "property:p1:a", observation: "a", actions: ["x", "y"], children: ["t:0:a:x", "t:0:a:y"] },
    "p1:1:a": { kind: "decision", player: 1, informationSet: "property:p1:a", observation: "a", actions: ["x", "y"], children: ["t:1:a:x", "t:1:a:y"] },
    "p1:0:b": { kind: "decision", player: 1, informationSet: "property:p1:b", observation: "b", actions: ["x", "y"], children: ["t:0:b:x", "t:0:b:y"] },
    "p1:1:b": { kind: "decision", player: 1, informationSet: "property:p1:b", observation: "b", actions: ["x", "y"], children: ["t:1:b:x", "t:1:b:y"] },
    "t:0:a:x": { kind: "terminal", utility: utility() }, "t:0:a:y": { kind: "terminal", utility: utility() },
    "t:1:a:x": { kind: "terminal", utility: utility() }, "t:1:a:y": { kind: "terminal", utility: utility() },
    "t:0:b:x": { kind: "terminal", utility: utility() }, "t:0:b:y": { kind: "terminal", utility: utility() },
    "t:1:b:x": { kind: "terminal", utility: utility() }, "t:1:b:y": { kind: "terminal", utility: utility() },
  });
}
export const analyticalFixtures = [
  { name: "matching-pennies", create: matchingPenniesProvider, equilibrium: { "matching-pennies:p0": { H: 0.5, T: 0.5 }, "matching-pennies:p1": { H: 0.5, T: 0.5 } } },
  { name: "rock-paper-scissors", create: rockPaperScissorsProvider, equilibrium: { "rock-paper-scissors:p0": { R: 1 / 3, P: 1 / 3, S: 1 / 3 }, "rock-paper-scissors:p1": { R: 1 / 3, P: 1 / 3, S: 1 / 3 } } },
  { name: "sequential-perfect-information", create: sequentialPerfectInformationProvider },
  { name: "hidden-information", create: hiddenInformationProvider },
  { name: "nonuniform-chance", create: nonuniformChanceProvider },
] as const;
