import type { Player } from "../core/types";

export type TreeAction = {
  id: string;
  type: "fold" | "check" | "call" | "bet" | "raise" | "all-in" | "chance";
  amount?: number;
};

type NodeBase = {
  id: string;
  parentId: string | null;
  pot: number;
  stacks: number[];
  history: TreeAction[];
};

export type ChanceNode = NodeBase & {
  kind: "chance";
  outcomes: Array<{ action: TreeAction; probability: number; childId: string }>;
};

export type ActionNode = NodeBase & {
  kind: "action";
  actingPlayer: Player;
  informationSet: string;
  legalActions: TreeAction[];
  children: Record<string, string>;
};

export type TerminalNode = NodeBase & {
  kind: "terminal";
  utilities: [number, number];
};

export type GameNode = ChanceNode | ActionNode | TerminalNode;

export function validateTree(nodes: GameNode[], rootId: string) {
  const issues: string[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(rootId)) issues.push("Tree root is missing.");
  if (byId.size !== nodes.length) issues.push("Tree node ids must be unique.");
  nodes.forEach((node) => {
    if (!Number.isFinite(node.pot) || node.pot < 0) issues.push(`${node.id}: invalid pot.`);
    if (node.stacks.some((stack) => !Number.isFinite(stack) || stack < 0)) issues.push(`${node.id}: invalid stack.`);
    if (node.kind === "chance") {
      const total = node.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
      if (Math.abs(total - 1) > 1e-9) issues.push(`${node.id}: chance probabilities do not sum to one.`);
      node.outcomes.forEach((outcome) => { if (!byId.has(outcome.childId)) issues.push(`${node.id}: missing chance child.`); });
    }
    if (node.kind === "action") {
      node.legalActions.forEach((action) => { if (!byId.has(node.children[action.id])) issues.push(`${node.id}: missing action child.`); });
    }
    if (node.kind === "terminal" && Math.abs(node.utilities[0] + node.utilities[1]) > 1e-9) issues.push(`${node.id}: utility is not zero-sum.`);
  });
  return { valid: issues.length === 0, issues };
}
