import type { Player } from "../../core/types";

export type ResearchStage = "initial" | "continuation";

export type ResearchChanceNode = {
  id: string;
  kind: "chance";
  outcomes: Array<{ action: string; probability: number; next: string }>;
};

export type ResearchDecisionNode = {
  id: string;
  kind: "decision";
  player: Player;
  informationSet: string;
  stage: ResearchStage;
  actions: string[];
  transitions: Record<string, string>;
  observation?: {
    ownPrivateState: number;
    opponentPrivateState: number;
    publicHistory: string[];
  };
};

export type ResearchTerminalNode = {
  id: string;
  kind: "terminal";
  utilities: [number, number];
};

export type ResearchNode = ResearchChanceNode | ResearchDecisionNode | ResearchTerminalNode;

export type UnifiedGameDefinition = {
  id: string;
  name: string;
  description: string;
  players: readonly [string, string];
  root: string;
  zeroSum: true;
  nodes: Record<string, ResearchNode>;
  research?: {
    family: string;
    seed: number;
    generatorVersion: string;
  };
};

export type DefinitionIssue = { code: string; message: string; nodeId?: string };

export function validateUnifiedGameDefinition(definition: UnifiedGameDefinition) {
  const issues: DefinitionIssue[] = [];
  if (!definition.id) issues.push({ code: "missing-id", message: "Game id is required." });
  if (!definition.nodes[definition.root]) issues.push({ code: "missing-root", message: "Root node does not exist." });
  const informationSets = new Map<string, { player: Player; actions: string[]; stage: ResearchStage }>();
  Object.entries(definition.nodes).forEach(([key, node]) => {
    if (key !== node.id) issues.push({ code: "node-id-mismatch", nodeId: key, message: `Node key ${key} differs from id ${node.id}.` });
    if (node.kind === "terminal") {
      if (node.utilities.some((value) => !Number.isFinite(value))) issues.push({ code: "invalid-utility", nodeId: key, message: "Terminal utilities must be finite." });
      if (Math.abs(node.utilities[0] + node.utilities[1]) > 1e-12) issues.push({ code: "not-zero-sum", nodeId: key, message: "Terminal utilities must sum to zero." });
      return;
    }
    if (node.kind === "chance") {
      const total = node.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
      if (!node.outcomes.length || node.outcomes.some((outcome) => !(outcome.probability >= 0) || !Number.isFinite(outcome.probability)) || Math.abs(total - 1) > 1e-12) {
        issues.push({ code: "chance-normalization", nodeId: key, message: "Chance outcomes must be finite, non-negative and sum to one." });
      }
      node.outcomes.forEach((outcome) => {
        if (!definition.nodes[outcome.next]) issues.push({ code: "missing-transition", nodeId: key, message: `Chance transition ${outcome.action} has no target.` });
      });
      return;
    }
    if (!node.actions.length || new Set(node.actions).size !== node.actions.length) issues.push({ code: "invalid-actions", nodeId: key, message: "Decision actions must be unique and non-empty." });
    node.actions.forEach((action) => {
      if (!definition.nodes[node.transitions[action]]) issues.push({ code: "missing-transition", nodeId: key, message: `Action ${action} has no target.` });
    });
    const previous = informationSets.get(node.informationSet);
    if (previous && (previous.player !== node.player || previous.stage !== node.stage || previous.actions.join("|") !== node.actions.join("|"))) {
      issues.push({ code: "infoset-inconsistency", nodeId: key, message: `Information set ${node.informationSet} has inconsistent player, stage or actions.` });
    } else if (!previous) {
      informationSets.set(node.informationSet, { player: node.player, actions: [...node.actions], stage: node.stage });
    }
  });
  return { valid: issues.length === 0, issues, informationSets };
}
