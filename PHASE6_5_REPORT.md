# Phase 6.5 Report — Deterministic Preflop Continuation and Fixed-Point Audit

Status: **Experimental**. `Verified = 0`.

## Executive result

The frozen `phase6-reference-game-v1` remained unchanged: 46 compatible private deals, flop `8h 7d 2c`, reduced HU 10bb preflop, 11,179 postflop nodes and 2,032 postflop infosets. Phase 6.5 removed preflop seed noise with exact private-card traversal, but did not prove convergence of the coupled preflop↔postflop map.

- Gate A — inner convergence: **PASS**, exploitability `0.017258 < 0.02`.
- Gate B — solved-provider seed stability: **PASS**, exact mean distance `0` (all B0–B4 tiers pass).
- Gate C — provider signal exceeds seed noise: **PASS**, Equity↔Solved distance `0.629219` with exact seed noise `0`; the ratio has an infinite zero-noise limit.
- Gate D — deterministic fixed point: **FAIL** after 100 outer iterations.
- Phase 7 recommendation: **blocked** because all four gates did not pass.

The final Gate D point at alpha `0.05` was:

- preflop reach-weighted strategy delta `0.001211`;
- conditional-range L1 delta `0.079894`;
- raw continuation-utility delta `2.660087`;
- damped continuation-utility delta `0.053868`;
- postflop reach-weighted strategy delta `0.044017`;
- no detected period-2/period-3 cycle;
- zero consecutive convergence passes.

## Provenance

- baseline commit: `893d62720ca465153030ba5d3dcff25403f8f979`;
- implementation/source commit: `033aa3089ec85ac3ca9110cd9b2258b7d6c7df06`;
- final publication commit: `c194832118a421426efd4bc4ebef4751e71cf7b3`;
- solver version: `0.5.0`;
- game hash: `bfd3615d6ee13da1`;
- primary artifact SHA-256: `9864c47baee02cc15d33d1bd3d2ee3e5d8659b1697df1b808d8621a0a4fe98ed`;
- golden SHA-256: `145d434413f7b2111e1df4897942d0bdfeb3d98420f90a90afe88d50730d6467`;
- manifest SHA-256: `5b71b969f19a9c5c6594a80ad93d24e5d905a6ddb6e779bb3ade152845948324`.

Hashes above identify the generated files before the documentation-only publication commit. The files themselves are authoritative.

## Mandatory questions

1. **Where did seed variance arise?** In Phase 6, `HoldemPreflopV2Solver` sampled one private deal per iteration from a mutable deterministic RNG stream. Different seeds changed deal visitation order/counts and therefore regret updates, strategy sums and conditional ranges. Full-tree postflop CFR was already deterministic.
2. **Was exact preflop traversal implemented?** Yes. `ExactChanceCfrSolver` enumerates all 46 weighted deals every iteration with synchronous per-player regret accumulation.
3. **What is its runtime?** Five 5,000-iteration Solved runs averaged `325.495 ms` on the recorded machine (median `322.175 ms`; min `219.983`; max `424.591`).
4. **Is it deterministic?** Yes for the frozen game/provider/configuration. Seed is provenance only.
5. **Repeated-exact strategy distance?** `0` for every distance metric and identical strategy hashes.
6. **IID distance to exact?** At the 5,000-sample five-seed matrix: mean weighted strategy distance `0.163037` (95% descriptive interval `0.108357–0.217716`). At seed 19 and 10,000 samples: `0.130130`.
7. **Stratified distance?** At 5,000 samples: mean `0.147677`. At seed 19 and 10,000: `0.164869`. Coverage improved, but finite regret path order still mattered.
8. **CRN/fixed-schedule distance?** At 5,000 samples: mean `0.163358`. At seed 19 and 10,000: `0.152813`. CRN is primarily a paired-comparison control; it does not eliminate within-provider finite-sample error.
9. **Which sampled method won?** Quasi-deterministic: distance `0.063091` at 5,000 and `0.046900` at 10,000, with all 46 deals covered.
10. **Final Solved seed distance?** `0` under exact traversal.
11. **Did Gate B pass?** Yes. B0 through B4 all pass, including `< 0.005`.
12. **Did Equity vs Solved distance change?** Yes: Phase 6 `0.653360` to exact Phase 6.5 `0.629219`, a decrease of `0.024141` (~`3.70%`).
13. **Did ProviderSeparationRatio change?** The finite numeric ratio `5.171253` became a zero-noise limit: between-provider distance is positive (`0.629219`) and within-provider exact noise is zero, so the mathematical limit is infinite. The serialized legacy helper leaves `value = null` to avoid JSON Infinity and records `zeroNoiseLimit = "infinite"`.
14. **Did QQ/AKs/JJ/T9s/AKo shifts persist?** Phase 6 classifications remain: T9s, QQ, AKs and JJ persistent; AKo reduced. Exact Solved action frequencies are respectively approximately `0`, `0.088072`, `0`, `0.377854`, and `0.530266` for the audited action.
15. **How much Phase 6 provider difference was sampling noise?** It cannot be validly decomposed by subtraction. As a scale diagnostic, Phase 6 Solved seed noise `0.126345` was ~`19.34%` of the old Equity↔Solved distance; after removing it, `96.30%` of the old provider distance remained (`0.629219 / 0.653360`). Provider separation was therefore real in this reduced game, not mainly seed noise.
16. **Was board-bucket mapping stable?** Yes after canonicalizing available cards by `card.id`. All 46 private deals and their turn/river reverse-order permutations matched.
17. **Was an artificial discontinuity found?** Yes, in range→continuation finite differences: derivative estimates changed sharply with epsilon and slope variation was `261.961`. This is evidence of approximation/solver discontinuity, not a differentiable stable map.
18. **Is range→continuation sensitivity high?** Yes. Maximum absolute derivatives were about `297.914`, `53.726`, `28.906`, and `7.048` for epsilons `1e-4`, `1e-3`, `1e-2`, and `5e-2`.
19. **Did exact future-card ablation change this?** Not determined. The projected frozen strategic tree was `5,533,605` nodes, above the declared single-process cap of `2,000,000`; the negative/blocked experiment is recorded. No claim is made about the exact-board result.
20. **Which alpha was best?** `0.05` in the 10-iteration screening grid.
21. **How many outer iterations were needed?** The run exhausted 100 without convergence.
22. **Did coupling converge?** No.
23. **Was there oscillation?** No approximate period-2 or period-3 cycle was detected at the final point.
24. **Was there divergence?** No monotonic-divergence stop was observed; however raw continuation movement remained large (`2.660087`) and the map was not contractive enough to satisfy the gate.
25. **Did Gate D pass?** No. Three required residuals remained over `0.02`, and there were zero consecutive passes.
26. **Did A remain PASS?** Yes, revalidated at exploitability `0.017258`.
27. **Did C remain PASS?** Yes; exact provider separation is positive while exact seed noise is zero.
28. **Final A/B/C/D?** `A PASS / B PASS / C PASS / D FAIL`.
29. **How many tests pass?** `93/93` in the final repository-wide run (82 prior tests + 8 functional Phase 6.5 tests + 3 golden tests).
30. **Can Board Coverage be released?** No.
31. **Exact remaining blocker?** The deterministic coupled map does not reach the predeclared fixed-point tolerances. At iteration 100, conditional ranges, damped continuation utilities and reach-weighted postflop strategy still exceed `0.02`. Exact-board abstraction error also remains unmeasured under the resource cap.

## Interpretation

Phase 6.5 answers the core question quantitatively: repeating the preflop solve with the same provider now gives exactly the same strategy, and checkpoint/resume reproduces the continuous outer trajectory exactly. The coupled pipeline itself, however, does not converge to the required fixed point under the frozen approximation. This is a model/coupling stability problem, not remaining preflop seed noise.

This artifact is not proof of full-game GTO poker. It remains a reduced HU experiment with one flop, seven physical combos per range, a two-representative future-board abstraction, restricted betting, no external solver comparison and no independent review.