import type { BehavioralStrategy } from "../../core/types";
import type { UnifiedGameDefinition } from "../unified/game-definition";

export type RenameMapping = {
  informationSetNewToOld: Record<string, string>;
  actionNewToOld: Record<string, string>;
};

export function renameActionsAndInformationSets(definition: UnifiedGameDefinition) {
  const copy = structuredClone(definition);
  const mapping: RenameMapping = { informationSetNewToOld: {}, actionNewToOld: {} };
  Object.values(copy.nodes).forEach((node) => {
    if (node.kind === "chance") {
      node.outcomes = node.outcomes.map((outcome) => ({ ...outcome, action: `chance:${outcome.action}` }));
      return;
    }
    if (node.kind !== "decision") return;
    const oldInformationSet = node.informationSet;
    node.informationSet = `renamed:${oldInformationSet}`;
    mapping.informationSetNewToOld[node.informationSet] = oldInformationSet;
    const oldTransitions = node.transitions;
    node.actions = node.actions.map((action) => {
      const renamed = `renamed:${action}`;
      mapping.actionNewToOld[renamed] = action;
      return renamed;
    });
    node.transitions = Object.fromEntries(node.actions.map((action) => [action, oldTransitions[mapping.actionNewToOld[action]]]));
  });
  copy.id = `${definition.id}:renamed`;
  return { definition: copy, mapping };
}

export function restoreRenamedStrategy(strategy: BehavioralStrategy, mapping: RenameMapping): BehavioralStrategy {
  return Object.fromEntries(Object.entries(strategy).map(([key, actions]) => [
    mapping.informationSetNewToOld[key] ?? key,
    Object.fromEntries(Object.entries(actions).map(([action, probability]) => [mapping.actionNewToOld[action] ?? action, probability])),
  ]));
}

export function reorderChanceBranches(definition: UnifiedGameDefinition) {
  const copy = structuredClone(definition);
  Object.values(copy.nodes).forEach((node) => { if (node.kind === "chance") node.outcomes.reverse(); });
  copy.id = `${definition.id}:chance-reversed`;
  return copy;
}

export function scaleUtilities(definition: UnifiedGameDefinition, factor: number) {
  if (!(factor > 0) || !Number.isFinite(factor)) throw new Error("Utility scale must be positive and finite.");
  const copy = structuredClone(definition);
  Object.values(copy.nodes).forEach((node) => {
    if (node.kind === "terminal") node.utilities = [node.utilities[0] * factor, node.utilities[1] * factor];
  });
  copy.id = `${definition.id}:utility-x${factor}`;
  return copy;
}

export function permutePlayers(definition: UnifiedGameDefinition) {
  const copy = structuredClone(definition);
  const informationSetNewToOld: Record<string, string> = {};
  copy.players = [definition.players[1], definition.players[0]];
  Object.values(copy.nodes).forEach((node) => {
    if (node.kind === "chance") {
      node.outcomes = node.outcomes.map((outcome) => {
        const match = /^private-(\d+)-(\d+)$/.exec(outcome.action);
        return match ? { ...outcome, action: `private-${match[2]}-${match[1]}` } : outcome;
      });
    } else if (node.kind === "decision") {
      const oldInformationSet = node.informationSet;
      node.player = node.player === 0 ? 1 : 0;
      node.informationSet = oldInformationSet.replace(/\|p([01])\|/, (_, player: string) => `|p${player === "0" ? "1" : "0"}|`);
      informationSetNewToOld[node.informationSet] = oldInformationSet;
    } else {
      node.utilities = [node.utilities[1], node.utilities[0]];
    }
  });
  copy.id = `${definition.id}:players-permuted`;
  return { definition: copy, informationSetNewToOld };
}

export function restorePlayerPermutedStrategy(strategy: BehavioralStrategy, informationSetNewToOld: Record<string, string>): BehavioralStrategy {
  return Object.fromEntries(Object.entries(strategy).map(([key, actions]) => [informationSetNewToOld[key] ?? key, actions]));
}
export function permutePrivateStateLabels(definition: UnifiedGameDefinition, privateStates: number) {
  const copy = structuredClone(definition);
  const permute = (state: number) => privateStates - 1 - state;
  Object.values(copy.nodes).forEach((node) => {
    if (node.kind === "chance") {
      node.outcomes = node.outcomes.map((outcome) => {
        const match = /^private-(\d+)-(\d+)$/.exec(outcome.action);
        return match ? { ...outcome, action: `private-${permute(Number(match[1]))}-${permute(Number(match[2]))}` } : outcome;
      });
    }
    if (node.kind === "decision" && node.observation) {
      node.observation.ownPrivateState = permute(node.observation.ownPrivateState);
      node.observation.opponentPrivateState = permute(node.observation.opponentPrivateState);
      node.informationSet = node.informationSet.replace(/own(\d+)/, (_, value: string) => `own${permute(Number(value))}`);
    }
  });
  copy.id = `${definition.id}:private-permuted`;
  return copy;
}
