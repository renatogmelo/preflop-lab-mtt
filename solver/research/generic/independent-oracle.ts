import type { Player } from "../../core/types";
import type { ExtensiveGameProviderV2 } from "./provider-v2";

export type IndependentOracleResult = {
  uniformUtilities: [number, number];
  bestResponseValues: [number, number];
  nashConv: number;
  exploitability: number;
  purePoliciesEnumerated: [number, number];
};

type InformationDescription = { key: string; actor: Player; actionCount: number };

export function evaluateIndependentOracle<State, Action>(
  provider: ExtensiveGameProviderV2<State, Action>,
  maximumPurePolicies = 100_000,
): IndependentOracleResult {
  const information = new Map<string, InformationDescription>();
  const seen = new Set<string>();
  const visit = (state: State) => {
    const stateKey = provider.stateKey(state);
    if (seen.has(stateKey)) throw new Error("Independent oracle requires a tree without repeated states.");
    seen.add(stateKey);
    const actor = provider.actor(state);
    const actions = provider.legalActions(state);
    if (actor === 0 || actor === 1) {
      const key = provider.informationSetKey(state);
      const existing = information.get(key);
      if (existing && (existing.actor !== actor || existing.actionCount !== actions.length)) throw new Error("Oracle found inconsistent information set.");
      information.set(key, { key, actor, actionCount: actions.length });
    }
    for (const action of actions) visit(provider.transition(state, action));
  };
  visit(provider.initialState());

  const evaluate = (state: State, bestRespondingPlayer: Player | null, policy: ReadonlyMap<string, number>): number => {
    const actor = provider.actor(state);
    if (actor === null) {
      const utility = provider.terminalUtility(state);
      if (!utility) throw new Error("Oracle terminal utility missing.");
      return utility[0];
    }
    const actions = provider.legalActions(state);
    if (actor === "chance") return actions.reduce((sum, action) => sum + provider.chanceProbability(state, action) * evaluate(provider.transition(state, action), bestRespondingPlayer, policy), 0);
    const informationKey = provider.informationSetKey(state);
    if (actor === bestRespondingPlayer) {
      const selected = policy.get(informationKey);
      if (selected === undefined) throw new Error("Oracle pure policy is incomplete.");
      return evaluate(provider.transition(state, actions[selected]), bestRespondingPlayer, policy);
    }
    return actions.reduce((sum, action) => sum + evaluate(provider.transition(state, action), bestRespondingPlayer, policy) / actions.length, 0);
  };

  const uniformP0 = evaluate(provider.initialState(), null, new Map());
  const response = (player: Player) => {
    const infos = [...information.values()].filter((entry) => entry.actor === player).sort((left, right) => left.key.localeCompare(right.key));
    const combinations = infos.reduce((total, entry) => total * entry.actionCount, 1);
    if (!Number.isSafeInteger(combinations) || combinations > maximumPurePolicies) throw new Error(`Independent oracle pure-policy budget exceeded: ${combinations}.`);
    let best = Number.NEGATIVE_INFINITY;
    const policy = new Map<string, number>();
    for (let ordinal = 0; ordinal < combinations; ordinal += 1) {
      let remainder = ordinal;
      for (const info of infos) {
        policy.set(info.key, remainder % info.actionCount);
        remainder = Math.floor(remainder / info.actionCount);
      }
      const p0 = evaluate(provider.initialState(), player, policy);
      const value = player === 0 ? p0 : -p0;
      best = Math.max(best, value);
    }
    return { value: best, combinations };
  };
  const response0 = response(0);
  const response1 = response(1);
  const utilities: [number, number] = [uniformP0, -uniformP0];
  const nashConv = (response0.value - utilities[0]) + (response1.value - utilities[1]);
  return {
    uniformUtilities: utilities,
    bestResponseValues: [response0.value, response1.value],
    nashConv,
    exploitability: nashConv / 2,
    purePoliciesEnumerated: [response0.combinations, response1.combinations],
  };
}
