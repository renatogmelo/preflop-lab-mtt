import type { Player } from "../../core/types";
import type { ResearchDecisionNode } from "./game-definition";
import { enumerateResearchStates, type UnifiedResearchGame } from "./game-tree";

type RecallEntry = { informationSet: string; action: string };

export function informationSetAudit(game: UnifiedResearchGame) {
  const states = enumerateResearchStates(game);
  const groups = new Map<string, Array<{ node: ResearchDecisionNode; recall: RecallEntry[] }>>();
  states.forEach((state) => {
    const node = game.definition.nodes[state.nodeId];
    if (node.kind !== "decision") return;
    const recall = state.history.flatMap((entry) => {
      const previous = game.definition.nodes[entry.nodeId];
      return previous.kind === "decision" && previous.player === node.player
        ? [{ informationSet: previous.informationSet, action: entry.action }]
        : [];
    });
    const group = groups.get(node.informationSet) ?? [];
    group.push({ node, recall });
    groups.set(node.informationSet, group);
  });
  const issues: string[] = [];
  groups.forEach((members, key) => {
    const signature = JSON.stringify(members[0].recall);
    if (members.some((member) => member.node.player !== members[0].node.player)) issues.push(`${key}: mixed players`);
    if (members.some((member) => member.node.actions.join("|") !== members[0].node.actions.join("|"))) issues.push(`${key}: inconsistent actions`);
    if (members.some((member) => JSON.stringify(member.recall) !== signature)) issues.push(`${key}: imperfect recall`);
  });
  return {
    valid: issues.length === 0,
    perfectRecall: !issues.some((issue) => issue.includes("imperfect recall")),
    issues,
    informationSets: groups.size,
    byPlayer: [0, 1].map((player) => [...groups.values()].filter((members) => members[0].node.player === player as Player).length) as [number, number],
  };
}

export function informationSetStages(game: UnifiedResearchGame) {
  return Object.fromEntries(Object.values(game.definition.nodes).flatMap((node) => (
    node.kind === "decision" ? [[node.informationSet, node.stage]] : []
  )));
}
