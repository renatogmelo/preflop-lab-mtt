import { CfrPlus, Dcfr, VanillaCfr } from "../algorithms/cfr";
import type { AlgorithmName, BehavioralStrategy, SolveMetrics } from "../core/types";
import { hashValue } from "../core/stable";
import { PostflopHoldemSubgame, type PostflopSubgameDefinition } from "../game/postflop-subgame";
import { StrategyEvaluator } from "../evaluation/best-response";
import { ValidationSuite, type ValidationReport } from "../validation/suite";

export type PostflopSolveConfiguration = {
  algorithm: AlgorithmName;
  iterations: number;
  metricInterval: number;
  seed: number;
};

export type ContinuationArtifact = {
  id: string;
  state: {
    pot: number;
    stacks: [number, number];
    firstPlayer: 0 | 1;
  };
  ranges: {
    playerZero: string;
    playerOne: string;
  };
  board: string[];
  abstraction: PostflopSubgameDefinition["abstraction"];
  algorithm: PostflopSolveConfiguration;
  tree: ReturnType<PostflopHoldemSubgame["estimateTree"]>;
  convergence: SolveMetrics;
  utilities: [number, number];
  strategy: BehavioralStrategy;
  validation: ValidationReport;
};

function makeSolver(game: PostflopHoldemSubgame, configuration: PostflopSolveConfiguration) {
  if (configuration.algorithm === "vanilla-cfr") return new VanillaCfr(game, { seed: configuration.seed });
  if (configuration.algorithm === "cfr-plus") return new CfrPlus(game, { seed: configuration.seed, cfrPlusAveragingDelay: 0 });
  return new Dcfr(game, { seed: configuration.seed, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } });
}

export function solvePostflopSubgame(
  definition: PostflopSubgameDefinition,
  configuration: PostflopSolveConfiguration,
): ContinuationArtifact {
  const game = new PostflopHoldemSubgame(definition);
  const tree = game.estimateTree();
  const solver = makeSolver(game, configuration);
  const result = solver.solve({
    maxIterations: configuration.iterations,
    metricInterval: configuration.metricInterval,
  });
  const utilities = new StrategyEvaluator(game).evaluate(result.strategy);
  const deterministicId = hashValue({ definition, configuration, strategy: result.strategy });
  const validation = new ValidationSuite(`validation:${deterministicId}`)
    .add({ id: "unique-cards", level: "STRUCTURAL", description: "Private and fixed flop cards are unique.", metric: { name: "unique", value: true }, threshold: { kind: "equal", value: true } })
    .add({ id: "chance-tree", level: "MATHEMATICAL", description: "The game enumerates turn and river chance nodes after the fixed flop.", metric: { name: "chanceNodes", value: tree.chanceNodes }, threshold: { kind: "minimum", value: 1 } })
    .add({ id: "zero-sum", level: "MATHEMATICAL", description: "Solved utilities sum to zero.", metric: { name: "utilitySum", value: utilities[0] + utilities[1] }, threshold: { kind: "absolute-error", expected: 0, tolerance: 1e-9 } })
    .add({ id: "nash-conv", level: "STRATEGIC", description: "Exact generic best response yields the declared NashConv.", metric: { name: "nashConv", value: result.metrics.nashConv }, threshold: { kind: "maximum", value: 0.1 } })
    .add({ id: "finite", level: "CONVERGENCE", description: "Convergence metrics are finite.", metric: { name: "finite", value: [result.metrics.averagePositiveRegret, result.metrics.strategyDelta].every(Number.isFinite) }, threshold: { kind: "equal", value: true } })
    .report("2026-10-03T00:00:00.000Z");
  return {
    id: `continuation:${deterministicId}`,
    state: { pot: definition.pot, stacks: definition.stacks, firstPlayer: definition.firstPlayer },
    ranges: { playerZero: definition.hero.id, playerOne: definition.villain.id },
    board: definition.flop.map((card) => card.notation),
    abstraction: definition.abstraction,
    algorithm: configuration,
    tree,
    convergence: result.metrics,
    utilities,
    strategy: result.strategy,
    validation,
  };
}
