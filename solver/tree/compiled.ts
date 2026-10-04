import type { ExtensiveGame, Player } from "../core/types";

export type CompiledTerminalNode = {
  kind: "terminal";
  utilities: [number, number];
};

export type CompiledChanceNode<Action extends string> = {
  kind: "chance";
  outcomes: Array<{ action: Action; probability: number; child: CompiledNode<Action> }>;
};

export type CompiledActionNode<Action extends string> = {
  kind: "action";
  player: Player;
  informationSet: string;
  actions: Action[];
  children: CompiledNode<Action>[];
};

export type CompiledNode<Action extends string> =
  | CompiledTerminalNode
  | CompiledChanceNode<Action>
  | CompiledActionNode<Action>;

export type CompiledTreeStatistics = {
  nodes: number;
  terminals: number;
  chanceNodes: number;
  actionNodes: number;
  informationSets: number;
  maximumDepth: number;
};

export function compileGameTree<State, Action extends string>(game: ExtensiveGame<State, Action>) {
  const informationSets = new Set<string>();
  const statistics: CompiledTreeStatistics = {
    nodes: 0,
    terminals: 0,
    chanceNodes: 0,
    actionNodes: 0,
    informationSets: 0,
    maximumDepth: 0,
  };
  const compile = (state: State, depth: number): CompiledNode<Action> => {
    statistics.nodes += 1;
    statistics.maximumDepth = Math.max(statistics.maximumDepth, depth);
    if (game.isTerminal(state)) {
      statistics.terminals += 1;
      return { kind: "terminal", utilities: [game.utility(state, 0), game.utility(state, 1)] };
    }
    const actor = game.actor(state);
    if (actor === null) throw new Error("Non-terminal state has no actor.");
    if (actor === "chance") {
      statistics.chanceNodes += 1;
      const outcomes = game.chanceOutcomes(state);
      const probability = outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
      if (Math.abs(probability - 1) > 1e-9) throw new Error("Chance probabilities must sum to one.");
      return {
        kind: "chance",
        outcomes: outcomes.map((outcome) => ({
          ...outcome,
          child: compile(game.next(state, outcome.action), depth + 1),
        })),
      };
    }
    statistics.actionNodes += 1;
    const actions = [...game.actions(state)];
    const informationSet = game.informationSet(state);
    informationSets.add(informationSet);
    return {
      kind: "action",
      player: actor,
      informationSet,
      actions,
      children: actions.map((action) => compile(game.next(state, action), depth + 1)),
    };
  };
  const root = compile(game.initialState(), 0);
  statistics.informationSets = informationSets.size;
  return { root, statistics };
}
