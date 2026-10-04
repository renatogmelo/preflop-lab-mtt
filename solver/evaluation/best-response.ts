import type {
  BehavioralStrategy,
  ExtensiveGame,
  Player,
} from "../core/types";

type EvaluationNode<State, Action extends string> = {
  state: State;
  actor: Player | "chance" | null;
  depth: number;
  counterfactualReach: number;
  actions: Action[];
  children: Map<Action, EvaluationNode<State, Action>>;
};

export type BestResponseResult<Action extends string> = {
  player: Player;
  value: number;
  policy: Record<string, Action>;
  informationSets: number;
  nodesVisited: number;
};

export type StrategyEvaluation = {
  utilities: [number, number];
  bestResponses: [BestResponseResult<string>, BestResponseResult<string>];
  nashConv: number;
  exploitability: number;
};

function normalizedActionProbabilities<Action extends string>(
  actions: readonly Action[],
  key: string,
  strategy: BehavioralStrategy,
) {
  const supplied = actions.map((action) => strategy[key]?.[action]);
  if (supplied.every((value) => value === undefined)) {
    return actions.map(() => 1 / actions.length);
  }
  const values = supplied.map((value) => value ?? 0);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid strategy probability at ${key}.`);
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 1e-15) throw new Error(`Strategy at ${key} has zero probability mass.`);
  return values.map((value) => value / total);
}

export class StrategyEvaluator<State, Action extends string> {
  constructor(readonly game: ExtensiveGame<State, Action>) {}

  private value(state: State, strategy: BehavioralStrategy, player: Player): number {
    if (this.game.isTerminal(state)) return this.game.utility(state, player);
    const actor = this.game.actor(state);
    if (actor === null) throw new Error("Non-terminal state has no actor.");
    if (actor === "chance") {
      const outcomes = this.game.chanceOutcomes(state);
      const total = outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
      if (Math.abs(total - 1) > 1e-9) throw new Error("Chance probabilities must sum to one.");
      return outcomes.reduce(
        (sum, outcome) => sum + outcome.probability * this.value(this.game.next(state, outcome.action), strategy, player),
        0,
      );
    }
    const actions = [...this.game.actions(state)];
    const key = this.game.informationSet(state);
    const probabilities = normalizedActionProbabilities(actions, key, strategy);
    return actions.reduce(
      (sum, action, index) => sum + probabilities[index] * this.value(this.game.next(state, action), strategy, player),
      0,
    );
  }

  evaluate(strategy: BehavioralStrategy): [number, number] {
    return [
      this.value(this.game.initialState(), strategy, 0),
      this.value(this.game.initialState(), strategy, 1),
    ];
  }
}

/**
 * Exact best response for finite, two-player, perfect-recall games.
 *
 * The response is selected once per information set, never independently per
 * history. Information sets are solved from leaves to root. Candidate action
 * values are weighted only by chance and opponent reach, which is the
 * counterfactual reach required by a best response.
 */
export class BestResponseEvaluator<State, Action extends string> {
  constructor(readonly game: ExtensiveGame<State, Action>) {}

  evaluate(player: Player, strategy: BehavioralStrategy): BestResponseResult<Action> {
    let nodesVisited = 0;
    const informationSets = new Map<string, EvaluationNode<State, Action>[]>();

    const build = (state: State, depth: number, counterfactualReach: number): EvaluationNode<State, Action> => {
      nodesVisited += 1;
      if (this.game.isTerminal(state)) {
        return { state, actor: null, depth, counterfactualReach, actions: [], children: new Map() };
      }
      const actor = this.game.actor(state);
      if (actor === null) throw new Error("Non-terminal state has no actor.");
      if (actor === "chance") {
        const outcomes = this.game.chanceOutcomes(state);
        const total = outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
        if (Math.abs(total - 1) > 1e-9) throw new Error("Chance probabilities must sum to one.");
        const node: EvaluationNode<State, Action> = {
          state,
          actor,
          depth,
          counterfactualReach,
          actions: outcomes.map((outcome) => outcome.action),
          children: new Map(),
        };
        outcomes.forEach((outcome) => node.children.set(
          outcome.action,
          build(this.game.next(state, outcome.action), depth + 1, counterfactualReach * outcome.probability),
        ));
        return node;
      }

      const actions = [...this.game.actions(state)];
      const key = this.game.informationSet(state);
      const probabilities = actor === player
        ? actions.map(() => 1)
        : normalizedActionProbabilities(actions, key, strategy);
      const node: EvaluationNode<State, Action> = {
        state,
        actor,
        depth,
        counterfactualReach,
        actions,
        children: new Map(),
      };
      actions.forEach((action, index) => node.children.set(
        action,
        build(
          this.game.next(state, action),
          depth + 1,
          actor === player ? counterfactualReach : counterfactualReach * probabilities[index],
        ),
      ));
      if (actor === player) {
        const group = informationSets.get(key) ?? [];
        group.push(node);
        informationSets.set(key, group);
      }
      return node;
    };

    const root = build(this.game.initialState(), 0, 1);
    const policy = new Map<string, Action>();
    const value = (node: EvaluationNode<State, Action>): number => {
      if (node.actor === null) return this.game.utility(node.state, player);
      if (node.actor === "chance") {
        const outcomes = this.game.chanceOutcomes(node.state);
        return outcomes.reduce(
          (sum, outcome) => sum + outcome.probability * value(node.children.get(outcome.action)!),
          0,
        );
      }
      if (node.actor === player) {
        const selected = policy.get(this.game.informationSet(node.state));
        if (!selected) throw new Error("Best-response information sets were not solved in reverse depth order.");
        return value(node.children.get(selected)!);
      }
      const key = this.game.informationSet(node.state);
      const probabilities = normalizedActionProbabilities(node.actions, key, strategy);
      return node.actions.reduce(
        (sum, action, index) => sum + probabilities[index] * value(node.children.get(action)!),
        0,
      );
    };

    const ordered = [...informationSets.entries()].sort(([, left], [, right]) => {
      const leftDepth = Math.max(...left.map((node) => node.depth));
      const rightDepth = Math.max(...right.map((node) => node.depth));
      return rightDepth - leftDepth;
    });

    ordered.forEach(([key, nodes]) => {
      const actions = nodes[0].actions;
      if (nodes.some((node) => node.actions.join("|") !== actions.join("|"))) {
        throw new Error(`Information set ${key} has inconsistent legal actions.`);
      }
      let bestAction = actions[0];
      let bestValue = Number.NEGATIVE_INFINITY;
      actions.forEach((action) => {
        const actionValue = nodes.reduce(
          (sum, node) => sum + node.counterfactualReach * value(node.children.get(action)!),
          0,
        );
        if (actionValue > bestValue + 1e-15) {
          bestValue = actionValue;
          bestAction = action;
        }
      });
      policy.set(key, bestAction);
    });

    return {
      player,
      value: value(root),
      policy: Object.fromEntries(policy),
      informationSets: informationSets.size,
      nodesVisited,
    };
  }
}

export class NashConvEvaluator<State, Action extends string> {
  readonly strategyEvaluator: StrategyEvaluator<State, Action>;
  readonly bestResponseEvaluator: BestResponseEvaluator<State, Action>;

  constructor(readonly game: ExtensiveGame<State, Action>) {
    this.strategyEvaluator = new StrategyEvaluator(game);
    this.bestResponseEvaluator = new BestResponseEvaluator(game);
  }

  evaluate(strategy: BehavioralStrategy): StrategyEvaluation {
    const utilities = this.strategyEvaluator.evaluate(strategy);
    if (Math.abs(utilities[0] + utilities[1]) > 1e-8) {
      throw new Error("NashConvEvaluator requires a two-player zero-sum game.");
    }
    const first = this.bestResponseEvaluator.evaluate(0, strategy);
    const second = this.bestResponseEvaluator.evaluate(1, strategy);
    const nashConv = first.value + second.value;
    return {
      utilities,
      bestResponses: [first as BestResponseResult<string>, second as BestResponseResult<string>],
      nashConv,
      exploitability: nashConv / 2,
    };
  }
}
