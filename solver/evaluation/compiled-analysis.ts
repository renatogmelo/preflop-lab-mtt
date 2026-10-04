import type { BehavioralStrategy, Player } from "../core/types";
import type { CompiledNode } from "../tree/compiled";

export type CompiledBestResponseResult = {
  player: Player;
  value: number;
  policy: Record<string, string>;
  informationSets: number;
  nodesVisited: number;
};

export type CompiledStrategyEvaluation = {
  utilities: [number, number];
  bestResponses: [CompiledBestResponseResult, CompiledBestResponseResult];
  nashConv: number;
  exploitability: number;
};

export type StrategyStabilityMetrics = {
  maxStrategyDelta: number;
  activeInfosetDelta: number;
  reachWeightedStrategyDelta: number;
  probabilityMassWeightedDelta: number;
  activeInformationSets: number;
  comparedInformationSets: number;
  totalReachMass: number;
  activeReachThreshold: number;
};

export type CounterfactualActionDiagnostic = {
  informationSet: string;
  player: Player;
  reach: number;
  counterfactualReach: number;
  probabilities: Record<string, number>;
  actionEvs: Record<string, number | null>;
  regrets: Record<string, number | null>;
  strategyEv: number | null;
  mixedActionEvSpread: number | null;
};

function probabilities(actions: readonly string[], key: string, strategy: BehavioralStrategy) {
  const supplied = actions.map((action) => strategy[key]?.[action]);
  if (supplied.every((value) => value === undefined)) return actions.map(() => 1 / actions.length);
  const values = supplied.map((value) => value ?? 0);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid strategy probability at ${key}.`);
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 1e-15)) throw new Error(`Strategy at ${key} has zero probability mass.`);
  return values.map((value) => value / total);
}

export function evaluateCompiledNode<Action extends string>(
  node: CompiledNode<Action>,
  strategy: BehavioralStrategy,
): [number, number] {
  if (node.kind === "terminal") return [...node.utilities];
  if (node.kind === "chance") {
    const result: [number, number] = [0, 0];
    node.outcomes.forEach((outcome) => {
      const child = evaluateCompiledNode(outcome.child, strategy);
      result[0] += outcome.probability * child[0];
      result[1] += outcome.probability * child[1];
    });
    return result;
  }
  const actionProbabilities = probabilities(node.actions, node.informationSet, strategy);
  const result: [number, number] = [0, 0];
  node.children.forEach((child, index) => {
    const value = evaluateCompiledNode(child, strategy);
    result[0] += actionProbabilities[index] * value[0];
    result[1] += actionProbabilities[index] * value[1];
  });
  return result;
}

type ResponseNode<Action extends string> = {
  node: CompiledNode<Action>;
  depth: number;
  counterfactualReach: number;
};

export class CompiledBestResponseEvaluator<Action extends string> {
  constructor(readonly root: CompiledNode<Action>) {}

  evaluate(player: Player, strategy: BehavioralStrategy): CompiledBestResponseResult {
    let nodesVisited = 0;
    const groups = new Map<string, ResponseNode<Action>[]>();

    const collect = (node: CompiledNode<Action>, depth: number, counterfactualReach: number) => {
      nodesVisited += 1;
      if (node.kind === "terminal") return;
      if (node.kind === "chance") {
        node.outcomes.forEach((outcome) => collect(
          outcome.child,
          depth + 1,
          counterfactualReach * outcome.probability,
        ));
        return;
      }
      const actionProbabilities = probabilities(node.actions, node.informationSet, strategy);
      node.children.forEach((child, index) => collect(
        child,
        depth + 1,
        node.player === player
          ? counterfactualReach
          : counterfactualReach * actionProbabilities[index],
      ));
      if (node.player === player) {
        const group = groups.get(node.informationSet) ?? [];
        group.push({ node, depth, counterfactualReach });
        groups.set(node.informationSet, group);
      }
    };
    collect(this.root, 0, 1);

    const policy = new Map<string, string>();
    const value = (node: CompiledNode<Action>): number => {
      let result: number;
      if (node.kind === "terminal") {
        result = node.utilities[player];
      } else if (node.kind === "chance") {
        result = node.outcomes.reduce(
          (sum, outcome) => sum + outcome.probability * value(outcome.child),
          0,
        );
      } else if (node.player === player) {
        const selected = policy.get(node.informationSet);
        if (!selected) throw new Error("Compiled best-response information sets were not solved in reverse depth order.");
        const index = node.actions.indexOf(selected as Action);
        if (index < 0) throw new Error("Compiled best-response policy selected an illegal action.");
        result = value(node.children[index]);
      } else {
        const actionProbabilities = probabilities(node.actions, node.informationSet, strategy);
        result = node.children.reduce(
          (sum, child, index) => sum + actionProbabilities[index] * value(child),
          0,
        );
      }
      return result;
    };

    const ordered = [...groups.entries()].sort(([, left], [, right]) => (
      Math.max(...right.map((entry) => entry.depth)) - Math.max(...left.map((entry) => entry.depth))
    ));
    ordered.forEach(([key, entries]) => {
      const actions = entries[0].node.kind === "action" ? entries[0].node.actions : [];
      if (entries.some((entry) => entry.node.kind !== "action" || entry.node.actions.join("|") !== actions.join("|"))) {
        throw new Error(`Information set ${key} has inconsistent legal actions.`);
      }
      let selected = actions[0];
      let best = Number.NEGATIVE_INFINITY;
      actions.forEach((action, actionIndex) => {
        const candidate = entries.reduce((sum, entry) => {
          if (entry.node.kind !== "action") return sum;
          return sum + entry.counterfactualReach * value(entry.node.children[actionIndex]);
        }, 0);
        if (candidate > best + 1e-15) {
          best = candidate;
          selected = action;
        }
      });
      policy.set(key, selected);
    });

    return {
      player,
      value: value(this.root),
      policy: Object.fromEntries(policy),
      informationSets: groups.size,
      nodesVisited,
    };
  }
}

export class CompiledNashConvEvaluator<Action extends string> {
  readonly bestResponse: CompiledBestResponseEvaluator<Action>;

  constructor(readonly root: CompiledNode<Action>) {
    this.bestResponse = new CompiledBestResponseEvaluator(root);
  }

  evaluate(strategy: BehavioralStrategy): CompiledStrategyEvaluation {
    const utilities = evaluateCompiledNode(this.root, strategy);
    if (Math.abs(utilities[0] + utilities[1]) > 1e-8) {
      throw new Error("Compiled NashConv evaluation requires a zero-sum game.");
    }
    const first = this.bestResponse.evaluate(0, strategy);
    const second = this.bestResponse.evaluate(1, strategy);
    const nashConv = first.value + second.value;
    return {
      utilities,
      bestResponses: [first, second],
      nashConv,
      exploitability: nashConv / 2,
    };
  }
}

export function compiledInformationSetReach<Action extends string>(
  root: CompiledNode<Action>,
  strategy: BehavioralStrategy,
) {
  const reaches: Record<string, number> = {};
  const visit = (node: CompiledNode<Action>, reach: number) => {
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      node.outcomes.forEach((outcome) => visit(outcome.child, reach * outcome.probability));
      return;
    }
    reaches[node.informationSet] = (reaches[node.informationSet] ?? 0) + reach;
    const actionProbabilities = probabilities(node.actions, node.informationSet, strategy);
    node.children.forEach((child, index) => visit(child, reach * actionProbabilities[index]));
  };
  visit(root, 1);
  return reaches;
}

export function strategyStability(
  previous: BehavioralStrategy,
  current: BehavioralStrategy,
  informationSetReach: Record<string, number>,
  activeReachThreshold = 1e-9,
): StrategyStabilityMetrics {
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(current)])];
  let maxStrategyDelta = 0;
  let activeInfosetDelta = 0;
  let weightedTotalVariation = 0;
  let weightedActionDelta = 0;
  let weightedActions = 0;
  let totalReachMass = 0;
  let activeInformationSets = 0;

  keys.forEach((key) => {
    const actions = [...new Set([
      ...Object.keys(previous[key] ?? {}),
      ...Object.keys(current[key] ?? {}),
    ])];
    const left = probabilities(actions, key, previous);
    const right = probabilities(actions, key, current);
    const deltas = actions.map((_, index) => Math.abs(left[index] - right[index]));
    const maximum = deltas.reduce((value, delta) => Math.max(value, delta), 0);
    const totalVariation = deltas.reduce((sum, delta) => sum + delta, 0) / 2;
    const reach = informationSetReach[key] ?? 0;
    maxStrategyDelta = Math.max(maxStrategyDelta, maximum);
    if (reach > activeReachThreshold) {
      activeInformationSets += 1;
      activeInfosetDelta = Math.max(activeInfosetDelta, maximum);
    }
    totalReachMass += reach;
    weightedTotalVariation += reach * totalVariation;
    weightedActionDelta += reach * deltas.reduce((sum, delta) => sum + delta, 0);
    weightedActions += reach * Math.max(1, actions.length);
  });

  return {
    maxStrategyDelta,
    activeInfosetDelta,
    reachWeightedStrategyDelta: totalReachMass > 0 ? weightedTotalVariation / totalReachMass : 0,
    probabilityMassWeightedDelta: weightedActions > 0 ? weightedActionDelta / weightedActions : 0,
    activeInformationSets,
    comparedInformationSets: keys.length,
    totalReachMass,
    activeReachThreshold,
  };
}

export function counterfactualActionDiagnostics<Action extends string>(
  root: CompiledNode<Action>,
  strategy: BehavioralStrategy,
  player: Player,
  mixedProbabilityFloor = 1e-4,
): CounterfactualActionDiagnostic[] {
  type Entry = { node: CompiledNode<Action>; counterfactualReach: number; fullReach: number };
  const groups = new Map<string, Entry[]>();
  const visit = (
    node: CompiledNode<Action>,
    counterfactualReach: number,
    fullReach: number,
  ) => {
    if (node.kind === "terminal") return;
    if (node.kind === "chance") {
      node.outcomes.forEach((outcome) => visit(
        outcome.child,
        counterfactualReach * outcome.probability,
        fullReach * outcome.probability,
      ));
      return;
    }
    const actionProbabilities = probabilities(node.actions, node.informationSet, strategy);
    if (node.player === player) {
      const group = groups.get(node.informationSet) ?? [];
      group.push({ node, counterfactualReach, fullReach });
      groups.set(node.informationSet, group);
    }
    node.children.forEach((child, index) => visit(
      child,
      node.player === player
        ? counterfactualReach
        : counterfactualReach * actionProbabilities[index],
      fullReach * actionProbabilities[index],
    ));
  };
  visit(root, 1, 1);

  const valueMemo = new WeakMap<object, [number, number]>();
  const value = (node: CompiledNode<Action>): [number, number] => {
    const cached = valueMemo.get(node as object);
    if (cached) return cached;
    const result = evaluateCompiledNode(node, strategy);
    valueMemo.set(node as object, result);
    return result;
  };

  return [...groups.entries()].map(([informationSet, entries]) => {
    const actionNode = entries[0].node;
    if (actionNode.kind !== "action") throw new Error("Counterfactual group contains a non-action node.");
    const actions = actionNode.actions;
    if (entries.some((entry) => entry.node.kind !== "action" || entry.node.actions.join("|") !== actions.join("|"))) {
      throw new Error(`Information set ${informationSet} has inconsistent legal actions.`);
    }
    const denominator = entries.reduce((sum, entry) => sum + entry.counterfactualReach, 0);
    const actionEvs: Record<string, number | null> = {};
    actions.forEach((action, index) => {
      actionEvs[action] = denominator > 1e-15
        ? entries.reduce((sum, entry) => {
          if (entry.node.kind !== "action") return sum;
          return sum + entry.counterfactualReach * value(entry.node.children[index])[player];
        }, 0) / denominator
        : null;
    });
    const actionProbabilities = probabilities(actions, informationSet, strategy);
    const strategyEv = denominator > 1e-15
      ? actions.reduce((sum, action, index) => sum + actionProbabilities[index] * Number(actionEvs[action]), 0)
      : null;
    const regrets = Object.fromEntries(actions.map((action) => [
      action,
      strategyEv === null || actionEvs[action] === null ? null : Number(actionEvs[action]) - strategyEv,
    ]));
    const mixedValues = actions
      .map((action, index) => ({ probability: actionProbabilities[index], ev: actionEvs[action] }))
      .filter((entry) => entry.probability >= mixedProbabilityFloor && entry.ev !== null)
      .map((entry) => Number(entry.ev));
    return {
      informationSet,
      player,
      reach: entries.reduce((sum, entry) => sum + entry.fullReach, 0),
      counterfactualReach: denominator,
      probabilities: Object.fromEntries(actions.map((action, index) => [action, actionProbabilities[index]])),
      actionEvs,
      regrets,
      strategyEv,
      mixedActionEvSpread: mixedValues.length >= 2 ? Math.max(...mixedValues) - Math.min(...mixedValues) : null,
    };
  }).sort((left, right) => right.reach - left.reach || left.informationSet.localeCompare(right.informationSet));
}
