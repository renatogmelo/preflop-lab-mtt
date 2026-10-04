import { comboStrength } from "../cards/cards";
import { hashValue } from "../core/stable";
import type { ContinuationRequest, ContinuationResult, StrategicContinuationProvider } from "./engine";

export class StrengthProxyProvider implements StrategicContinuationProvider {
  readonly id = "strength-proxy-v1";
  readonly level = 0 as const;
  readonly eligibleForVerified = false;

  evaluate(request: ContinuationRequest): ContinuationResult {
    const fixed = request.ranges.fixedCombos;
    if (!fixed) throw new Error("strength-proxy-v1 only supports fixed combo pairs in the Phase 4 comparison harness.");
    const difference = comboStrength(fixed[0]) - comboStrength(fixed[1]);
    const positionalAdjustment = request.state.inPositionPlayer === 0 ? 0.01 : request.state.inPositionPlayer === 1 ? -0.01 : 0;
    const equityProxy = Math.max(0.03, Math.min(0.97, 0.5 + difference * 0.82 + positionalAdjustment));
    const first = equityProxy * request.state.pot - request.state.contributions[0];
    const utilities: [number, number] = [first, -first];
    return {
      utilities,
      model: this.id,
      confidence: "modeled",
      metadata: {
        equityProxy,
        warning: "Hole-card strength heuristic only; no boards or postflop strategy are modeled.",
      },
      computationId: hashValue({ provider: this.id, request, utilities }),
    };
  }
}
