import type { AlgorithmName, BehavioralStrategy, Player, SolverConfiguration } from "../../core/types";
import { DEFAULT_DCFR } from "../../algorithms/cfr";
import type { ExtensiveGameProviderV2 } from "../generic/provider-v2";

export const MATHEMATICAL_SPEC_VERSION = "phase6.13-formal-spec-v1";
export const REFERENCE_ENGINE_VERSION = "independent-reference-cfr-v0.13.0";
export const REGRET_MATCHING_EPSILON = 1e-15;

export type ReferenceInfoState<Action> = {
  actor: Player;
  actions: readonly Action[];
  actionKeys: readonly string[];
  regrets: number[];
  strategySums: number[];
};

export type ReferenceVisitTrace = {
  informationSet: string;
  updatingPlayer: Player;
  currentStrategy: number[];
  playerReach: [number, number];
  chanceReach: number;
  counterfactualReach: number;
  actionValues: number[];
  nodeValue: number;
  regretIncrements: number[];
  averageStrategyContributions: number[];
};

export type ReferenceIterationTrace = {
  iteration: number;
  algorithm: AlgorithmName;
  averagingWeight: number;
  dcfrScales: { positive: number; negative: number; strategy: number } | null;
  visits: ReferenceVisitTrace[];
  regrets: Record<string, number[]>;
  strategySums: Record<string, number[]>;
  currentStrategy: BehavioralStrategy;
  averageStrategy: BehavioralStrategy;
};

export function regretMatching(regrets: readonly number[], plus = false): number[] {
  if (!regrets.length || regrets.some((value) => !Number.isFinite(value))) throw new Error("Regret matching requires a non-empty finite vector.");
  const positive = regrets.map((value) => Math.max(0, plus ? Math.max(0, value) : value));
  const total = positive.reduce((sum, value) => sum + value, 0);
  return total > REGRET_MATCHING_EPSILON
    ? positive.map((value) => value / total)
    : positive.map(() => 1 / positive.length);
}

export function referenceDcfrScales(iteration: number, parameters = DEFAULT_DCFR) {
  if (!Number.isInteger(iteration) || iteration <= 0) throw new Error("DCFR iteration must be positive.");
  for (const [key, value] of Object.entries(parameters)) if (!Number.isFinite(value)) throw new Error(`DCFR ${key} must be finite.`);
  const positivePower = iteration ** parameters.alpha;
  const negativePower = iteration ** parameters.beta;
  const strategy = ((iteration - 1) / iteration) ** parameters.gamma;
  const result = { positive: positivePower / (positivePower + 1), negative: negativePower / (negativePower + 1), strategy };
  if (Object.values(result).some((value) => !Number.isFinite(value))) throw new Error("DCFR produced a non-finite discount.");
  return result;
}

export function referenceCfrPlusWeight(iteration: number, delay = 0) {
  if (!Number.isInteger(iteration) || iteration <= 0 || !Number.isInteger(delay) || delay < 0) throw new Error("Invalid CFR+ averaging index.");
  return Math.max(0, iteration - delay);
}

function cloneRecord(information: ReadonlyMap<string, ReferenceInfoState<unknown>>, field: "regrets" | "strategySums") {
  return Object.fromEntries([...information].sort(([left], [right]) => left.localeCompare(right)).map(([key, state]) => [key, [...state[field]]]));
}

export function validateReferenceGame<State, Action>(provider: ExtensiveGameProviderV2<State, Action>, maximumNodes = 100_000) {
  if (!provider.capabilities.deterministic || !provider.capabilities.twoPlayerZeroSum) throw new Error("Reference engine supports deterministic two-player zero-sum providers only.");
  const seen = new Set<string>();
  const information = new Map<string, { actor: Player; actions: string[] }>();
  let nodes = 0;
  const visit = (state: State) => {
    nodes += 1;
    if (nodes > maximumNodes) throw new Error(`Reference engine node budget exceeded: ${maximumNodes}.`);
    const stateKey = provider.stateKey(state);
    if (!stateKey || seen.has(stateKey)) throw new Error("Reference engine requires unique, non-empty state keys and an acyclic tree.");
    seen.add(stateKey);
    const actor = provider.actor(state);
    const actions = provider.legalActions(state);
    const utility = provider.terminalUtility(state);
    if (actor === null) {
      if (actions.length || !utility || utility.some((value) => !Number.isFinite(value)) || Math.abs(utility[0] + utility[1]) > 1e-12) throw new Error("Invalid zero-sum terminal state.");
      return;
    }
    if (utility || !actions.length) throw new Error("Invalid non-terminal state.");
    const actionKeys = actions.map((action) => provider.actionKey(state, action));
    if (new Set(actionKeys).size !== actionKeys.length) throw new Error("Duplicate action keys.");
    if (actor === "chance") {
      const probabilities = actions.map((action) => provider.chanceProbability(state, action));
      if (probabilities.some((value) => !Number.isFinite(value) || value < 0) || Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) > 1e-12) throw new Error("Chance probabilities are invalid or not normalized.");
    } else {
      const key = provider.informationSetKey(state);
      if (!key) throw new Error("Empty information-set key.");
      const existing = information.get(key);
      if (existing && (existing.actor !== actor || existing.actions.join("\u0000") !== actionKeys.join("\u0000"))) throw new Error("Inconsistent information set.");
      information.set(key, { actor, actions: actionKeys });
    }
    for (const action of actions) visit(provider.transition(state, action));
  };
  visit(provider.initialState());
  return { nodes, informationSets: information.size };
}

export class IndependentReferenceCfr<State, Action> {
  readonly information = new Map<string, ReferenceInfoState<Action>>();
  private iterationCount = 0;
  private nodesVisited = 0;

  constructor(readonly provider: ExtensiveGameProviderV2<State, Action>, readonly configuration: SolverConfiguration) {
    if (!["vanilla-cfr", "cfr-plus", "dcfr"].includes(configuration.algorithm)) throw new Error("Unsupported reference algorithm.");
    validateReferenceGame(provider);
    this.discover(provider.initialState());
  }

  private discover(state: State) {
    const actor = this.provider.actor(state);
    if (actor === null) return;
    const actions = this.provider.legalActions(state);
    if (actor !== "chance") {
      const key = this.provider.informationSetKey(state);
      if (!this.information.has(key)) this.information.set(key, {
        actor,
        actions: [...actions],
        actionKeys: actions.map((action) => this.provider.actionKey(state, action)),
        regrets: actions.map(() => 0),
        strategySums: actions.map(() => 0),
      });
    }
    for (const action of actions) this.discover(this.provider.transition(state, action));
  }

  get iteration() { return this.iterationCount; }
  get visitedNodes() { return this.nodesVisited; }

  private strategies() {
    return new Map([...this.information].map(([key, state]) => [key, regretMatching(state.regrets, this.configuration.algorithm === "cfr-plus")]));
  }

  private strategyObject(average: boolean): BehavioralStrategy {
    return Object.fromEntries([...this.information].sort(([left], [right]) => left.localeCompare(right)).map(([key, state]) => {
      const total = state.strategySums.reduce((sum, value) => sum + value, 0);
      const probabilities = average && total > REGRET_MATCHING_EPSILON ? state.strategySums.map((value) => value / total) : regretMatching(state.regrets, this.configuration.algorithm === "cfr-plus");
      return [key, Object.fromEntries(state.actionKeys.map((action, index) => [action, probabilities[index]]))];
    }));
  }

  currentStrategy() { return this.strategyObject(false); }
  averageStrategy() { return this.strategyObject(true); }

  private traverse(
    state: State,
    updatingPlayer: Player,
    reaches: [number, number],
    chanceReach: number,
    strategies: ReadonlyMap<string, readonly number[]>,
    regretDeltas: Map<string, number[]>,
    averageDeltas: Map<string, number[]>,
    averagingWeight: number,
    visits: ReferenceVisitTrace[],
  ): number {
    this.nodesVisited += 1;
    const actor = this.provider.actor(state);
    if (actor === null) {
      const utility = this.provider.terminalUtility(state)!;
      return utility[updatingPlayer];
    }
    const actions = this.provider.legalActions(state);
    if (actor === "chance") return actions.reduce((sum, action) => {
      const probability = this.provider.chanceProbability(state, action);
      return sum + probability * this.traverse(this.provider.transition(state, action), updatingPlayer, reaches, chanceReach * probability, strategies, regretDeltas, averageDeltas, averagingWeight, visits);
    }, 0);
    const key = this.provider.informationSetKey(state);
    const strategy = strategies.get(key)!;
    const actionValues = actions.map((action, index) => {
      const next: [number, number] = [...reaches];
      next[actor] *= strategy[index];
      return this.traverse(this.provider.transition(state, action), updatingPlayer, next, chanceReach, strategies, regretDeltas, averageDeltas, averagingWeight, visits);
    });
    const nodeValue = actionValues.reduce((sum, value, index) => sum + strategy[index] * value, 0);
    if (actor === updatingPlayer) {
      const counterfactualReach = chanceReach * reaches[actor === 0 ? 1 : 0];
      const ownReach = chanceReach * reaches[actor];
      const regretIncrement = actionValues.map((value) => counterfactualReach * (value - nodeValue));
      const averageContribution = strategy.map((probability) => averagingWeight * ownReach * probability);
      const regrets = regretDeltas.get(key)!;
      const averages = averageDeltas.get(key)!;
      regretIncrement.forEach((value, index) => { regrets[index] += value; });
      averageContribution.forEach((value, index) => { averages[index] += value; });
      visits.push({ informationSet: key, updatingPlayer, currentStrategy: [...strategy], playerReach: [...reaches], chanceReach, counterfactualReach, actionValues, nodeValue, regretIncrements: regretIncrement, averageStrategyContributions: averageContribution });
    }
    return nodeValue;
  }

  iterate(): ReferenceIterationTrace {
    const nextIteration = this.iterationCount + 1;
    let scales: ReturnType<typeof referenceDcfrScales> | null = null;
    if (this.configuration.algorithm === "dcfr") {
      scales = referenceDcfrScales(nextIteration, this.configuration.dcfr ?? DEFAULT_DCFR);
      for (const state of this.information.values()) {
        state.regrets = state.regrets.map((value) => value * (value >= 0 ? scales!.positive : scales!.negative));
        state.strategySums = state.strategySums.map((value) => value * scales!.strategy);
      }
    }
    const averagingWeight = this.configuration.algorithm === "cfr-plus" ? referenceCfrPlusWeight(nextIteration, this.configuration.cfrPlusAveragingDelay ?? 0) : 1;
    const visits: ReferenceVisitTrace[] = [];
    for (const player of [0, 1] as const) {
      const strategies = this.strategies();
      const regretDeltas = new Map([...this.information].map(([key, state]) => [key, state.actions.map(() => 0)]));
      const averageDeltas = new Map([...this.information].map(([key, state]) => [key, state.actions.map(() => 0)]));
      this.traverse(this.provider.initialState(), player, [1, 1], 1, strategies, regretDeltas, averageDeltas, averagingWeight, visits);
      for (const [key, state] of this.information) {
        if (state.actor !== player) continue;
        state.regrets = state.regrets.map((value, index) => {
          const next = value + regretDeltas.get(key)![index];
          return this.configuration.algorithm === "cfr-plus" ? Math.max(0, next) : next;
        });
        state.strategySums = state.strategySums.map((value, index) => value + averageDeltas.get(key)![index]);
        if ([...state.regrets, ...state.strategySums].some((value) => !Number.isFinite(value))) throw new Error("Reference state became non-finite.");
      }
    }
    this.iterationCount = nextIteration;
    return {
      iteration: nextIteration,
      algorithm: this.configuration.algorithm,
      averagingWeight,
      dcfrScales: scales,
      visits,
      regrets: cloneRecord(this.information as ReadonlyMap<string, ReferenceInfoState<unknown>>, "regrets"),
      strategySums: cloneRecord(this.information as ReadonlyMap<string, ReferenceInfoState<unknown>>, "strategySums"),
      currentStrategy: this.currentStrategy(),
      averageStrategy: this.averageStrategy(),
    };
  }
}
