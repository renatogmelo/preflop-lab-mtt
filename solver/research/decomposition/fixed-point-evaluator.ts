import { residualNorms } from "../../analysis/phase6-6";
import type { BehavioralStrategy } from "../../core/types";
import type { UnifiedResearchGame } from "../unified/game-tree";
import { ContinuationOperator, gameInformationSets } from "./continuation-operator";

function vector(game: UnifiedResearchGame, strategy: BehavioralStrategy) {
  return gameInformationSets(game, "initial").flatMap(([key, actions]) => actions.map((action) => strategy[key]?.[action] ?? 0));
}

export function evaluateFixedPoint(game: UnifiedResearchGame, strategy: BehavioralStrategy, innerIterations: number) {
  const mapped = new ContinuationOperator(game, innerIterations).map(strategy);
  return { residual: residualNorms(vector(game, strategy), vector(game, mapped.initialStrategy)), mapped };
}

export function operatorSensitivity(game: UnifiedResearchGame, strategy: BehavioralStrategy, innerIterations: number, epsilon = 1e-3) {
  const entries = gameInformationSets(game, "initial");
  const key = entries[0][0];
  const actions = entries[0][1];
  const perturbed = structuredClone(strategy);
  perturbed[key][actions[0]] = Math.max(0, perturbed[key][actions[0]] + epsilon);
  perturbed[key][actions[1]] = Math.max(0, perturbed[key][actions[1]] - epsilon);
  const base = new ContinuationOperator(game, innerIterations).map(strategy);
  const moved = new ContinuationOperator(game, innerIterations).map(perturbed);
  const input = residualNorms(vector(game, strategy), vector(game, perturbed)).l2;
  const output = residualNorms(vector(game, base.initialStrategy), vector(game, moved.initialStrategy)).l2;
  return { epsilon, inputDistance: input, outputDistance: output, localResponseRatio: input > 0 ? output / input : null };
}
