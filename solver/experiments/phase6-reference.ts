import { createCombo, createHoldemDeck } from "../cards/cards";
import { privateDealDistribution } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import { hashValue } from "../core/stable";
import { BucketedBoardProvider, type RangePostflopSubgameDefinition } from "../game/range-postflop-subgame";
import type { HoldemPreflopV2Configuration } from "../game/holdem-preflop-v2";

export const PHASE6_REFERENCE_GAME_ID = "phase6-reference-game-v1";

const deck = createHoldemDeck();
export function phase6Card(notation: string) {
  const result = deck.find((candidate) => candidate.notation === notation);
  if (!result) throw new Error(`Unknown reference-game card ${notation}.`);
  return result;
}

const combo = (first: string, second: string) => createCombo(phase6Card(first), phase6Card(second));

export const phase6ReferenceRanges: [WeightedRange, WeightedRange] = [
  new WeightedRange([
    { combo: combo("As", "Ah"), weight: 1 },
    { combo: combo("Qs", "Qh"), weight: 0.85 },
    { combo: combo("As", "Ks"), weight: 0.75 },
    { combo: combo("Ad", "Kh"), weight: 0.6 },
    { combo: combo("7s", "6s"), weight: 0.45 },
    { combo: combo("Ac", "5c"), weight: 0.35 },
    { combo: combo("Js", "9s"), weight: 0.25 },
  ]),
  new WeightedRange([
    { combo: combo("Kd", "Kc"), weight: 1 },
    { combo: combo("Jh", "Jd"), weight: 0.85 },
    { combo: combo("Qd", "Jd"), weight: 0.7 },
    { combo: combo("Ac", "Qh"), weight: 0.55 },
    { combo: combo("6h", "5h"), weight: 0.45 },
    { combo: combo("Ad", "4d"), weight: 0.3 },
    { combo: combo("Tc", "9c"), weight: 0.25 },
  ]),
];

export const phase6ReferenceFlop = [
  phase6Card("8h"),
  phase6Card("7d"),
  phase6Card("2c"),
] as const;

export const phase6ReferenceBoardProvider = new BucketedBoardProvider(2);

export const phase6ReferencePostflopAbstraction = {
  flopBetFractions: [0.33],
  turnBetFractions: [0.5],
  riverBetFractions: [1],
  raisePotFractions: [],
  maxRaisesPerStreet: 0 as const,
  jamAllowed: false,
};

export const phase6ReferencePreflop: HoldemPreflopV2Configuration = {
  id: "phase5-hu-10bb-controlled",
  seed: 1,
  iterations: 4_000,
  metricInterval: 1_000,
  stack: 10,
  smallBlind: 0.5,
  bigBlind: 1,
  sbOpenRaiseTo: [2],
  bbVsLimpRaiseTo: [],
  bbThreeBetTo: [],
  sbFourBetTo: [],
  maximumRaises: 1,
  limpAllowed: false,
  jamAllowed: false,
  continuationBoard: [...phase6ReferenceFlop],
  continuationAbstractionId: "phase5-fixed-flop-weighted-ranges-v1",
};

export const phase6ReferenceActionHistory = ["raise:2", "call"];

export function phase6ReferencePostflopDefinition(
  ranges: [WeightedRange, WeightedRange] = phase6ReferenceRanges,
): RangePostflopSubgameDefinition {
  return {
    id: "phase5-weighted-range-reference",
    ranges,
    flop: [...phase6ReferenceFlop],
    pot: 4,
    stacks: [8, 8],
    firstPlayer: 1,
    abstraction: phase6ReferencePostflopAbstraction,
    boardProvider: phase6ReferenceBoardProvider,
    rangeSource: {
      description: "Frozen Phase 5 physical-combo ranges for Phase 6 numerical validation.",
    },
  };
}

export const phase6ReferenceGameHash = hashValue({
  basePreflop: phase6ReferencePreflop,
  postflopAbstraction: phase6ReferencePostflopAbstraction,
  board: phase6ReferenceFlop.map((item) => item.id),
  ranges: phase6ReferenceRanges.map((range) => range.entries().map(({ combo: item, weight }) => [item.id, weight])),
});

export function assertPhase6ReferenceGame() {
  const deals = privateDealDistribution(
    phase6ReferenceRanges[0],
    phase6ReferenceRanges[1],
    [...phase6ReferenceFlop],
  );
  if (deals.length !== 46) throw new Error(`Phase 6 reference game drifted to ${deals.length} private deals.`);
  return {
    id: PHASE6_REFERENCE_GAME_ID,
    hash: phase6ReferenceGameHash,
    compatiblePrivateDeals: deals.length,
  };
}
