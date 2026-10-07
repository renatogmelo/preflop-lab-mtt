import type { Actor, ChanceOutcome, ExtensiveGame, Player } from "../../core/types";
import { validateUnifiedGameDefinition, type UnifiedGameDefinition } from "./game-definition";

export type ResearchHistoryEntry = { nodeId: string; action: string };
export type ResearchState = { nodeId: string; history: ResearchHistoryEntry[] };

export class UnifiedResearchGame implements ExtensiveGame<ResearchState, string> {
  readonly id: string;

  constructor(readonly definition: UnifiedGameDefinition) {
    const validation = validateUnifiedGameDefinition(definition);
    if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join(" "));
    this.id = definition.id;
  }

  initialState(): ResearchState { return { nodeId: this.definition.root, history: [] }; }
  private node(state: ResearchState) { return this.definition.nodes[state.nodeId]; }
  actor(state: ResearchState): Actor | null {
    const node = this.node(state);
    return node.kind === "terminal" ? null : node.kind === "chance" ? "chance" : node.player;
  }
  isTerminal(state: ResearchState) { return this.node(state).kind === "terminal"; }
  utility(state: ResearchState, player: Player) {
    const node = this.node(state);
    if (node.kind !== "terminal") throw new Error("Utility is defined only at terminal nodes.");
    return node.utilities[player];
  }
  actions(state: ResearchState) {
    const node = this.node(state);
    return node.kind === "decision" ? node.actions : [];
  }
  next(state: ResearchState, action: string): ResearchState {
    const node = this.node(state);
    const next = node.kind === "chance"
      ? node.outcomes.find((outcome) => outcome.action === action)?.next
      : node.kind === "decision" ? node.transitions[action] : undefined;
    if (!next) throw new Error(`Illegal action ${action} at ${node.id}.`);
    return { nodeId: next, history: [...state.history, { nodeId: node.id, action }] };
  }
  chanceOutcomes(state: ResearchState): readonly ChanceOutcome<string>[] {
    const node = this.node(state);
    return node.kind === "chance" ? node.outcomes.map(({ action, probability }) => ({ action, probability })) : [];
  }
  informationSet(state: ResearchState) {
    const node = this.node(state);
    if (node.kind !== "decision") throw new Error("Only decision nodes have information sets.");
    return node.informationSet;
  }
}

export function enumerateResearchStates(game: UnifiedResearchGame) {
  const states: ResearchState[] = [];
  const visit = (state: ResearchState, active: Set<string>) => {
    if (active.has(state.nodeId)) throw new Error(`Cycle detected at ${state.nodeId}.`);
    states.push(state);
    if (game.isTerminal(state)) return;
    const nextActive = new Set(active).add(state.nodeId);
    const actor = game.actor(state);
    const actions = actor === "chance" ? game.chanceOutcomes(state).map((outcome) => outcome.action) : game.actions(state);
    actions.forEach((action) => visit(game.next(state, action), nextActive));
  };
  visit(game.initialState(), new Set());
  return states;
}
