import type { UnifiedGameDefinition } from "./game-definition";

export function chanceAudit(definition: UnifiedGameDefinition) {
  const nodes = Object.values(definition.nodes).filter((node) => node.kind === "chance");
  const entries = nodes.map((node) => ({
    nodeId: node.id,
    outcomes: node.outcomes.length,
    total: node.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0),
    minimum: Math.min(...node.outcomes.map((outcome) => outcome.probability)),
  }));
  return {
    valid: entries.every((entry) => Math.abs(entry.total - 1) <= 1e-12 && entry.minimum >= 0),
    entries,
  };
}
