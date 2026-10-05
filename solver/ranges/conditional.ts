import type { BehavioralStrategy, Player } from "../core/types";
import { hashValue } from "../core/stable";
import { privateDealDistribution, type PrivateDealOutcome } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import type { SolverCard } from "../cards/cards";
import { applyBettingAction, createPreflopBettingState } from "../game/betting";
import {
  createHoldemPreflopV2Definition,
  holdemPreflopActionId,
  holdemPreflopInformationSet,
  holdemPreflopLegalActions,
  type HoldemPreflopV2Configuration,
} from "../game/holdem-preflop-v2";

export type ConditionalComboWeight = {
  comboId: string;
  notation: string;
  canonical: string;
  weight: number;
};

export type ConditionalRangeSnapshot = Readonly<{
  id: string;
  player: Player;
  actionHistory: readonly string[];
  board: readonly string[];
  comboWeights: readonly ConditionalComboWeight[];
  normalization: number;
  blockedCombos: number;
  sourceSolveId: string;
  strategyHash: string;
  gameDefinitionHash: string;
}>;

export type ConditionalJointDealSnapshot = Readonly<{
  id: string;
  actionHistory: readonly string[];
  board: readonly string[];
  normalization: number;
  sourceSolveId: string;
  strategyHash: string;
  gameDefinitionHash: string;
  deals: readonly PrivateDealOutcome[];
}>;

export type ConditionalRangeInput = {
  configuration: HoldemPreflopV2Configuration;
  ranges: [WeightedRange, WeightedRange];
  strategy: BehavioralStrategy;
  actionHistory: string[];
  board?: SolverCard[];
  sourceSolveId: string;
};

function actionProbability(strategy: BehavioralStrategy, key: string, legal: string[], selected: string) {
  const supplied = legal.map((action) => strategy[key]?.[action]);
  if (supplied.every((value) => value === undefined)) return 1 / legal.length;
  const values = supplied.map((value) => value ?? 0);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`Invalid strategy probability at ${key}.`);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new Error(`Strategy at ${key} has zero probability mass.`);
  const index = legal.indexOf(selected);
  return index < 0 ? 0 : values[index] / total;
}

function conditionalReach(
  input: ConditionalRangeInput,
  deal: PrivateDealOutcome,
) {
  let state = createPreflopBettingState(createHoldemPreflopV2Definition(input.configuration));
  let reach = deal.probability;
  for (const selected of input.actionHistory) {
    if (state.complete) throw new Error("Conditional range path continues after a terminal state.");
    const actor: Player = state.actingPlayerId === "SB" ? 0 : 1;
    const combo = actor === 0 ? deal.playerZero : deal.playerOne;
    const actions = holdemPreflopLegalActions(input.configuration, state);
    const ids = actions.map(holdemPreflopActionId);
    const index = ids.indexOf(selected);
    if (index < 0) throw new Error(`Action ${selected} is illegal on the conditional range path.`);
    reach *= actionProbability(input.strategy, holdemPreflopInformationSet(state, combo), ids, selected);
    state = applyBettingAction(state, actions[index]);
  }
  return reach;
}

export function deriveConditionalJointDealSnapshot(input: ConditionalRangeInput): ConditionalJointDealSnapshot {
  const board = input.board ?? input.configuration.continuationBoard;
  const priorDeals = privateDealDistribution(input.ranges[0], input.ranges[1], board);
  const unnormalized = priorDeals.map((deal) => ({ deal, mass: conditionalReach(input, deal) }));
  const normalization = unnormalized.reduce((sum, entry) => sum + entry.mass, 0);
  if (!(normalization > 0)) throw new Error("Observed action history has zero probability under the supplied strategy.");
  const deals = unnormalized
    .map(({ deal, mass }) => Object.freeze({ ...deal, probability: mass / normalization }))
    .sort((left, right) => (
      (left.playerZero.id + "|" + left.playerOne.id).localeCompare(right.playerZero.id + "|" + right.playerOne.id)
    ));
  const strategyHash = hashValue(input.strategy);
  const gameDefinitionHash = hashValue(createHoldemPreflopV2Definition(input.configuration));
  const base = {
    actionHistory: Object.freeze([...input.actionHistory]),
    board: Object.freeze(board.map((card) => card.notation)),
    normalization,
    sourceSolveId: input.sourceSolveId,
    strategyHash,
    gameDefinitionHash,
    deals: Object.freeze(deals),
  };
  return Object.freeze({ ...base, id: `conditional-joint:${hashValue(base)}` });
}

export function deriveConditionalRangeSnapshots(input: ConditionalRangeInput): [ConditionalRangeSnapshot, ConditionalRangeSnapshot] {
  const board = input.board ?? input.configuration.continuationBoard;
  const joint = deriveConditionalJointDealSnapshot(input);
  const masses: [Map<string, ConditionalComboWeight>, Map<string, ConditionalComboWeight>] = [new Map(), new Map()];
  joint.deals.forEach((deal) => {
    ([deal.playerZero, deal.playerOne] as const).forEach((combo, player) => {
      const current = masses[player].get(combo.id);
      masses[player].set(combo.id, {
        comboId: combo.id,
        notation: combo.notation,
        canonical: combo.canonical,
        weight: (current?.weight ?? 0) + deal.probability,
      });
    });
  });
  return [0, 1].map((player) => {
    const comboWeights = [...masses[player as Player].values()].sort((left, right) => left.comboId.localeCompare(right.comboId));
    const blockedCombos = input.ranges[player as Player].entries().filter(({ combo, weight }) => (
      weight > 0 && board.some((card) => card.id === combo.first.id || card.id === combo.second.id)
    )).length;
    const base = {
      player: player as Player,
      actionHistory: Object.freeze([...input.actionHistory]),
      board: Object.freeze(board.map((card) => card.notation)),
      comboWeights: Object.freeze(comboWeights.map((entry) => Object.freeze(entry))),
      normalization: joint.normalization,
      blockedCombos,
      sourceSolveId: input.sourceSolveId,
      strategyHash: joint.strategyHash,
      gameDefinitionHash: joint.gameDefinitionHash,
    };
    return Object.freeze({ ...base, id: `conditional-range:${hashValue(base)}` });
  }) as [ConditionalRangeSnapshot, ConditionalRangeSnapshot];
}

export function weightedRangeFromSnapshot(snapshot: ConditionalRangeSnapshot, source: WeightedRange) {
  const byId = new Map(source.entries().map(({ combo }) => [combo.id, combo]));
  return new WeightedRange(snapshot.comboWeights.map(({ comboId, weight }) => {
    const combo = byId.get(comboId);
    if (!combo) throw new Error(`Snapshot combo ${comboId} is missing from its source range.`);
    return { combo, weight };
  }));
}

export function conditionalRangeL1(left: ConditionalRangeSnapshot, right: ConditionalRangeSnapshot) {
  const ids = new Set([...left.comboWeights.map((entry) => entry.comboId), ...right.comboWeights.map((entry) => entry.comboId)]);
  const leftMap = new Map(left.comboWeights.map((entry) => [entry.comboId, entry.weight]));
  const rightMap = new Map(right.comboWeights.map((entry) => [entry.comboId, entry.weight]));
  return [...ids].reduce((sum, id) => sum + Math.abs((leftMap.get(id) ?? 0) - (rightMap.get(id) ?? 0)), 0);
}

export function conditionalJointL1(left: ConditionalJointDealSnapshot, right: ConditionalJointDealSnapshot) {
  const key = (deal: PrivateDealOutcome) => deal.playerZero.id + "|" + deal.playerOne.id;
  const leftMap = new Map(left.deals.map((deal) => [key(deal), deal.probability]));
  const rightMap = new Map(right.deals.map((deal) => [key(deal), deal.probability]));
  const ids = new Set([...leftMap.keys(), ...rightMap.keys()]);
  return [...ids].reduce((sum, id) => sum + Math.abs((leftMap.get(id) ?? 0) - (rightMap.get(id) ?? 0)), 0);
}
