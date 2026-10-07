import type { BehavioralStrategy, Player } from "../../core/types";
import { compileGameTree, type CompiledNode } from "../../tree/compiled";
import { informationSetStages } from "../unified/information-sets";
import { normalizedProbabilities } from "../unified/utilities";
import type { ResearchStage } from "../unified/game-definition";
import type { UnifiedResearchGame } from "../unified/game-tree";

type RegretState = { actions: string[]; regrets: number[]; sums: number[] };

function regretStrategy(regrets: number[]) {
  const positive = regrets.map((value) => Math.max(0, value));
  const total = positive.reduce((sum, value) => sum + value, 0);
  return total > 1e-15 ? positive.map((value) => value / total) : positive.map(() => 1 / positive.length);
}

export function gameInformationSets(game: UnifiedResearchGame, stage?: ResearchStage) {
  const map = new Map<string, string[]>();
  Object.values(game.definition.nodes).forEach((node) => {
    if (node.kind === "decision" && (!stage || node.stage === stage)) map.set(node.informationSet, [...node.actions]);
  });
  return [...map].sort(([left], [right]) => left.localeCompare(right));
}

export function uniformStageStrategy(game: UnifiedResearchGame, stage?: ResearchStage): BehavioralStrategy {
  return Object.fromEntries(gameInformationSets(game, stage).map(([key, actions]) => [key, Object.fromEntries(actions.map((action) => [action, 1 / actions.length]))]));
}

function solveStage(game: UnifiedResearchGame, target: ResearchStage, fixed: BehavioralStrategy, iterations: number) {
  const tree = compileGameTree(game);
  const stages = informationSetStages(game);
  const states = new Map<string, RegretState>();
  let nodesVisited = 0;
  const getState = (key: string, actions: string[]) => {
    const existing = states.get(key);
    if (existing) return existing;
    const created = { actions: [...actions], regrets: actions.map(() => 0), sums: actions.map(() => 0) };
    states.set(key, created);
    return created;
  };
  const traverse = (node: CompiledNode<string>, updating: Player, reach: [number, number], chanceReach: number): number => {
    nodesVisited += 1;
    if (node.kind === "terminal") return node.utilities[updating];
    if (node.kind === "chance") return node.outcomes.reduce((sum, outcome) => sum + outcome.probability * traverse(outcome.child, updating, reach, chanceReach * outcome.probability), 0);
    const isTarget = stages[node.informationSet] === target;
    const state = isTarget ? getState(node.informationSet, node.actions) : null;
    const strategy = state ? regretStrategy(state.regrets) : normalizedProbabilities(node.actions, fixed[node.informationSet]);
    const utilities = node.children.map((child, index) => {
      const nextReach: [number, number] = [...reach];
      nextReach[node.player] *= strategy[index];
      return traverse(child, updating, nextReach, chanceReach);
    });
    const value = utilities.reduce((sum, utility, index) => sum + utility * strategy[index], 0);
    if (state && node.player === updating) {
      const counterfactualReach = chanceReach * reach[node.player === 0 ? 1 : 0];
      const ownReach = chanceReach * reach[node.player];
      state.regrets = state.regrets.map((regret, index) => regret + counterfactualReach * (utilities[index] - value));
      state.sums = state.sums.map((sum, index) => sum + ownReach * strategy[index]);
    }
    return value;
  };
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    traverse(tree.root, 0, [1, 1], 1);
    traverse(tree.root, 1, [1, 1], 1);
  }
  const strategy = Object.fromEntries([...states].map(([key, state]) => {
    const total = state.sums.reduce((sum, value) => sum + value, 0);
    const probabilities = total > 1e-15 ? state.sums.map((value) => value / total) : regretStrategy(state.regrets);
    return [key, Object.fromEntries(state.actions.map((action, index) => [action, probabilities[index]]))];
  }));
  const positive = [...states.values()].flatMap((state) => state.regrets.map((value) => Math.max(0, value)));
  return {
    strategy,
    nodesVisited,
    informationSets: states.size,
    averagePositiveRegret: positive.length ? positive.reduce((sum, value) => sum + value, 0) / positive.length / Math.max(1, iterations) : 0,
  };
}

export function continuationStateDistribution(game: UnifiedResearchGame, strategy: BehavioralStrategy) {
  const entries: Array<{ nodeId: string; reach: number }> = [];
  const visit = (state: ReturnType<UnifiedResearchGame["initialState"]>, reach: number) => {
    const node = game.definition.nodes[state.nodeId];
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      node.outcomes.forEach((outcome) => visit(game.next(state, outcome.action), reach * outcome.probability));
      return;
    }
    if (node.stage === "continuation") entries.push({ nodeId: node.id, reach });
    const probabilities = normalizedProbabilities(node.actions, strategy[node.informationSet]);
    node.actions.forEach((action, index) => visit(game.next(state, action), reach * probabilities[index]));
  };
  visit(game.initialState(), 1);
  const total = entries.reduce((sum, entry) => sum + entry.reach, 0);
  return entries.map((entry) => ({ ...entry, conditionalProbability: total > 0 ? entry.reach / total : 0 }));
}

export class ContinuationOperator {
  constructor(readonly game: UnifiedResearchGame, readonly innerIterations: number) {}

  map(initialStrategy: BehavioralStrategy) {
    const continuation = solveStage(this.game, "continuation", initialStrategy, this.innerIterations);
    const initial = solveStage(this.game, "initial", continuation.strategy, this.innerIterations);
    const completeStrategy = { ...initial.strategy, ...continuation.strategy };
    return {
      initialStrategy: initial.strategy,
      continuationStrategy: continuation.strategy,
      completeStrategy,
      conditionalDistribution: continuationStateDistribution(this.game, completeStrategy),
      nodesVisited: initial.nodesVisited + continuation.nodesVisited,
      averagePositiveRegret: (initial.averagePositiveRegret + continuation.averagePositiveRegret) / 2,
    };
  }
}
