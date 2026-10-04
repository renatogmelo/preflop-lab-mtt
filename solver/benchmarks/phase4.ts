import { resolve } from "node:path";
import { CfrPlus, Dcfr, VanillaCfr } from "../algorithms/cfr";
import { createCombo, createHoldemDeck } from "../cards/cards";
import { EquityProvider, SubgameSolverProvider } from "../continuation/engine";
import { StrengthProxyProvider } from "../continuation/strength-proxy";
import { solvePostflopSubgame } from "../continuation/subgame-solver";
import { hashValue } from "../core/stable";
import { StrategyEvaluator } from "../evaluation/best-response";
import { HoldemPreflopV2Solver } from "../game/holdem-preflop-v2";
import { WeightedRange } from "../cards/range";
import { inspectLeducTree, LeducPoker } from "../games/leduc";
import { writeJson } from "../storage/files";

const deck = createHoldemDeck();
const card = (notation: string) => {
  const found = deck.find((candidate) => candidate.notation === notation);
  if (!found) throw new Error(`Unknown benchmark card ${notation}.`);
  return found;
};

function leducBenchmark(iterations: number) {
  const game = new LeducPoker();
  const solvers = [
    new VanillaCfr(game, { seed: 7 }),
    new CfrPlus(game, { seed: 7, cfrPlusAveragingDelay: 100 }),
    new Dcfr(game, { seed: 7, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } }),
  ];
  return {
    variant: game.definition,
    tree: inspectLeducTree(game),
    publishedPlayerZeroValue: -0.085606,
    uniformPolicyOracle: { playerZeroValue: -0.078125, nashConv: 4.747222222222222 },
    algorithms: solvers.map((solver) => {
      const result = solver.solve({ maxIterations: iterations, metricInterval: Math.max(1, Math.floor(iterations / 4)) });
      const utilities = new StrategyEvaluator(game).evaluate(result.strategy);
      return {
        algorithm: solver.configuration.algorithm,
        utilities,
        metrics: result.metrics,
        strategyHash: hashValue(result.strategy),
      };
    }),
  };
}

function preflopV2(iterations: number) {
  const configuration = {
    id: "hu-preflop-v2-10bb-phase4",
    seed: 42,
    iterations,
    metricInterval: Math.max(1, Math.floor(iterations / 5)),
    stack: 10,
    smallBlind: 0.5,
    bigBlind: 1,
    sbOpenRaiseTo: [2, 2.5],
    bbVsLimpRaiseTo: [3],
    bbThreeBetTo: [7.5],
    sbFourBetTo: [9],
    maximumRaises: 3,
    continuationBoard: [],
    continuationAbstractionId: "strength-proxy-v1",
  };
  const solver = new HoldemPreflopV2Solver(configuration, new StrengthProxyProvider());
  const estimate = solver.estimateTree();
  const artifact = solver.solve();
  return { estimate, artifact };
}

async function main() {
  const hero = createCombo(card("As"), card("Ah"));
  const villain = createCombo(card("Kd"), card("Kc"));
  const flop: [ReturnType<typeof card>, ReturnType<typeof card>, ReturnType<typeof card>] = [card("2s"), card("3d"), card("4c")];
  const continuation = solvePostflopSubgame({
    id: "fixed-flop-aa-vs-kk-proof-v1",
    hero,
    villain,
    flop,
    pot: 4,
    stacks: [8, 8],
    firstPlayer: 0,
    abstraction: { flopBetFractions: [], turnBetFractions: [], riverBetFractions: [0.5], maxRaisesPerStreet: 0 },
  }, { algorithm: "dcfr", iterations: 200, metricInterval: 50, seed: 9 });

  const request = {
    state: {
      street: "flop" as const,
      board: [...flop],
      pot: 4,
      stacks: [8, 8] as [number, number],
      contributions: [2, 2] as [number, number],
      actingPlayer: 0 as const,
      inPositionPlayer: 0 as const,
      actionHistory: ["preflop-call"],
    },
    ranges: {
      playerZero: new WeightedRange([{ combo: hero, weight: 1 }]),
      playerOne: new WeightedRange([{ combo: villain, weight: 1 }]),
      fixedCombos: [hero, villain] as [typeof hero, typeof villain],
    },
    context: { abstractionId: "fixed-flop-river-half-pot-v1" },
  };
  const providers = [
    new StrengthProxyProvider(),
    new EquityProvider(undefined, { exactThreshold: 10_000 }),
    new SubgameSolverProvider(() => ({
      utilities: continuation.utilities,
      artifactId: continuation.id,
      exploitability: continuation.convergence.exploitability ?? Number.NaN,
      nashConv: continuation.convergence.nashConv ?? Number.NaN,
      iterations: continuation.convergence.iteration,
    })),
  ];
  const comparison = providers.map((provider) => ({
    provider: provider.id,
    level: provider.level,
    result: provider.evaluate(request),
  }));

  const artifact = {
    schemaVersion: 1,
    phase: 4,
    createdAt: "2026-10-03T00:00:00.000Z",
    leduc: leducBenchmark(2_000),
    holdemPreflopV2: preflopV2(5_000),
    continuation,
    continuationComparison: {
      scenario: { hero: hero.notation, villain: villain.notation, board: flop.map((item) => item.notation), pot: 4 },
      providers: comparison,
      limitation: "This compares continuation utilities on one fixed flop. A full preflop strategy-sensitivity solve across all flops remains pending and is not inferred from these values.",
    },
  };
  await writeJson(resolve("solver/artifacts/phase4-validation-v0.2.0.json"), artifact);
  process.stdout.write(JSON.stringify({
    leduc: artifact.leduc.algorithms.map((entry) => ({ algorithm: entry.algorithm, utilities: entry.utilities, exploitability: entry.metrics.exploitability, runtimeMs: entry.metrics.elapsedMs })),
    preflopV2: { tree: artifact.holdemPreflopV2.estimate, metrics: artifact.holdemPreflopV2.artifact.metrics.at(-1) },
    continuation: { tree: continuation.tree, utilities: continuation.utilities, exploitability: continuation.convergence.exploitability },
    comparison: comparison.map((entry) => ({ provider: entry.provider, utilities: entry.result.utilities })),
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
