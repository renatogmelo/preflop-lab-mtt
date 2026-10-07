# Phase 6.7 Report — Unified Game Architecture & Convergence Research

## Outcome

Yes: a unified full-tree architecture produced stable, reproducible and independently auditable solutions for all three small sequential imperfect-information games. It removed the need for an external fixed-point iteration in those games. The paired decomposed baseline remained materially exploitable and retained large raw residuals, especially when initial decisions changed continuation beliefs.

This is evidence for continuing unified-architecture research, not evidence that the poker solver is solved. Poker strategies were not changed, Verified remains `0`, and historical Gate D remains **FAIL**.

## Gates

| Gate | Result | Evidence |
|---|---|---|
| U1 — structural tree correctness | PASS | chance, recall, action consistency and zero-sum audits pass for all games |
| U2 — independent equilibrium validation | PASS | normal-form references have zero exploitability; unified final exploitability `< 0.01` |
| U3 — reproducible convergence | PASS | hashes match across declared seeds; all exploitability curves improve through 10,000 |
| U4 — fair decomposition comparison | PASS | identical game definitions and utilities, with raw residuals and costs recorded |
| U5 — deterministic checkpoint/resume | PASS | unified and decomposed strategies and semantic trajectories reproduce exactly |

Historical gates remain A PASS / B PASS / C PASS / D FAIL.

## Mandatory answers

1. **Was the unified solver implemented?** Yes. It solves every initial and continuation information set in one compiled extensive-form tree.
2. **Which games were used?** Sequential Hidden Choice, Public Signal Game and Coupled Decision Game.
3. **Were equilibria independently validated?** Yes, by exhaustive pure-plan normal-form construction plus equilibrium support enumeration and saddle-inequality checks.
4. **Final exploitability?** `0.0013816403`, `0.0015096820` and `0.0000097806`, respectively.
5. **Final NashConv?** `0.0027632807`, `0.0030193640` and `0.0000195613`.
6. **Was convergence reproducible?** Yes. Deterministic runs produced identical strategy hashes and monotone budget-level exploitability improvement.
7. **How did decomposition behave?** Undamped and damped variants retained large residuals; Anderson improved finite results but did not solve the fixed point.
8. **Which games were unstable?** All decomposed games missed a small-residual criterion; Coupled was worst (`1.411377` undamped, `0.940918` damped, `0.754847` Anderson).
9. **Identified cause?** Frozen continuation responses, belief/distribution feedback, response-boundary changes and observed non-contractive directions; finite inner solves add error but do not explain the whole gap.
10. **Did unified remove external fixed-point iteration?** Yes for the three reference games.
11. **Computational cost?** At 10,000 iterations: roughly `128 ms`, `178 ms` and `318 ms`, visiting `220k`, `380k` and `620k` nodes.
12. **Did checkpoint/resume work?** Yes, exactly for unified and decomposed trajectories.
13. **How many tests passed?** `135/135`, plus TypeScript, lint and the production build.
14. **Remaining limitations?** Small synthetic games, exponential ground truth, finite solves, coarse memory measurement, no external solver and no poker-scale evidence.
15. **Recommendation?** Continue researching the unified architecture on progressively larger synthetic games while keeping poker expansion blocked until new evidence justifies it.

## Scientific answer

For the tested class, **yes**: one unified game tree produced stable and mathematically auditable approximate equilibria and avoided the external consistency equation that destabilized decomposition. The result is conditional on small finite games and does not transfer automatically to the existing poker coupling problem.

## Validation

The generated artifact is `solver/artifacts/phase6-7-unified-research-v0.7.0.json`. It contains configurations, budget curves, game/configuration/experiment/strategy/checkpoint hashes, ground truth, all decomposition variants, initialization sensitivity, performance, gates, failures and limitations. Final validation passed: TypeScript, ESLint, production build and `135/135` repository tests.
