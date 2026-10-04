# Phase 6 Report - Convergence, Stability and Fixed-Point Audit

Status: completed as an Experimental research milestone. Verified datasets: **0**.

## Executive answer

The inner reduced-game solver is now fast, measurable and close to the declared exploitability target. The indexed implementation is differential-equivalent to the object-tree oracle and enables a 5,000-iteration solve in 7.87 seconds. However, the complete pipeline is not yet numerically trustworthy for professional training ranges: Solved seed distance is 0.126345 and no damping configuration reaches a preflop/postflop fixed point. Phase 7 expansion is blocked.

This is a useful negative result. It separates a largely solved performance problem from two remaining scientific problems: sampled preflop instability and discontinuous outer-loop feedback under the current tiny abstraction.

## Provenance

- Audited baseline: `a9f3f8fe530f32a34020698299c9c522c41f1bc3`
- Phase 6 implementation commit: `b0e8c5b814e92c71e7c3fae5d17935c087dcdc80`
- Solver: `0.4.0`
- Reference id/hash: `phase6-reference-game-v1` / `bfd3615d6ee13da1`
- Scope: 46 compatible private deals, one fixed flop, 11,179 nodes, 2,032 infosets
- Main artifact: `solver/artifacts/phase6-convergence-stability-v0.4.0.json`
- Checkpoint: `solver/artifacts/phase6-reference-v0.4.0.checkpoint.json`
- Manifest: `solver/experiments/phase6-manifest.json`

The manifest includes two failed full-run attempts: an invalid quantization fixture rejected by range validation, and an incorrect serialization reference caught by post-run audit. Both were corrected and the complete matrix was rerun; neither failed artifact is used below.

## Mandatory questions

### 1. The 0.270565 exploitability fell to what?

`0.0100740384` at the final selected solve. NashConv is `0.0201480768`. This is a 96.28% reduction from the 20-iteration Phase 5 point, but it remains just above the strict `0.01` finite-solve policy.

### 2. With how many iterations?

5,000 indexed DCFR iterations with `(alpha=2, beta=0, gamma=3)`.

### 3. In how much time?

7.870 seconds of cumulative convergence-run wall clock. The profiled phase total was 8.747 seconds including compilation and all diagnostic groups. The complete experiment matrix took 460.957 seconds.

### 4. Which algorithm won by wall clock?

Baseline DCFR won the declared time-to-`exploitability < 0.05` comparison: 1.027 s versus Vanilla CFR at 1.040 s. DCFR 2/0/3 produced the best quality at 2,500 iterations (`0.014789`) and was selected for the 5,000 extension. Timing differences around one second are machine observations, not universal rankings.

### 5. Was there a CFR+/DCFR bug?

No mathematical formula bug was found. Discount and delayed-averaging formulas have unit tests; object and indexed solvers match exactly; continuous and resumed solves match exactly. CFR+ simply underperformed on this frozen game. The defects found were unnecessary recomputation, an inadequate raw strategy-delta summary, and two benchmark-harness bugs recorded in the manifest.

### 6. Was strategy delta 1.0 real or a metric problem?

Both in a precise sense: an individual low/unreached infoset can really move by 1.0, but using that maximum as a whole-strategy convergence claim is misleading. The reach-aware metrics show much smaller relevant movement. In coupling, postflop raw delta remains ~1 while range and utility deltas also fail, so the outer instability cannot be dismissed as only a metric artifact.

### 7. What is the final reach-weighted strategy delta?

`0.0037231349`; probability-mass-weighted delta is `0.0039283881`; raw maximum is `0.1382920850`.

### 8. What is the variance across at least five seeds?

Five seeds (`1,7,19,42,99`) generate ten pairwise distances per provider:

| Provider | Mean | Std dev | 95% CI |
|---|---:|---:|---:|
| Proxy | 0.138480 | 0.051506 | [0.106556, 0.170404] |
| Equity | 0.005514 | 0.003604 | [0.003280, 0.007748] |
| Solved | 0.126345 | 0.022739 | [0.112251, 0.140438] |

### 9. Did the Solved provider become stable?

No. It improved materially from Phase 5 (`0.203640 -> 0.126345`) but fails the declared `<0.1` gate. Frozen-range postflop CFR is deterministic; the measured variation is in the sampled preflop provider pipeline.

### 10. Are Equity and Solved still different?

Yes. Weighted mean absolute strategy distance is `0.653360`. The Preflop Lab diagnostic `ProviderSeparationRatio` is `5.171253`, so provider separation exceeds measured Solved seed noise. This establishes a signal, not which provider is correct.

### 11. Did QQ/AKs/JJ/T9s/AKo shifts persist?

T9s, QQ, AKs and JJ are classified persistent; AKo is reduced. These are diagnostics inside a reduced unstable model, not training recommendations. For example, Equity-vs-Solved gaps are `-0.992659` for T9s call, `-0.862238` for QQ raise, `-0.914901` for AKs raise, `-0.703462` for JJ call and `-0.379721` for AKo raise.

### 12. Which per-action EVs were obtained?

Utilities are chips/BB units of the reduced game and are counterfactual at the listed infoset.

| Target | Frequencies | Action EVs | Strategy EV |
|---|---|---|---:|
| T9s BB | fold 99.343%, call 0.657% | fold -1.000000; call -1.526036 | -1.003454 |
| QQ SB | fold 86.289%, raise 13.711% | fold -0.500000; raise -0.631128 | -0.517978 |
| AKs SB | fold 91.531%, raise 8.469% | fold -0.500000; raise -0.718408 | -0.518497 |
| JJ BB | fold 70.440%, call 29.560% | fold -1.000000; call -0.972664 | -0.991919 |
| AKo SB | fold 38.130%, raise 61.870% | fold -0.500000; raise -0.475711 | -0.484972 |

The counterintuitive QQ/AKs values are evidence of the reduced continuation model and non-stable preflop pipeline; they must not be presented as poker truth.

### 13. Do mixed strategies have coherent EVs?

Not consistently. Eight infosets had both actions at least 1%. Mean mixed-action EV spread is `0.165976`, median `0.146699`, minimum `0.024289`, maximum `0.451124`. AKo (`0.024289`) and JJ (`0.027336`) are relatively close; several others are not. Many small positive frequencies are finite-solve averaging/noise, so the mixed frequencies are not publication-ready.

### 14. Did coupling converge?

No. None of alpha 0.25, 0.4, 0.6 or 1.0 achieved even one all-metric convergence pass; patience required three.

### 15. Which alpha was best?

Alpha `0.25`, by smallest final preflop delta (`0.152837`) and continuation utility delta (`0.356127`) without divergence. “Best” means least unstable in this grid, not converged.

### 16. How many outer iterations?

Alpha 0.25 and 0.4 used all 10. Alpha 0.6 stopped as divergent at 6; alpha 1.0 stopped as divergent at 4.

### 17. Was there oscillation?

The explicit period-two detector did not fire. There was nevertheless instability: alpha 0.6 and 1.0 triggered divergence, and alpha 0.25/0.4 remained far above thresholds. No-oscillation is not fixed-point evidence.

### 18. What speedup was obtained?

Indexed traversal throughput was `9.90x` the object-tree oracle. The Phase 5 20-iteration wall comparison was `57.70x`, which also includes removed setup/rebuild costs. Compiled best response was `117.40x`; repeated cached equity requests were `27,026x` faster than cold requests, a cache-specific ratio.

### 19. What is the main hot path now?

Indexed CFR traversal, regret matching and infoset lookup: `85.50%` of measured profiled time. Compilation is second at `10.00%`.

### 20. Is Rust necessary now?

No. TypeScript completes the frozen 5,000-iteration solve in 7.87 s. Rust should be reconsidered only after a larger declared scale gate makes traversal throughput the blocker; today scientific stability is the blocker.

### 21. How many tests pass?

The complete repository validation passes **82/82 tests**, plus TypeScript, lint and production build. Thirteen are focused Phase 6 implementation tests and three are Phase 6 golden/provenance tests. No performance timing is used as a brittle test assertion.

### 22. Which limitations remain?

Reduced heads-up game rather than 8-max; one flop; seven physical combos per range; two representative future-board outcomes; one bet size per street; no raises or jams; sampled preflop continuation variance; no coupling fixed point; no external solver comparison; no independent review.

### 23. What blocks Phase 7?

Gate B (seed stability) and gate D (coupling fixed point) fail. Gate A (inner approximation under the research threshold) and gate C (provider signal exceeds seed noise) pass. Do not expand boards, ranges or table size until B and D pass.

### 24. What blocks Verified?

The game is severely abstracted, the strict convergence policy is not fully satisfied, seeds are unstable, coupling does not converge, and there is no external reference solve or independent review. `verifiedDatasets` remains exactly zero.

## Stop gate

| Gate | Result |
|---|---|
| A - inner solver converges under research threshold | PASS |
| B - seeds approach the same strategy | **FAIL** |
| C - Solved/Equity signal exceeds measured noise | PASS |
| D - coupling tends to a fixed point | **FAIL** |

Decision: do not scale to Phase 7. The next work should reduce/control preflop sampling and establish a fixed point on this exact frozen game before expanding poker scope.