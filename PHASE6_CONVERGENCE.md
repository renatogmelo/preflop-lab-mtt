# Phase 6 - Convergence and Seed Stability

Status: Experimental. This document reports the frozen `phase6-reference-game-v1`; it is not an 8-max or externally validated poker solution.

## Frozen reference

- Source commit: `b0e8c5b814e92c71e7c3fae5d17935c087dcdc80`
- Game hash: `bfd3615d6ee13da1`
- Compatible private deals: 46
- Flop: `8h 7d 2c`
- Tree: 11,179 nodes, 4,508 terminals, 967 chance nodes, 5,704 action nodes, 2,032 information sets, maximum depth 11
- Future streets: two deterministic representative cards per bucket; this abstraction changes the solved game
- Betting: one size on each street, no raises and no jams

## Convergence curve

The selected configuration was DCFR `(alpha=2, beta=0, gamma=3)` on the indexed tree. All exploitability values are exact best-response measurements in the reduced game.

| Iterations | Exploitability | Reach-weighted delta | Raw max delta | Cumulative runtime |
|---:|---:|---:|---:|---:|
| 20 | 0.225245 | n/a | n/a | 0.071 s |
| 50 | 0.123096 | 0.053527 | 0.983941 | 0.167 s |
| 100 | 0.081901 | 0.037717 | 0.810862 | 0.291 s |
| 250 | 0.048778 | 0.060639 | 0.999128 | 0.564 s |
| 500 | 0.033951 | 0.016738 | 0.525328 | 0.982 s |
| 1,000 | 0.022681 | 0.009682 | 0.291750 | 1.774 s |
| 2,500 | 0.014789 | 0.009192 | 0.663187 | 4.050 s |
| 5,000 | 0.010074 | 0.003723 | 0.138292 | 7.870 s |

The final solve visited 111,790,000 nodes, produced EV `[+0.10017756, -0.10017756]`, NashConv `0.02014808`, and average positive regret `0.00002818`.

The finite-solve policy requires exploitability <= 0.01, reach-weighted delta <= 0.005, deterministic reproduction, and seed stability. The final point narrowly misses exploitability (`0.010074 > 0.01`) and fails the separate seed-stability requirement. It is therefore not labeled converged/verified even though Phase 7 gate A uses the looser diagnostic threshold `< 0.02` and passes.

## Algorithm study at 2,500 iterations

| Algorithm/configuration | Exploitability | Reach-weighted delta | Runtime |
|---|---:|---:|---:|
| Vanilla CFR | 0.018716 | 0.015093 | 4.150 s |
| CFR+ delay 0 | 0.037997 | 0.017392 | 4.148 s |
| DCFR 1.5/0/2 | 0.016319 | 0.009303 | 4.474 s |
| DCFR 1/0/1 | 0.027861 | 0.013956 | 4.520 s |
| DCFR 2/0/3 | **0.014789** | **0.009192** | 4.125 s |
| DCFR 1.5/-0.5/2 | 0.018032 | 0.017417 | 4.129 s |

Baseline DCFR reached the `<0.05` threshold slightly earlier than Vanilla in the valid run (`1.027 s` versus `1.040 s`) and is the wall-clock winner under the declared threshold rule. DCFR 2/0/3 had the best final quality and was extended to 5,000 iterations. CFR+ delays 100 and 500 did not beat the selected DCFR configuration.

No CFR+/DCFR formula bug was found. Formula unit tests, object-versus-indexed differential tests, and checkpoint/resume equality all pass. The important defect was performance: repeated object traversal and dynamic best response hid the feasible budget.

## Why raw delta reached 1.0

Raw maximum strategy delta is dominated by a single information set and treats unreachable or nearly unreachable decisions like trunk decisions. It is mathematically real for that table entry but a poor global convergence summary. The implementation now reports:

- maximum delta;
- active-infoset delta;
- reach-weighted delta;
- probability-mass-weighted delta;
- active and compared infoset counts;
- total reach mass.

At 5,000 iterations raw max delta remained `0.138292`, while reach-weighted delta was `0.003723`. This shows the former Phase 5 value near 1.0 was largely metric pathology, not evidence that the entire strategy moved by 100%.

## Five-seed stability

Seeds: `1, 7, 19, 42, 99`; 10 pairwise distances per provider; 10,000 preflop iterations per run.

| Provider | Mean distance | Std dev | 95% CI | Mean exploitability |
|---|---:|---:|---:|---:|
| Proxy | 0.138480 | 0.051506 | [0.106556, 0.170404] | 0.001157 |
| Equity | 0.005514 | 0.003604 | [0.003280, 0.007748] | 0.000650 |
| Solved | 0.126345 | 0.022739 | [0.112251, 0.140438] | 0.020076 |

Solved improved from the Phase 5 mean distance `0.203640` to `0.126345`, but remains materially above the declared `0.1` stability gate. The postflop full-tree solve itself is deterministic: five frozen-range runs produced one strategy hash and pairwise distance zero. The remaining variation comes from the sampled preflop continuation pipeline, not from postflop CFR seed use.

## Provider separation

Equity versus Solved weighted mean absolute strategy distance is `0.653360`. Dividing by Solved within-provider seed noise `0.126345` gives the Preflop Lab diagnostic `ProviderSeparationRatio = 5.171253`.

This is not a standard academic statistic. It says the provider-level signal is larger than measured seed noise, but it does not make either provider correct. External comparison and a converged coupling fixed point remain absent.

## Reproducibility

- Continuous 500 iterations and checkpoint 250 -> resume 500 are bit-identical in the deterministic test.
- Object-tree and indexed-tree solvers produce identical strategies and infoset checkpoint state.
- The benchmark records every configuration, seed, hash, stop reason, environment and two failed harness attempts in `solver/experiments/phase6-manifest.json`.
- Full checkpoint: `solver/artifacts/phase6-reference-v0.4.0.checkpoint.json`.