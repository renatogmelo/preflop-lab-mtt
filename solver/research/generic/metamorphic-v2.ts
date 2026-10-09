import { hashValue } from "../../core/stable";
import type { ExtensiveGameProviderV2 } from "./provider-v2";

function wrapIdentity(base: ExtensiveGameProviderV2<unknown, unknown>, transform: string) {
  return hashValue({ base: base.semanticIdentity, transform });
}

export function renameProviderActions<State, Action>(base: ExtensiveGameProviderV2<State, Action>): ExtensiveGameProviderV2<State, Action> {
  return {
    ...base,
    id: `${base.id}-renamed-actions`,
    semanticIdentity: wrapIdentity(base as ExtensiveGameProviderV2<unknown, unknown>, "rename-actions"),
    initialState: () => base.initialState(), stateKey: (state) => base.stateKey(state), actor: (state) => base.actor(state),
    legalActions: (state) => base.legalActions(state), transition: (state, action) => base.transition(state, action),
    actionKey: (state, action) => `renamed:${base.actionKey(state, action)}`,
    actionLabel: (state, action) => `Renamed ${base.actionLabel(state, action)}`,
    chanceProbability: (state, action) => base.chanceProbability(state, action),
    informationSetKey: (state) => base.informationSetKey(state), informationSetAudit: base.informationSetAudit?.bind(base),
    terminalUtility: (state) => base.terminalUtility(state),
  };
}

export function reverseProviderActions<State, Action>(base: ExtensiveGameProviderV2<State, Action>): ExtensiveGameProviderV2<State, Action> {
  return {
    ...base,
    id: `${base.id}-reversed-actions`,
    semanticIdentity: wrapIdentity(base as ExtensiveGameProviderV2<unknown, unknown>, "reverse-actions"),
    initialState: () => base.initialState(), stateKey: (state) => base.stateKey(state), actor: (state) => base.actor(state),
    legalActions: (state) => [...base.legalActions(state)].reverse(), transition: (state, action) => base.transition(state, action),
    actionKey: (state, action) => base.actionKey(state, action), actionLabel: (state, action) => base.actionLabel(state, action),
    chanceProbability: (state, action) => base.chanceProbability(state, action),
    informationSetKey: (state) => base.informationSetKey(state), informationSetAudit: base.informationSetAudit?.bind(base),
    terminalUtility: (state) => base.terminalUtility(state),
  };
}

export function scaleProviderUtilities<State, Action>(base: ExtensiveGameProviderV2<State, Action>, factor: number): ExtensiveGameProviderV2<State, Action> {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error("Utility scale must be positive and finite.");
  return {
    ...base,
    id: `${base.id}-utility-${factor}`,
    semanticIdentity: wrapIdentity(base as ExtensiveGameProviderV2<unknown, unknown>, `utility:${factor}`),
    initialState: () => base.initialState(), stateKey: (state) => base.stateKey(state), actor: (state) => base.actor(state),
    legalActions: (state) => base.legalActions(state), transition: (state, action) => base.transition(state, action),
    actionKey: (state, action) => base.actionKey(state, action), actionLabel: (state, action) => base.actionLabel(state, action),
    chanceProbability: (state, action) => base.chanceProbability(state, action),
    informationSetKey: (state) => base.informationSetKey(state), informationSetAudit: base.informationSetAudit?.bind(base),
    terminalUtility: (state) => {
      const utility = base.terminalUtility(state);
      return utility ? [utility[0] * factor, utility[1] * factor] : null;
    },
  };
}

export function permuteProviderPlayers<State, Action>(base: ExtensiveGameProviderV2<State, Action>): ExtensiveGameProviderV2<State, Action> {
  return {
    ...base,
    id: `${base.id}-players-swapped`,
    semanticIdentity: wrapIdentity(base as ExtensiveGameProviderV2<unknown, unknown>, "players-swapped"),
    initialState: () => base.initialState(), stateKey: (state) => base.stateKey(state),
    actor: (state) => { const actor = base.actor(state); return actor === 0 ? 1 : actor === 1 ? 0 : actor; },
    legalActions: (state) => base.legalActions(state), transition: (state, action) => base.transition(state, action),
    actionKey: (state, action) => base.actionKey(state, action), actionLabel: (state, action) => base.actionLabel(state, action),
    chanceProbability: (state, action) => base.chanceProbability(state, action),
    informationSetKey: (state) => `swapped:${base.informationSetKey(state)}`,
    informationSetAudit: base.informationSetAudit?.bind(base),
    terminalUtility: (state) => { const utility = base.terminalUtility(state); return utility ? [utility[1], utility[0]] : null; },
  };
}

export function permuteProviderStateKeys<State, Action>(base: ExtensiveGameProviderV2<State, Action>): ExtensiveGameProviderV2<State, Action> {
  return {
    ...base,
    id: `${base.id}-state-keys-permuted`,
    semanticIdentity: wrapIdentity(base as ExtensiveGameProviderV2<unknown, unknown>, "state-keys-permuted"),
    initialState: () => base.initialState(), stateKey: (state) => `permuted:${base.stateKey(state).split("").reverse().join("")}`,
    actor: (state) => base.actor(state), legalActions: (state) => base.legalActions(state), transition: (state, action) => base.transition(state, action),
    actionKey: (state, action) => base.actionKey(state, action), actionLabel: (state, action) => base.actionLabel(state, action),
    chanceProbability: (state, action) => base.chanceProbability(state, action),
    informationSetKey: (state) => base.informationSetKey(state), informationSetAudit: base.informationSetAudit?.bind(base),
    terminalUtility: (state) => base.terminalUtility(state),
  };
}
