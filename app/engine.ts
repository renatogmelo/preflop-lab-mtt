import {
  ACTIONS,
  POSITIONS,
  RANKS,
  SCENARIOS,
  STACKS,
  clamp,
  round,
  type ActionKey,
  type Confidence,
  type HandRecord,
  type KnowledgeState,
  type Position,
  type ScenarioKey,
  type Spot,
  type StrategyAction,
} from "./core/domain";
import {
  AUTO_DATASET_ID,
  defaultQuery,
  dominantAction,
  scenarioIsCompatible,
  strategyRepository,
} from "./core/strategy-data";

export * from "./core/domain";
export { scenarioIsCompatible };

export function strategy(
  hand: string,
  scenario: ScenarioKey,
  hero: Position,
  stack: number,
  villain?: Position,
  caller?: Position,
): StrategyAction[] {
  const query = defaultQuery({ datasetId: AUTO_DATASET_ID });
  const result = strategyRepository.hand(
    { ...query, stack, hero, scenario, villain, caller, openSize: undefined, threeBetSize: undefined },
    hand,
  );
  if (result.status === "unavailable") {
    throw new Error(result.reason);
  }
  return result.strategy;
}

export function lookupStrategy(
  hand: string,
  scenario: ScenarioKey,
  hero: Position,
  stack: number,
  villain?: Position,
  caller?: Position,
) {
  const query = defaultQuery({ stack, hero, scenario, villain, caller, openSize: undefined, threeBetSize: undefined });
  return strategyRepository.hand(query, hand);
}

const initialLookup = strategyRepository.hand(defaultQuery({ stack: 25, hero: "BTN", scenario: "rfi" }), "AJs");
if (initialLookup.status === "unavailable") throw new Error(initialLookup.reason);

export const INITIAL_SPOT: Spot = {
  id: "initial",
  cards: [{ rank: "A", suit: "♠" }, { rank: "J", suit: "♠" }],
  notation: "AJs",
  hero: "BTN",
  scenario: "rfi",
  stack: 25,
  history: ["Fold até BTN"],
  pot: 2.5,
  strategy: initialLookup.strategy,
  nodeId: initialLookup.node.id,
  datasetId: initialLookup.node.datasetId,
  provenance: initialLookup.node.provenance,
};

export function knowledgeState(correct: boolean, confidence: Confidence): KnowledgeState {
  if (correct && confidence >= 4) return "mastered";
  if (!correct && confidence >= 4) return "misconception";
  if (!correct && confidence <= 2) return "knowledge-gap";
  return "uncertain";
}

export function grade(items: StrategyAction[], selected: ActionKey, confidence: Confidence = 3) {
  const best = dominantAction(items);
  const choice = items.find((item) => item.action === selected);
  const frequency = choice?.frequency ?? 0;
  const frequencyError = Math.max(0, best.frequency - frequency);
  const correct = frequency >= 5;
  const score = correct ? clamp(Math.round(100 - frequencyError * .35), 55, 100) : clamp(Math.round(45 - frequencyError * .3), 0, 45);
  const evAvailable = items.every((item) => item.ev !== null);
  const bestEv = evAvailable ? Math.max(...items.map((item) => item.ev as number)) : null;
  const choiceEv = evAvailable && choice ? choice.ev : null;
  const loss = bestEv !== null && choiceEv !== null ? round(Math.max(0, bestEv - choiceEv)) : null;
  return {
    correct,
    frequency,
    frequencyError,
    score,
    loss,
    knowledgeState: knowledgeState(correct, confidence),
  };
}

export type { HandRecord };
export { ACTIONS, POSITIONS, RANKS, SCENARIOS, STACKS, round };
