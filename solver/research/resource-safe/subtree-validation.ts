import { hashValue } from "../../core/stable";
import type { CompactActor, CompactGameProvider } from "../compact/provider";

export type ExtractedSubtreeNode = {
  id: number;
  sourceState: number;
  depth: number;
  actor: CompactActor;
  informationSet: number | null;
  informationSetKey: string | null;
  actions: number[];
  probabilities: number[];
  children: number[];
  utilityP0: number | null;
};

export type ExtractedCompactSubtree = {
  rootSourceState: number;
  root: number;
  nodes: ExtractedSubtreeNode[];
  maximumDepth: number;
  structuralHash: string;
};

export function extractCompleteSubtree(
  provider: CompactGameProvider<number>,
  rootSourceState: number,
  maximumNodes = 10_000,
): ExtractedCompactSubtree {
  if (!Number.isInteger(rootSourceState) || rootSourceState < 0 || rootSourceState >= provider.nodeCount) {
    throw new Error("Subtree root state is invalid.");
  }
  const nodes: ExtractedSubtreeNode[] = [];
  const allocate = (sourceState: number, depth: number) => {
    if (nodes.length >= maximumNodes) throw new Error(`Extracted subtree exceeded ${maximumNodes} nodes.`);
    const id = nodes.length;
    const actor = provider.actor(sourceState);
    const informationSet = actor === 0 || actor === 1 ? provider.informationSet(sourceState) : null;
    const utility = provider.terminalUtilityP0?.(sourceState) ?? provider.terminalUtility(sourceState)?.[0] ?? null;
    nodes.push({
      id,
      sourceState,
      depth,
      actor,
      informationSet,
      informationSetKey: informationSet === null ? null : provider.informationSetKey(informationSet),
      actions: [],
      probabilities: [],
      children: [],
      utilityP0: utility,
    });
    return id;
  };
  const root = allocate(rootSourceState, 0);
  const stack = [root];
  let maximumDepth = 0;
  while (stack.length) {
    const id = stack.pop()!;
    const node = nodes[id];
    maximumDepth = Math.max(maximumDepth, node.depth);
    if (node.actor === null) continue;
    const actions = [...provider.legalActions(node.sourceState)];
    node.actions = actions;
    for (const action of actions) {
      const child = allocate(provider.transition(node.sourceState, action), node.depth + 1);
      node.children.push(child);
      node.probabilities.push(node.actor === "chance" ? provider.chanceProbability(node.sourceState, action) : 1 / actions.length);
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index]);
  }
  const semantic = nodes.map((node) => ({
    sourceState: node.sourceState,
    actor: node.actor,
    informationSetKey: node.informationSetKey,
    actions: node.actions,
    probabilities: node.probabilities,
    children: node.children,
    utilityP0: node.utilityP0,
  }));
  return { rootSourceState, root, nodes, maximumDepth, structuralHash: hashValue(semantic) };
}

function evaluateExtractedUniform(subtree: ExtractedCompactSubtree) {
  const values = new Float64Array(subtree.nodes.length);
  for (let index = subtree.nodes.length - 1; index >= 0; index -= 1) {
    const node = subtree.nodes[index];
    if (node.actor === null) {
      if (node.utilityP0 === null) throw new Error("Extracted terminal has no utility.");
      values[index] = node.utilityP0;
      continue;
    }
    values[index] = node.children.reduce((sum, child, action) => sum + node.probabilities[action] * values[child], 0);
  }
  return values[subtree.root];
}

function evaluateProviderUniform(provider: CompactGameProvider<number>, state: number): number {
  const actor = provider.actor(state);
  if (actor === null) {
    const utility = provider.terminalUtilityP0?.(state) ?? provider.terminalUtility(state)?.[0] ?? null;
    if (utility === null) throw new Error("Provider terminal has no utility.");
    return utility;
  }
  const actions = provider.legalActions(state);
  let result = 0;
  for (const action of actions) {
    const probability = actor === "chance" ? provider.chanceProbability(state, action) : 1 / actions.length;
    result += probability * evaluateProviderUniform(provider, provider.transition(state, action));
  }
  return result;
}

export function validateExtractedSubtree(
  provider: CompactGameProvider<number>,
  subtree: ExtractedCompactSubtree,
  tolerance = 1e-12,
) {
  const issues: string[] = [];
  for (const node of subtree.nodes) {
    if (node.actor === "chance") {
      const total = node.probabilities.reduce((sum, probability) => sum + probability, 0);
      if (Math.abs(total - 1) > tolerance) issues.push(`chance-normalization:${node.id}`);
    }
    if (node.actor === null && (node.utilityP0 === null || !Number.isFinite(node.utilityP0))) issues.push(`terminal-utility:${node.id}`);
    if ((node.actor === 0 || node.actor === 1) && node.informationSetKey === null) issues.push(`information-set:${node.id}`);
  }
  const extractedEv = evaluateExtractedUniform(subtree);
  const providerEv = evaluateProviderUniform(provider, subtree.rootSourceState);
  const evError = Math.abs(extractedEv - providerEv);
  if (evError > tolerance) issues.push("uniform-ev-mismatch");
  return {
    valid: issues.length === 0,
    issues,
    nodes: subtree.nodes.length,
    maximumDepth: subtree.maximumDepth,
    extractedEv,
    providerEv,
    evError,
    tolerance,
    structuralHash: subtree.structuralHash,
    proofScope: "structure, exact chance, utilities, information-set identity, and uniform traversal only; not full-game strategy equivalence",
  };
}
