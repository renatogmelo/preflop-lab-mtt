import type { BehavioralStrategy, Player } from "../../core/types";
import type { ExtensiveGameProviderV2 } from "../generic/provider-v2";
import { validateReferenceGame } from "./reference-engine";

export type IndependentEvaluation = {
  utilities: [number, number];
  bestResponseValues: [number, number];
  nashConv: number;
  exploitability: number;
  purePoliciesEnumerated: [number, number];
  bestResponsePolicies: [Record<string, string>, Record<string, string>];
};

function probability<State, Action>(provider: ExtensiveGameProviderV2<State, Action>, strategy: BehavioralStrategy, state: State, action: Action) {
  const key = provider.informationSetKey(state);
  const value = strategy[key]?.[provider.actionKey(state, action)];
  if (!Number.isFinite(value) || value < 0) throw new Error(`Missing or invalid probability at ${key}.`);
  return value;
}

export function evaluateBehavioralStrategy<State, Action>(provider: ExtensiveGameProviderV2<State, Action>, strategy: BehavioralStrategy): [number, number] {
  validateReferenceGame(provider);
  const visit = (state: State): number => {
    const actor = provider.actor(state);
    if (actor === null) return provider.terminalUtility(state)![0];
    const actions = provider.legalActions(state);
    if (actor === "chance") return actions.reduce((sum, action) => sum + provider.chanceProbability(state, action) * visit(provider.transition(state, action)), 0);
    const probabilities = actions.map((action) => probability(provider, strategy, state, action));
    if (Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) > 1e-12) throw new Error(`Strategy is not normalized at ${provider.informationSetKey(state)}.`);
    return actions.reduce((sum, action, index) => sum + probabilities[index] * visit(provider.transition(state, action)), 0);
  };
  const utility = visit(provider.initialState());
  return [utility, -utility];
}

export function evaluateIndependentBestResponses<State, Action>(
  provider: ExtensiveGameProviderV2<State, Action>,
  strategy: BehavioralStrategy,
  maximumPurePolicies = 100_000,
): IndependentEvaluation {
  validateReferenceGame(provider);
  const information = new Map<string, { actor: Player; actions: readonly Action[]; actionKeys: string[] }>();
  const discover = (state: State) => {
    const actor = provider.actor(state);
    if (actor === null) return;
    const actions = provider.legalActions(state);
    if (actor !== "chance") {
      const key = provider.informationSetKey(state);
      if (!information.has(key)) information.set(key, { actor, actions: [...actions], actionKeys: actions.map((action) => provider.actionKey(state, action)) });
    }
    for (const action of actions) discover(provider.transition(state, action));
  };
  discover(provider.initialState());
  const profileUtilities = evaluateBehavioralStrategy(provider, strategy);
  const response = (player: Player) => {
    const infos = [...information].filter(([, value]) => value.actor === player).sort(([left], [right]) => left.localeCompare(right));
    const combinations = infos.reduce((total, [, value]) => total * value.actions.length, 1);
    if (!Number.isSafeInteger(combinations) || combinations > maximumPurePolicies) throw new Error(`Independent best-response policy budget exceeded: ${combinations}.`);
    let best = Number.NEGATIVE_INFINITY;
    let bestPolicy: Record<string, string> = {};
    for (let ordinal = 0; ordinal < combinations; ordinal += 1) {
      let remainder = ordinal;
      const policy = new Map<string, number>();
      for (const [key, info] of infos) {
        policy.set(key, remainder % info.actions.length);
        remainder = Math.floor(remainder / info.actions.length);
      }
      const visit = (state: State): number => {
        const actor = provider.actor(state);
        if (actor === null) return provider.terminalUtility(state)![player];
        const actions = provider.legalActions(state);
        if (actor === "chance") return actions.reduce((sum, action) => sum + provider.chanceProbability(state, action) * visit(provider.transition(state, action)), 0);
        if (actor === player) return visit(provider.transition(state, actions[policy.get(provider.informationSetKey(state))!]));
        return actions.reduce((sum, action) => sum + probability(provider, strategy, state, action) * visit(provider.transition(state, action)), 0);
      };
      const value = visit(provider.initialState());
      if (value > best) {
        best = value;
        bestPolicy = Object.fromEntries(infos.map(([key, info]) => [key, info.actionKeys[policy.get(key)!]]));
      }
    }
    return { value: best, combinations, policy: bestPolicy };
  };
  const response0 = response(0);
  const response1 = response(1);
  const nashConv = (response0.value - profileUtilities[0]) + (response1.value - profileUtilities[1]);
  return {
    utilities: profileUtilities,
    bestResponseValues: [response0.value, response1.value],
    nashConv,
    exploitability: nashConv / 2,
    purePoliciesEnumerated: [response0.combinations, response1.combinations],
    bestResponsePolicies: [response0.policy, response1.policy],
  };
}
