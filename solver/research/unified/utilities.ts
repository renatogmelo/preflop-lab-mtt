import { enumerateResearchStates, type UnifiedResearchGame } from "./game-tree";

export function zeroSumAudit(game: UnifiedResearchGame) {
  const terminals = enumerateResearchStates(game).filter((state) => game.isTerminal(state));
  const maximumError = terminals.reduce((maximum, state) => Math.max(maximum, Math.abs(game.utility(state, 0) + game.utility(state, 1))), 0);
  return { valid: maximumError <= 1e-12, terminals: terminals.length, maximumError };
}

export function normalizedProbabilities(actions: readonly string[], supplied?: Record<string, number>) {
  if (!supplied) return actions.map(() => 1 / actions.length);
  const values = actions.map((action) => supplied[action] ?? 0);
  if (values.some((value) => value < 0 || !Number.isFinite(value))) throw new Error("Strategy probabilities must be finite and non-negative.");
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new Error("Strategy probability mass must be positive.");
  return values.map((value) => value / total);
}
