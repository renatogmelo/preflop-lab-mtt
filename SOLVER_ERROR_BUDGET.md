# Solver Error Budget

This file prevents unlike uncertainties from being collapsed into a single confidence number. All current Phase 6 outputs remain Experimental.

| Error source | Phase 6 measurement | Interpretation | Gate/action |
|---|---|---|---|
| Finite inner CFR | exploitability 0.010074; NashConv 0.020148 at 5,000 iterations | Reduced-game approximation is close, but narrowly misses the strict 0.01 policy | More iterations or improved convergence; do not round down |
| Strategy movement | raw max 0.138292; reach-weighted 0.003723 | Residual movement is concentrated away from high-reach mass | Report both; never use raw max alone |
| Seed variance | Solved mean pairwise distance 0.126345, 95% CI [0.112251, 0.140438] | Material and above the 0.1 research gate | Block stable combo-level claims |
| Provider/model | Equity-vs-Solved distance 0.653360; PSR 5.171253 | Provider choice changes strategy more than measured Solved seed noise | Signal exists; correctness is still unknown |
| Outer coupling | best alpha 0.25 ends at deltas 0.152837 / 0.164987 / 0.356127 / ~1.0 | No fixed-point evidence | Block Phase 7 expansion |
| Future-board abstraction | two representative outcomes per street bucket | Solves a different, deliberately reduced game | Cannot generalize to real NLHE boards |
| Betting abstraction | one size per street; no raises/jams | Strategic action space is incomplete | Cannot claim professional postflop ranges |
| Range/board scope | seven physical combos per range, one flop | Severe coverage limitation | Cannot generalize to 169 hands or 8-max |
| Sampling | postflop traversal deterministic; preflop provider pipeline sampled | Main observed seed noise is upstream of postflop CFR | Control random numbers or evaluate exactly |
| Floating point | f64; object/indexed and resume differential equality | No observed numerical divergence in tested scope | Retain oracle tests and hashes |
| Cache quantization | selected 1e-9; 4e-9 perturbation gets distinct key | Collision risk bounded and explicit | Keep quantization in artifact/cache metadata |
| External validity | no external solver comparison or independent review | Internal consistency is not poker truth | Verified remains zero |

## No scalar total

These errors are not independent and use different units. Adding exploitability, strategy distance and abstraction error would be false precision. Reports must keep them separate and state which gate each affects.

## Publication policy

A result may be called a converged approximation only when its declared exploitability and reach-weighted movement thresholds pass and deterministic reproduction is demonstrated. `Verified` additionally requires exact game identity, independent reproduction, external reference comparison within declared tolerance, review, immutable provenance and no unresolved critical validation issue. Phase 6 satisfies none of the conditions needed to increase `verifiedDatasets` above zero.
## Phase 6.5 separated error budget

Errors remain separate; they are not added into a fake scalar uncertainty.

- finite postflop CFR: exploitability `0.017258` at 5,000 iterations;
- exact preflop seed variance: `0`;
- finite sampled-preflop error: at 5,000 samples, mean distance `0.163037` IID, `0.163358` fixed CRN, `0.147677` stratified and `0.063091` quasi-deterministic;
- future-board abstraction: unquantified; exact strategic ablation blocked at projected `5,533,605` nodes above the `2,000,000` safety cap;
- range→continuation sensitivity: high and epsilon-dependent, slope variation `261.960593`;
- outer fixed-point residual at iteration 100: range `0.079894`, raw utility `2.660087`, damped utility `0.053868`, postflop reach-weighted strategy `0.044017`;
- cache quantization: `1e-9`, explicit in identity;
- external-validation error: unmeasured; no independent solver comparison.

A/B/C pass and D fails. `Verified = 0`.