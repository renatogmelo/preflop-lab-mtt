import { CfrPlus, Dcfr, VanillaCfr } from "../algorithms/cfr";
import { IndexedCfrSolver } from "../algorithms/indexed-cfr";
import { createHoldemDeck, type HoleCombo, type SolverCard } from "../cards/cards";
import { compareHoldemHands } from "../cards/hand-evaluator";
import { privateDealDistribution, type PrivateDealOutcome } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import { hashValue } from "../core/stable";
import type { AlgorithmName, BehavioralStrategy, DcfrParameters, ExtensiveGame, Player, SolveMetrics } from "../core/types";
import { evaluateCompiledNode } from "../evaluation/compiled-analysis";
import { compileGameTree, type CompiledGameTree } from "../tree/compiled";
import { ValidationSuite, type ValidationReport } from "../validation/suite";

export type RangePostflopStreet = "flop" | "turn" | "river";
export type RangePostflopAction =
  | `private:${number}`
  | `deal:${number}`
  | "check"
  | "fold"
  | "call"
  | "jam"
  | `bet:${number}`
  | `raise:${number}`;

export type RangePostflopAbstraction = {
  flopBetFractions: number[];
  turnBetFractions: number[];
  riverBetFractions: number[];
  raisePotFractions: number[];
  maxRaisesPerStreet: 0 | 1;
  jamAllowed: boolean;
};

export type BoardChanceOutcome = { card: SolverCard; probability: number; representedCards: number };

export interface FutureBoardProvider {
  readonly id: string;
  readonly method: "exact-enumeration" | "sampled" | "abstracted";
  outcomes(available: SolverCard[], street: "turn" | "river"): BoardChanceOutcome[];
  metadata(): Record<string, unknown>;
}

export class ExactBoardEnumerationProvider implements FutureBoardProvider {
  readonly id = "exact-board-enumeration-v1";
  readonly method = "exact-enumeration" as const;

  outcomes(available: SolverCard[]) {
    return available.map((card) => ({ card, probability: 1 / available.length, representedCards: 1 }));
  }

  metadata() {
    return { id: this.id, method: this.method };
  }
}

export class BucketedBoardProvider implements FutureBoardProvider {
  readonly id: string;
  readonly method = "abstracted" as const;

  constructor(readonly maximumOutcomes: number) {
    if (!Number.isInteger(maximumOutcomes) || maximumOutcomes <= 0) throw new Error("Board abstraction requires a positive outcome count.");
    this.id = `bucketed-board-v1-${maximumOutcomes}`;
  }

  outcomes(available: SolverCard[]) {
    if (available.length <= this.maximumOutcomes) {
      return available.map((card) => ({ card, probability: 1 / available.length, representedCards: 1 }));
    }
    const buckets: SolverCard[][] = Array.from({ length: this.maximumOutcomes }, () => []);
    available.forEach((card, index) => buckets[index % buckets.length].push(card));
    return buckets.map((bucket) => ({
      card: bucket[Math.floor(bucket.length / 2)],
      probability: bucket.length / available.length,
      representedCards: bucket.length,
    }));
  }

  metadata() {
    return {
      id: this.id,
      method: this.method,
      maximumOutcomes: this.maximumOutcomes,
      warning: "Each deterministic bucket is represented by one physical card; this changes the solved game.",
    };
  }
}

export type RangePostflopSubgameDefinition = {
  id: string;
  ranges: [WeightedRange, WeightedRange];
  flop: [SolverCard, SolverCard, SolverCard];
  pot: number;
  stacks: [number, number];
  firstPlayer: Player;
  abstraction: RangePostflopAbstraction;
  boardProvider: FutureBoardProvider;
  rangeSource: {
    playerZeroSnapshotId?: string;
    playerOneSnapshotId?: string;
    description: string;
  };
};

export type RangePostflopState = {
  privateDealIndex: number | null;
  holeCards: [HoleCombo, HoleCombo] | null;
  street: RangePostflopStreet;
  board: SolverCard[];
  pot: number;
  stacks: [number, number];
  contributions: [number, number];
  streetCommitted: [number, number];
  currentBet: number;
  lastRaiseSize: number;
  actingPlayer: Player | "chance" | null;
  checks: number;
  raises: number;
  history: RangePostflopAction[];
  folded: Player | null;
  terminal: boolean;
};

function round(value: number) {
  return Number(value.toFixed(6));
}

function copy(state: RangePostflopState): RangePostflopState {
  return {
    ...state,
    holeCards: state.holeCards ? [...state.holeCards] : null,
    board: [...state.board],
    stacks: [...state.stacks],
    contributions: [...state.contributions],
    streetCommitted: [...state.streetCommitted],
    history: [...state.history],
  };
}

function streetFractions(definition: RangePostflopSubgameDefinition, street: RangePostflopStreet) {
  if (street === "flop") return definition.abstraction.flopBetFractions;
  if (street === "turn") return definition.abstraction.turnBetFractions;
  return definition.abstraction.riverBetFractions;
}

export class RangePostflopHoldemSubgame implements ExtensiveGame<RangePostflopState, RangePostflopAction> {
  readonly id: string;
  readonly definition: unknown;
  readonly privateDeals: PrivateDealOutcome[];

  constructor(readonly configuration: RangePostflopSubgameDefinition) {
    this.id = configuration.id;
    const flopIds = configuration.flop.map((card) => card.id);
    if (new Set(flopIds).size !== 3) throw new Error("Range postflop subgame requires three unique flop cards.");
    if (!(configuration.pot > 0) || configuration.stacks.some((stack) => !Number.isFinite(stack) || stack < 0)) {
      throw new Error("Range postflop pot and stacks must be finite and non-negative.");
    }
    this.privateDeals = privateDealDistribution(configuration.ranges[0], configuration.ranges[1], configuration.flop);
    this.definition = {
      id: configuration.id,
      ranges: configuration.ranges.map((range) => range.entries().filter(({ weight }) => weight > 0).map(({ combo, weight }) => [combo.id, weight])),
      flop: flopIds,
      pot: configuration.pot,
      stacks: configuration.stacks,
      firstPlayer: configuration.firstPlayer,
      abstraction: configuration.abstraction,
      boardProvider: configuration.boardProvider.metadata(),
      rangeSource: configuration.rangeSource,
    };
  }

  initialState(): RangePostflopState {
    return {
      privateDealIndex: null,
      holeCards: null,
      street: "flop",
      board: [...this.configuration.flop],
      pot: this.configuration.pot,
      stacks: [...this.configuration.stacks],
      contributions: [this.configuration.pot / 2, this.configuration.pot / 2],
      streetCommitted: [0, 0],
      currentBet: 0,
      lastRaiseSize: 0,
      actingPlayer: "chance",
      checks: 0,
      raises: 0,
      history: [],
      folded: null,
      terminal: false,
    };
  }

  actor(state: RangePostflopState) {
    return state.terminal ? null : state.actingPlayer;
  }

  isTerminal(state: RangePostflopState) {
    return state.terminal;
  }

  utility(state: RangePostflopState, player: Player) {
    if (!state.terminal || !state.holeCards) throw new Error("Range postflop utility requires a terminal dealt state.");
    let winner: Player | null;
    if (state.folded !== null) winner = state.folded === 0 ? 1 : 0;
    else {
      const comparison = compareHoldemHands(
        [state.holeCards[0].first, state.holeCards[0].second, ...state.board],
        [state.holeCards[1].first, state.holeCards[1].second, ...state.board],
      );
      winner = comparison === 0 ? null : comparison > 0 ? 0 : 1;
    }
    if (winner === null) return state.pot / 2 - state.contributions[player];
    return player === winner ? state.pot - state.contributions[player] : -state.contributions[player];
  }

  private effectiveRemaining(state: RangePostflopState) {
    return Math.min(state.stacks[0], state.stacks[1]);
  }

  actions(state: RangePostflopState): readonly RangePostflopAction[] {
    const actor = state.actingPlayer;
    if (state.terminal || actor === "chance" || actor === null) return [];
    const opponent: Player = actor === 0 ? 1 : 0;
    const toCall = round(state.currentBet - state.streetCommitted[actor]);
    const effectiveTarget = round(Math.min(
      state.streetCommitted[actor] + state.stacks[actor],
      state.streetCommitted[opponent] + state.stacks[opponent],
    ));
    if (toCall > 1e-9) {
      const actions: RangePostflopAction[] = ["fold", "call"];
      if (state.raises < this.configuration.abstraction.maxRaisesPerStreet && effectiveTarget > state.currentBet + 1e-9) {
        const minimum = state.currentBet + Math.max(state.lastRaiseSize, toCall);
        this.configuration.abstraction.raisePotFractions.forEach((fraction) => {
          const target = round(Math.min(effectiveTarget, state.currentBet + (state.pot + toCall) * fraction));
          if (target >= minimum - 1e-9 && target < effectiveTarget - 1e-9) actions.push(`raise:${target}`);
        });
        if (this.configuration.abstraction.jamAllowed) actions.push("jam");
      }
      return [...new Set(actions)];
    }
    const actions: RangePostflopAction[] = ["check"];
    streetFractions(this.configuration, state.street).forEach((fraction) => {
      const amount = round(Math.min(this.effectiveRemaining(state), state.pot * fraction));
      if (amount > 1e-9 && amount < this.effectiveRemaining(state) - 1e-9) actions.push(`bet:${amount}`);
    });
    if (this.configuration.abstraction.jamAllowed && this.effectiveRemaining(state) > 1e-9) actions.push("jam");
    return [...new Set(actions)];
  }

  private finishStreet(state: RangePostflopState) {
    if (state.street === "river") {
      state.terminal = true;
      state.actingPlayer = null;
      return;
    }
    state.actingPlayer = "chance";
  }

  private contribute(state: RangePostflopState, player: Player, requested: number) {
    const amount = round(Math.min(state.stacks[player], Math.max(0, requested)));
    state.stacks[player] = round(state.stacks[player] - amount);
    state.streetCommitted[player] = round(state.streetCommitted[player] + amount);
    state.contributions[player] = round(state.contributions[player] + amount);
    state.pot = round(state.pot + amount);
    return amount;
  }

  next(state: RangePostflopState, action: RangePostflopAction): RangePostflopState {
    const next = copy(state);
    if (state.privateDealIndex === null) {
      if (!action.startsWith("private:")) throw new Error("Range postflop root requires a private-card deal.");
      const index = Number(action.slice(8));
      const deal = this.privateDeals[index];
      if (!deal) throw new Error("Invalid range postflop private-card deal.");
      next.privateDealIndex = index;
      next.holeCards = [deal.playerZero, deal.playerOne];
      next.actingPlayer = this.effectiveRemaining(next) <= 1e-9 ? "chance" : this.configuration.firstPlayer;
      return next;
    }
    if (state.actingPlayer === "chance") {
      if (!action.startsWith("deal:")) throw new Error("Public chance node requires a board card.");
      const cardId = Number(action.slice(5));
      const outcome = this.chanceOutcomes(state).find((candidate) => candidate.action === action);
      if (!outcome) throw new Error("Invalid or blocked future board card.");
      const card = createHoldemDeck().find((candidate) => candidate.id === cardId);
      if (!card) throw new Error("Unknown board card.");
      next.board.push(card);
      next.street = next.board.length === 4 ? "turn" : "river";
      next.streetCommitted = [0, 0];
      next.currentBet = 0;
      next.lastRaiseSize = 0;
      next.checks = 0;
      next.raises = 0;
      next.history.push(action);
      if (next.street === "river" && this.effectiveRemaining(next) <= 1e-9) {
        next.terminal = true;
        next.actingPlayer = null;
      } else {
        next.actingPlayer = this.effectiveRemaining(next) <= 1e-9 ? "chance" : this.configuration.firstPlayer;
      }
      return next;
    }
    const actor = state.actingPlayer;
    if (actor === null || !this.actions(state).includes(action)) throw new Error(`Illegal range postflop action ${action}.`);
    const opponent: Player = actor === 0 ? 1 : 0;
    const toCall = round(state.currentBet - state.streetCommitted[actor]);
    next.history.push(action);
    if (action === "fold") {
      next.folded = actor;
      next.terminal = true;
      next.actingPlayer = null;
      return next;
    }
    if (action === "check") {
      next.checks += 1;
      if (next.checks >= 2) this.finishStreet(next);
      else next.actingPlayer = opponent;
      return next;
    }
    if (action === "call") {
      this.contribute(next, actor, toCall);
      this.finishStreet(next);
      return next;
    }
    const oldBet = state.currentBet;
    let target: number;
    if (action === "jam") {
      target = round(Math.min(
        state.streetCommitted[actor] + state.stacks[actor],
        state.streetCommitted[opponent] + state.stacks[opponent],
      ));
    } else if (action.startsWith("bet:")) target = round(state.streetCommitted[actor] + Number(action.slice(4)));
    else target = Number(action.slice(6));
    this.contribute(next, actor, target - state.streetCommitted[actor]);
    next.currentBet = next.streetCommitted[actor];
    next.lastRaiseSize = round(next.currentBet - oldBet);
    if (oldBet > 0) next.raises += 1;
    next.checks = 0;
    next.actingPlayer = opponent;
    return next;
  }

  chanceOutcomes(state: RangePostflopState) {
    if (state.privateDealIndex === null) {
      return this.privateDeals.map((deal, index) => ({
        action: `private:${index}` as RangePostflopAction,
        probability: deal.probability,
      }));
    }
    if (state.actingPlayer !== "chance" || !state.holeCards) return [];
    const blocked = new Set([
      state.holeCards[0].first.id,
      state.holeCards[0].second.id,
      state.holeCards[1].first.id,
      state.holeCards[1].second.id,
      ...state.board.map((card) => card.id),
    ]);
    const available = createHoldemDeck().filter((card) => !blocked.has(card.id));
    const street = state.board.length === 3 ? "turn" : "river";
    const outcomes = this.configuration.boardProvider.outcomes(available, street);
    const probability = outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
    if (Math.abs(probability - 1) > 1e-12) throw new Error("Future board probabilities must sum to one.");
    return outcomes.map((outcome) => ({
      action: `deal:${outcome.card.id}` as RangePostflopAction,
      probability: outcome.probability,
    }));
  }

  informationSet(state: RangePostflopState) {
    const actor = this.actor(state);
    if (actor === null || actor === "chance" || !state.holeCards) throw new Error("Chance and terminal range postflop states have no information set.");
    const combo = state.holeCards[actor];
    return [
      actor,
      combo.id,
      state.street,
      state.board.map((card) => card.id).join("-"),
      state.history.filter((action) => !action.startsWith("private:")).join(",") || "root",
    ].join("|");
  }

  estimateTree() {
    return compileGameTree(this).statistics;
  }
}

export type RangePostflopSolveConfiguration = {
  algorithm: AlgorithmName;
  iterations: number;
  metricInterval: number;
  seed: number;
  exactMetrics?: boolean;
  dcfr?: DcfrParameters;
  cfrPlusAveragingDelay?: number;
  engine?: "object-tree" | "indexed-tree";
};

export type RangePostflopArtifact = {
  schemaVersion: 1;
  id: string;
  gameScope: "HU fixed-flop weighted-range subgame";
  gameDefinitionHash: string;
  rangeHashes: [string, string];
  board: string[];
  bettingAbstraction: RangePostflopAbstraction;
  chanceAbstraction: Record<string, unknown>;
  rangeSource: RangePostflopSubgameDefinition["rangeSource"];
  continuationModel: "strategic-subgame";
  algorithm: RangePostflopSolveConfiguration;
  tree: ReturnType<RangePostflopHoldemSubgame["estimateTree"]>;
  convergence: SolveMetrics;
  utilities: [number, number];
  pairUtilities: Array<{ pairKey: string; playerZeroComboId: string; playerOneComboId: string; utilities: [number, number] }>;
  strategy: BehavioralStrategy;
  validation: ValidationReport;
  runtime: {
    compileMs: number;
    solveMs: number;
    strategyEvaluationMs: number;
    totalMs: number;
    iterationsPerSecond: number;
    approximateHeapDeltaBytes: number;
  };
  trust: "Experimental";
};

function createSolver(
  game: RangePostflopHoldemSubgame,
  configuration: RangePostflopSolveConfiguration,
  compiled: CompiledGameTree<RangePostflopAction>,
) {
  const common = { seed: configuration.seed, exactMetrics: configuration.exactMetrics ?? true };
  if (configuration.engine === "indexed-tree") return new IndexedCfrSolver(game, {
    algorithm: configuration.algorithm,
    seed: configuration.seed,
    exactMetrics: configuration.exactMetrics ?? true,
    dcfr: configuration.dcfr,
    cfrPlusAveragingDelay: configuration.cfrPlusAveragingDelay,
    engine: "indexed-tree",
  }, compiled);
  if (configuration.algorithm === "vanilla-cfr") return new VanillaCfr(game, common, compiled);
  if (configuration.algorithm === "cfr-plus") return new CfrPlus(game, {
    ...common,
    cfrPlusAveragingDelay: configuration.cfrPlusAveragingDelay ?? 0,
  }, compiled);
  return new Dcfr(game, {
    ...common,
    dcfr: configuration.dcfr ?? { alpha: 1.5, beta: 0, gamma: 2 },
  }, compiled);
}

export function solveRangePostflopSubgame(
  definition: RangePostflopSubgameDefinition,
  configuration: RangePostflopSolveConfiguration,
): RangePostflopArtifact {
  const totalStarted = performance.now();
  const game = new RangePostflopHoldemSubgame(definition);
  const compileStarted = performance.now();
  const compiled = compileGameTree(game);
  const compileMs = performance.now() - compileStarted;
  const tree = compiled.statistics;
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const solver = createSolver(game, configuration, compiled);
  const result = solver.solve({ maxIterations: configuration.iterations, metricInterval: configuration.metricInterval });
  const solveMs = performance.now() - started;
  const heapAfter = process.memoryUsage().heapUsed;
  const evaluationStarted = performance.now();
  const utilities = evaluateCompiledNode(compiled.root, result.strategy);
  const strategyEvaluationMs = performance.now() - evaluationStarted;
  if (compiled.root.kind !== "chance") throw new Error("Range postflop compiled root must be private chance.");
  const pairUtilities = game.privateDeals.map((deal, index) => {
    const outcome = compiled.root.kind === "chance"
      ? compiled.root.outcomes.find((candidate) => candidate.action === `private:${index}`)
      : undefined;
    if (!outcome) throw new Error("Compiled postflop tree is missing a private deal branch.");
    return {
      pairKey: deal.playerZero.id + "|" + deal.playerOne.id,
      playerZeroComboId: deal.playerZero.id,
      playerOneComboId: deal.playerOne.id,
      utilities: evaluateCompiledNode(outcome.child, result.strategy),
    };
  });
  const rangeHashes = definition.ranges.map((range) => hashValue(
    range.entries().filter(({ weight }) => weight > 0).map(({ combo, weight }) => [combo.id, weight]),
  )) as [string, string];
  const gameDefinitionHash = hashValue(game.definition);
  const id = `range-continuation:${hashValue({ definition: game.definition, configuration, strategy: result.strategy })}`;
  const validation = new ValidationSuite(`validation:${id}`)
    .add({ id: "private-chance", level: "MATHEMATICAL", description: "Compatible private deals are normalized.", metric: { name: "probability", value: game.privateDeals.reduce((sum, deal) => sum + deal.probability, 0) }, threshold: { kind: "absolute-error", expected: 1, tolerance: 1e-12 } })
    .add({ id: "card-collisions", level: "STRUCTURAL", description: "No private deal collides with the fixed flop.", metric: { name: "valid", value: game.privateDeals.every((deal) => new Set([deal.playerZero.first.id, deal.playerZero.second.id, deal.playerOne.first.id, deal.playerOne.second.id, ...definition.flop.map((card) => card.id)]).size === 7) }, threshold: { kind: "equal", value: true } })
    .add({ id: "multi-street", level: "STRUCTURAL", description: "The tree contains flop decisions and future public chance.", metric: { name: "chanceNodes", value: tree.chanceNodes }, threshold: { kind: "minimum", value: 2 } })
    .add({ id: "zero-sum", level: "MATHEMATICAL", description: "Utilities sum to zero.", metric: { name: "utilitySum", value: utilities[0] + utilities[1] }, threshold: { kind: "absolute-error", expected: 0, tolerance: 1e-8 } })
    .add({ id: "strategy", level: "STRATEGIC", description: "Every behavioral strategy is finite and normalized.", metric: { name: "normalized", value: Object.values(result.strategy).every((actions) => Math.abs(Object.values(actions).reduce((sum, probability) => sum + probability, 0) - 1) < 1e-9) }, threshold: { kind: "equal", value: true } })
    .add({ id: "nash-conv", level: "CONVERGENCE", description: "NashConv is finite when exact metrics are enabled.", metric: { name: "finite", value: result.metrics.nashConv === null || Number.isFinite(result.metrics.nashConv) }, threshold: { kind: "equal", value: true } })
    .add({ id: "experimental", level: "REPRODUCIBILITY", description: "Artifact identity includes ranges, board, abstraction, algorithm and strategy.", metric: { name: "id", value: id.length > 20 }, threshold: { kind: "equal", value: true } })
    .report("2026-10-03T00:00:00.000Z");
  return {
    schemaVersion: 1,
    id,
    gameScope: "HU fixed-flop weighted-range subgame",
    gameDefinitionHash,
    rangeHashes,
    board: definition.flop.map((card) => card.notation),
    bettingAbstraction: definition.abstraction,
    chanceAbstraction: definition.boardProvider.metadata(),
    rangeSource: definition.rangeSource,
    continuationModel: "strategic-subgame",
    algorithm: configuration,
    tree,
    convergence: result.metrics,
    utilities,
    pairUtilities,
    strategy: result.strategy,
    validation,
    runtime: {
      compileMs,
      solveMs,
      strategyEvaluationMs,
      totalMs: performance.now() - totalStarted,
      iterationsPerSecond: configuration.iterations / Math.max(0.001, solveMs / 1000),
      approximateHeapDeltaBytes: Math.max(0, heapAfter - heapBefore),
    },
    trust: "Experimental",
  };
}