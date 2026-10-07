# Phase 6.6 Report — Continuation Operator Diagnosis

## Outcome

Phase 6.6 answers the central question: the deterministic preflop↔postflop operator remains unstable because finite-solve error is only part of the problem, Bayesian conditioning can amplify selected range directions, and the outer map is not locally contractive in the frozen reference game. Gate D v2 **FAILS honestly**. A/B/C remain PASS. Verified remains 0. Phase 7 is not recommended yet.

Provenance: baseline `ef0b0b06971d86a06446cecff93d036fe34873f9`; implementation `681168a58928f7e0bb54df9d9bb1e7a9d26032ef`; finalizer `53649b2`; reference `phase6-reference-game-v1` / `bfd3615d6ee13da1`; solver `0.6.0`.

## Gate matrix

| Gate | Result | Evidence |
|---|---|---|
| A | PASS | exploitability 0.017258 < 0.02 |
| B | PASS | exact seed distance 0.000000 |
| C | PASS | Equity↔Solved RW distance 0.629219 |
| D v2 | FAIL | normalized raw residual 0.227703 > 0.02; range delta 0.298751 > 0.02; ratio 8.663430 > 1; no three-pass streak |

## Mandatory answers

1. **Did sensitivity fall with more postflop iterations?** Partly, but not monotonically.
2. **How much?** At ε=1e-3, reach-weighted derivative fell from 34.980215 at 50 to a minimum 8.555679 at 1,000 (75.54% reduction), then rose to 23.297251 at 5,000; the 50→5,000 reduction was 33.40%.
3. **Did it fall when exploitability was controlled?** No reliable monotonic fall: matched target 0.05 gave weighted derivative 8.555679, while target 0.02 gave 23.297251. Targets 0.01 and 0.005 were not reached by 10,000.
4. **Were giant derivatives only in low-reach states?** No. Near-zero states exist, but reach-weighted derivatives remained material (up to 23.297251 in the matched 0.02 solve).
5. **Did normalization amplify?** The declared directional epsilon becomes L1 probability movement 2ε, hence the internal normalization factor is exactly ~2 by construction; this is expected geometry, not the main pathology.
6. **Did conditional Bayes amplify?** Yes, direction-dependently: factor 0.148292 to 1.739650.
7. **Did representative-card abstraction introduce relevant error?** Yes: in the controlled microgame R↔X pair-utility L2 error was 1.329436. This does not prove it caused Gate D.
8. **Was Expected-bucket closer to Exact?** Unresolved. E missed the common quality gate: exploitability 0.054667 at 5,000 versus the 0.02 threshold.
9. **How far was R from X?** Equal-iteration pair-utility L2 1.329436; fixed-quality common-action reach-weighted EV error 0.525854 across 76 comparable actions.
10. **How far was E from X?** Equal-iteration pair-utility L2 2.059355, but E had poor quality. Only 4 identical actions were comparable; reach-weighted EV error 0.455544.
11. **Which had lower sensitivity?** At 250 equal iterations: X 0.361152, R 0.524879, E 24.677395. X was lowest; E is confounded by non-convergence.
12. **R LocalResponseRatio?** mean 0.539251, median 0.000000, p90 2.014120, max 4.686130.
13. **E LocalResponseRatio?** Unavailable: C-E failed its inner quality gate on outer iteration 1.
14. **X LocalResponseRatio?** mean 5.001366, median 0.000000, p90 25.543537, max 34.249851.
15. **Does the operator look locally contractive?** No. Nine range directions had ratio min 27.632085, median 35.703395, max 45.062760; the full confirmatory run ended at 8.663430.
16. **Best alpha?** 0.15 by the predeclared short-screen raw-residual ranking. It still failed Gate D.
17. **Did tiny alpha create false apparent convergence?** Yes: α=0.001 produced damped delta 0.004784 while normalized raw residual stayed 0.881776. Gate D correctly rejected it.
18. **Did raw residual fall?** It reached 0.103773 at outer 25, above 0.02, then the resumed run failed inner quality at outer 32 with 0.227703.
19. **Did Anderson help?** No. Corrected safeguarded Anderson ended at 0.282606 versus plain damping 0.103773.
20. **Were accelerated steps rejected?** Yes, 2; fallback restored the damped baseline.
21. **Did different initial states converge together?** No. Final continuation L2 distances ranged 1.708045–3.068916; two runs failed inner quality.
22. **Did Gate D pass?** No.
23. **Do A/B/C still pass?** Yes, all revalidated.
24. **How many tests pass?** 118/118, plus production build.
25. **Does Verified remain zero?** Yes.
26. **Can we recommend Phase 7?** No.
27. **Exact blocker?** The full C-R map retains normalized raw residual above threshold, LocalResponseRatio >1, range instability, and eventually loses the inner quality gate. Full C-E is over the 2M node cap; micro E also fails quality.
28. **Is outer coupling still defensible?** As an Experimental diagnostic baseline only, not as a reliable production solver architecture.
29. **Should future work consider unified solving?** Yes. H5 is supported; a unified coupled game, or a mathematically stronger root-finding method over a deterministic high-quality operator, should be evaluated before product expansion.

## Validation and release

Production build passed. All 118 tests passed. Checkpoint V2 continuous/resumed semantic hashes match (bf9aaf148a9bd648); only runtimeMs is excluded. Trust remains **Experimental**, Verified = 0, and no product surface was expanded.
