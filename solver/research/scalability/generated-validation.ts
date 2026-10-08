import { performance } from "node:perf_hooks";
import { validateUnifiedGameDefinition, type ResearchDecisionNode, type UnifiedGameDefinition } from "../unified/game-definition";

export type GeneratedValidation = {
  valid: boolean;
  validationMs: number;
  chanceNormalized: boolean;
  legalActionsConsistent: boolean;
  informationSetsConsistent: boolean;
  perfectRecall: boolean;
  terminalsReachable: boolean;
  zeroSum: boolean;
  noInformationLeakage: boolean;
  finiteUtilities: boolean;
  reachedNodes: number;
  issues: string[];
};

export function validateGeneratedDefinition(definition: UnifiedGameDefinition): GeneratedValidation {
  const started = performance.now();
  const issues: string[] = [];
  const base = validateUnifiedGameDefinition(definition);
  base.issues.forEach((issue) => issues.push(`${issue.code}:${issue.nodeId ?? "game"}`));
  const reached = new Set<string>();
  const active = new Set<string>();
  let chanceNormalized = true;
  let zeroSum = true;
  let finiteUtilities = true;
  const visit = (nodeId: string) => {
    if (active.has(nodeId)) { issues.push(`cycle:${nodeId}`); return; }
    if (reached.has(nodeId)) return;
    const node = definition.nodes[nodeId];
    if (!node) { issues.push(`missing:${nodeId}`); return; }
    reached.add(nodeId);
    active.add(nodeId);
    if (node.kind === "terminal") {
      finiteUtilities &&= node.utilities.every(Number.isFinite);
      zeroSum &&= Math.abs(node.utilities[0] + node.utilities[1]) <= 1e-12;
    } else if (node.kind === "chance") {
      chanceNormalized &&= node.outcomes.every((outcome) => Number.isFinite(outcome.probability) && outcome.probability >= 0)
        && Math.abs(node.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) <= 1e-12;
      node.outcomes.forEach((outcome) => visit(outcome.next));
    } else {
      node.actions.forEach((action) => visit(node.transitions[action]));
    }
    active.delete(nodeId);
  };
  visit(definition.root);
  const terminalIds = Object.values(definition.nodes).filter((node) => node.kind === "terminal").map((node) => node.id);
  const terminalsReachable = terminalIds.every((id) => reached.has(id)) && reached.size === Object.keys(definition.nodes).length;
  const groups = new Map<string, ResearchDecisionNode[]>();
  Object.values(definition.nodes).forEach((node) => {
    if (node.kind !== "decision") return;
    const group = groups.get(node.informationSet) ?? [];
    group.push(node);
    groups.set(node.informationSet, group);
  });
  let informationSetsConsistent = true;
  let perfectRecall = true;
  let noInformationLeakage = true;
  groups.forEach((nodes, key) => {
    const first = nodes[0];
    informationSetsConsistent &&= nodes.every((node) => node.player === first.player && node.actions.join("|") === first.actions.join("|") && node.stage === first.stage);
    if (nodes.every((node) => node.observation)) {
      const own = first.observation!.ownPrivateState;
      const history = first.observation!.publicHistory.join("|");
      perfectRecall &&= nodes.every((node) => node.observation!.ownPrivateState === own && node.observation!.publicHistory.join("|") === history);
      noInformationLeakage &&= !key.includes("opponent") && !key.includes("opp=");
    }
  });
  if (!chanceNormalized) issues.push("chance-normalization");
  if (!terminalsReachable) issues.push("terminal-reachability");
  if (!zeroSum) issues.push("zero-sum");
  if (!finiteUtilities) issues.push("finite-utilities");
  if (!informationSetsConsistent) issues.push("information-set-consistency");
  if (!perfectRecall) issues.push("perfect-recall");
  if (!noInformationLeakage) issues.push("information-leakage");
  return {
    valid: issues.length === 0,
    validationMs: performance.now() - started,
    chanceNormalized,
    legalActionsConsistent: !base.issues.some((issue) => issue.code === "invalid-actions" || issue.code === "missing-transition"),
    informationSetsConsistent,
    perfectRecall,
    terminalsReachable,
    zeroSum,
    noInformationLeakage,
    finiteUtilities,
    reachedNodes: reached.size,
    issues,
  };
}
