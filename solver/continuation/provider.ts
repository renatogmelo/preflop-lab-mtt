import { comboStrength, type HoleCombo } from "../cards/cards";

export type ContinuationContext = {
  pot: number;
  effectiveStack: number;
  inPositionPlayer: 0 | 1 | null;
};

export type ContinuationEvaluation = {
  equity: number;
  utilities: [number, number];
};

export interface ContinuationValueProvider {
  readonly id: string;
  readonly level: 0 | 1 | 2;
  readonly utilityModel: "equity-approximation" | "external-table" | "solved-subgame";
  readonly eligibleForVerified: boolean;
  evaluate(hero: HoleCombo, villain: HoleCombo, context: ContinuationContext): ContinuationEvaluation;
}

export class EquityApproximationProvider implements ContinuationValueProvider {
  readonly id = "strength-proxy-v1";
  readonly level = 0 as const;
  readonly utilityModel = "equity-approximation" as const;
  readonly eligibleForVerified = false;

  evaluate(hero: HoleCombo, villain: HoleCombo, context: ContinuationContext): ContinuationEvaluation {
    const difference = comboStrength(hero) - comboStrength(villain);
    const positionalAdjustment = context.inPositionPlayer === 0 ? 0.01 : context.inPositionPlayer === 1 ? -0.01 : 0;
    const equity = Math.max(0.03, Math.min(0.97, 0.5 + difference * 0.82 + positionalAdjustment));
    const utility = (2 * equity - 1) * context.effectiveStack;
    return { equity, utilities: [utility, -utility] };
  }
}
