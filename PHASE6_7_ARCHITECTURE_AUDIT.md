# Phase 6.7 Architecture Audit

Baseline audited: `842263ea678d0c64f15df0bd638dc9ccc5ae4080`. Historical state: A PASS / B PASS / C PASS / D FAIL. Verified datasets remain `0`.

## Evidence read

The audit covered `PHASE6_REPORT.md`, `PHASE6_5_REPORT.md`, `PHASE6_6_REPORT.md`, the fixed-point and sensitivity reports, and the implementation behind the recorded artifacts. Phase 6 established a fast generic CFR core but retained seed noise and a failed outer coupling. Phase 6.5 removed the sampled-preflop noise and proved deterministic resume, while the coupled map still failed after 100 iterations. Phase 6.6 separated finite-solve error, Bayesian amplification and abstraction error, measured a normalized raw residual of `0.227703` and a LocalResponseRatio of `8.663430`, and correctly left Gate D failed.

## Reusable generic components

| Existing component | Decision | Reason |
|---|---|---|
| `solver/core/types.ts` | Reused | `ExtensiveGame`, behavioral strategy and two-player actor contracts are game-agnostic. |
| `solver/tree/compiled.ts` | Reused | Deterministic full-tree compilation and structural counts do not depend on poker. |
| `solver/algorithms/cfr.ts` | Reused | Vanilla CFR, CFR+ and DCFR traverse any valid `ExtensiveGame`. |
| `solver/evaluation/best-response.ts` | Reused | Exact information-set-consistent best response, NashConv and exploitability are generic. |
| `solver/core/stable.ts` | Reused | Stable configuration, game, strategy and checkpoint hashes. |
| `solver/analysis/phase6-6.ts` | Reused selectively | Raw residual norms and safeguarded Anderson are mathematical utilities, not poker rules. |
| `solver/comparison/strategy-distance.ts` | Reused | Behavioral-strategy distance is game-agnostic. |
| Existing CFR checkpoint | Reused | It already preserves regrets, sums, iteration and provenance deterministically. |

## Components intentionally isolated

Poker definitions, cards, ranges, betting, conditional poker ranges, board abstractions and continuation providers were not imported into the new research games. `solver/game/definition.ts` remains poker-oriented and was not widened in a way that could change existing behavior. The previous coupling engines remain untouched for historical regression.

## Architectural finding

The old pipeline solved two distinct models and exchanged continuation utilities through an external fixed-point loop. The new unified path represents initial choices, chance, public signals and continuation decisions in one extensive-form tree and updates every information set within the same CFR process. The decomposed research baseline still uses the exact same synthetic game definition, but deliberately alternates a continuation solve and an initial re-solve so decomposition error can be measured without a game-definition confound.

## Audit conclusion

The repository already contained a trustworthy generic traversal/evaluation substrate. The missing layer was a declarative, non-poker game definition with structural validation, independent normal-form ground truth and a fair paired decomposed operator. Those were added under `solver/research/**`; no poker strategy was changed.
