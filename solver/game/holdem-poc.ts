import { combosCollide, enumerateHoleCombos, type HoleCombo } from "../cards/cards";
import type { ContinuationValueProvider } from "../continuation/provider";
import { hashValue } from "../core/stable";
import { DeterministicRandom } from "../core/random";
import { SOLVER_VERSION } from "../core/version";

type PocActions = "fold" | "jam" | "call";
type RegretState = { regrets: [number, number]; strategySum: [number, number] };

export type HoldemPocConfiguration = {
  id: string;
  seed: number;
  iterations: number;
  metricInterval: number;
  stack: number;
  smallBlind: number;
  bigBlind: number;
};

export type HoldemPocMetric = {
  iteration: number;
  averagePositiveRegret: number;
  strategyDelta: number;
  elapsedMs: number;
  samplesPerSecond: number;
};

export type ComboStrategy = {
  comboId: string;
  notation: string;
  canonical: string;
  actions: Record<string, number>;
};

export type HoldemPocArtifact = {
  schemaVersion: 1;
  solverName: "Preflop Lab Solver";
  solverVersion: string;
  solveId: string;
  gameDefinitionHash: string;
  gameDefinition: {
    game: "NLHE";
    format: "heads-up-preflop-poc";
    players: 2;
    stack: number;
    smallBlind: number;
    bigBlind: number;
    actions: { sb: ["fold", "jam"]; bbVsJam: ["fold", "call"] };
    utilityModel: string;
  };
  configuration: HoldemPocConfiguration;
  algorithm: "chance-sampled-cfr";
  iterations: number;
  infosets: number;
  runtimeMs: number;
  estimatedMemoryBytes: number;
  convergenceHistory: HoldemPocMetric[];
  exploitability: null;
  nashConv: null;
  continuationModel: {
    id: string;
    level: number;
    utilityModel: string;
    eligibleForVerified: boolean;
  };
  rawStrategy: {
    sb: ComboStrategy[];
    bbVsJam: ComboStrategy[];
  };
  limitations: string[];
};

export type HoldemPocCheckpoint = {
  schemaVersion: 1;
  solverVersion: string;
  solveId: string;
  gameDefinitionHash: string;
  configurationHash: string;
  iteration: number;
  randomState: number;
  sb: Array<[string, RegretState]>;
  bb: Array<[string, RegretState]>;
  history: HoldemPocMetric[];
};

function regretStrategy(regrets: [number, number]): [number, number] {
  const positive: [number, number] = [Math.max(0, regrets[0]), Math.max(0, regrets[1])];
  const total = positive[0] + positive[1];
  return total > 1e-15 ? [positive[0] / total, positive[1] / total] : [0.5, 0.5];
}

function averageStrategy(state: RegretState): [number, number] {
  const total = state.strategySum[0] + state.strategySum[1];
  return total > 1e-15 ? [state.strategySum[0] / total, state.strategySum[1] / total] : regretStrategy(state.regrets);
}

function cloneState(state: RegretState): RegretState {
  return { regrets: [...state.regrets], strategySum: [...state.strategySum] } as RegretState;
}

export class HoldemPreflopPocSolver {
  readonly combos = enumerateHoleCombos();
  readonly gameDefinition: HoldemPocArtifact["gameDefinition"];
  readonly gameDefinitionHash: string;
  readonly configurationHash: string;
  readonly solveId: string;
  private readonly comboById: Map<string, HoleCombo>;
  private readonly random: DeterministicRandom;
  private readonly sb = new Map<string, RegretState>();
  private readonly bb = new Map<string, RegretState>();
  private iteration = 0;
  private history: HoldemPocMetric[] = [];
  private startedAt = 0;
  private previousSnapshot = new Map<string, number>();

  constructor(
    readonly configuration: HoldemPocConfiguration,
    readonly continuation: ContinuationValueProvider,
  ) {
    this.gameDefinition = {
      game: "NLHE",
      format: "heads-up-preflop-poc",
      players: 2,
      stack: configuration.stack,
      smallBlind: configuration.smallBlind,
      bigBlind: configuration.bigBlind,
      actions: { sb: ["fold", "jam"], bbVsJam: ["fold", "call"] },
      utilityModel: continuation.utilityModel,
    };
    this.gameDefinitionHash = hashValue(this.gameDefinition);
    this.configurationHash = hashValue(configuration);
    this.solveId = hashValue({
      gameDefinition: this.gameDefinition,
      configuration,
      continuation: continuation.id,
      solverVersion: SOLVER_VERSION,
    });
    this.comboById = new Map(this.combos.map((combo) => [combo.id, combo]));
    this.random = new DeterministicRandom(configuration.seed);
  }

  private state(table: Map<string, RegretState>, comboId: string) {
    const existing = table.get(comboId);
    if (existing) return existing;
    const created: RegretState = { regrets: [0, 0], strategySum: [0, 0] };
    table.set(comboId, created);
    return created;
  }

  private sampleDeal() {
    const hero = this.combos[this.random.integer(this.combos.length)];
    let villain = this.combos[this.random.integer(this.combos.length)];
    while (combosCollide(hero, villain)) villain = this.combos[this.random.integer(this.combos.length)];
    return [hero, villain] as const;
  }

  iterate() {
    if (!this.startedAt) this.startedAt = Date.now();
    const [hero, villain] = this.sampleDeal();
    const sbState = this.state(this.sb, hero.id);
    const bbState = this.state(this.bb, villain.id);
    const sbStrategy = regretStrategy(sbState.regrets);
    const bbStrategy = regretStrategy(bbState.regrets);
    const called = this.continuation.evaluate(hero, villain, {
      pot: this.configuration.smallBlind + this.configuration.bigBlind,
      effectiveStack: this.configuration.stack,
      inPositionPlayer: 0,
    }).utilities[0];
    const sbFoldUtility = -this.configuration.smallBlind;
    const bbActionUtilities: [number, number] = [-this.configuration.bigBlind, -called];
    const bbNodeUtility = bbStrategy[0] * bbActionUtilities[0] + bbStrategy[1] * bbActionUtilities[1];
    const sbActionUtilities: [number, number] = [sbFoldUtility, -bbNodeUtility];
    const sbNodeUtility = sbStrategy[0] * sbActionUtilities[0] + sbStrategy[1] * sbActionUtilities[1];

    sbState.regrets[0] += sbActionUtilities[0] - sbNodeUtility;
    sbState.regrets[1] += sbActionUtilities[1] - sbNodeUtility;
    bbState.regrets[0] += sbStrategy[1] * (bbActionUtilities[0] - bbNodeUtility);
    bbState.regrets[1] += sbStrategy[1] * (bbActionUtilities[1] - bbNodeUtility);
    sbState.strategySum[0] += sbStrategy[0];
    sbState.strategySum[1] += sbStrategy[1];
    bbState.strategySum[0] += sbStrategy[1] * bbStrategy[0];
    bbState.strategySum[1] += sbStrategy[1] * bbStrategy[1];
    const numbers = [...sbState.regrets, ...bbState.regrets, ...sbState.strategySum, ...bbState.strategySum];
    if (numbers.some((value) => !Number.isFinite(value))) throw new Error("Numerical failure in Hold'em POC regret update.");
    this.iteration += 1;
  }

  private metric() {
    const states = [...this.sb.entries(), ...this.bb.entries()];
    const positiveRegret = states.flatMap(([, state]) => state.regrets.map((value) => Math.max(0, value)));
    let delta = 0;
    states.forEach(([id, state], tableIndex) => {
      averageStrategy(state).forEach((probability, actionIndex) => {
        const key = `${tableIndex >= this.sb.size ? "bb" : "sb"}:${id}:${actionIndex}`;
        delta = Math.max(delta, Math.abs(probability - (this.previousSnapshot.get(key) ?? 0)));
        this.previousSnapshot.set(key, probability);
      });
    });
    const elapsedMs = Math.max(1, Date.now() - this.startedAt);
    const point: HoldemPocMetric = {
      iteration: this.iteration,
      averagePositiveRegret: positiveRegret.length
        ? positiveRegret.reduce((sum, value) => sum + value, 0) / positiveRegret.length / Math.max(1, this.iteration)
        : 0,
      strategyDelta: delta,
      elapsedMs,
      samplesPerSecond: this.iteration / (elapsedMs / 1000),
    };
    this.history.push(point);
    return point;
  }

  solve() {
    if (!this.startedAt) this.startedAt = Date.now();
    while (this.iteration < this.configuration.iterations) {
      this.iterate();
      if (this.iteration % this.configuration.metricInterval === 0 || this.iteration === this.configuration.iterations) this.metric();
    }
    return this.artifact();
  }

  private comboStrategies(table: Map<string, RegretState>, actions: [PocActions, PocActions]): ComboStrategy[] {
    return this.combos.map((combo) => {
      const strategy = averageStrategy(this.state(table, combo.id));
      return {
        comboId: combo.id,
        notation: combo.notation,
        canonical: combo.canonical,
        actions: { [actions[0]]: strategy[0], [actions[1]]: strategy[1] },
      };
    });
  }

  artifact(): HoldemPocArtifact {
    const runtimeMs = this.startedAt ? Date.now() - this.startedAt : 0;
    return {
      schemaVersion: 1,
      solverName: "Preflop Lab Solver",
      solverVersion: SOLVER_VERSION,
      solveId: this.solveId,
      gameDefinitionHash: this.gameDefinitionHash,
      gameDefinition: this.gameDefinition,
      configuration: this.configuration,
      algorithm: "chance-sampled-cfr",
      iterations: this.iteration,
      infosets: this.sb.size + this.bb.size,
      runtimeMs,
      estimatedMemoryBytes: (this.sb.size + this.bb.size) * 4 * 8,
      convergenceHistory: [...this.history],
      exploitability: null,
      nashConv: null,
      continuationModel: {
        id: this.continuation.id,
        level: this.continuation.level,
        utilityModel: this.continuation.utilityModel,
        eligibleForVerified: this.continuation.eligibleForVerified,
      },
      rawStrategy: {
        sb: this.comboStrategies(this.sb, ["fold", "jam"]),
        bbVsJam: this.comboStrategies(this.bb, ["fold", "call"]),
      },
      limitations: [
        "Heads-up structural proof of concept, not an 8-max solution.",
        "Showdown continuation uses a Level 0 strength/equity approximation rather than solved postflop values.",
        "Chance-sampled CFR does not currently expose a valid exploitability or NashConv calculation for this poker model.",
        "The result is Experimental and is ineligible for Verified status.",
      ],
    };
  }

  checkpoint(): HoldemPocCheckpoint {
    return {
      schemaVersion: 1,
      solverVersion: SOLVER_VERSION,
      solveId: this.solveId,
      gameDefinitionHash: this.gameDefinitionHash,
      configurationHash: this.configurationHash,
      iteration: this.iteration,
      randomState: this.random.snapshot(),
      sb: [...this.sb].map(([key, state]) => [key, cloneState(state)]),
      bb: [...this.bb].map(([key, state]) => [key, cloneState(state)]),
      history: [...this.history],
    };
  }

  restore(checkpoint: HoldemPocCheckpoint) {
    if (checkpoint.schemaVersion !== 1 || checkpoint.solverVersion !== SOLVER_VERSION) throw new Error("Unsupported Hold'em POC checkpoint.");
    if (checkpoint.solveId !== this.solveId || checkpoint.gameDefinitionHash !== this.gameDefinitionHash || checkpoint.configurationHash !== this.configurationHash) {
      throw new Error("Checkpoint does not match this Hold'em POC solve identity.");
    }
    this.sb.clear();
    this.bb.clear();
    checkpoint.sb.forEach(([key, state]) => this.sb.set(key, cloneState(state)));
    checkpoint.bb.forEach(([key, state]) => this.bb.set(key, cloneState(state)));
    this.iteration = checkpoint.iteration;
    this.random.restore(checkpoint.randomState);
    this.history = [...checkpoint.history];
    this.startedAt = Date.now();
    this.previousSnapshot.clear();
  }
}
