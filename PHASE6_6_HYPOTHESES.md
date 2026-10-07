# Phase 6.6 — Hypothesis Verdicts

| hypothesis | verdict | evidence |
|---|---|---|
| H1 finite-solve error | **partially supported** | ε=1e-3 weighted derivative fell 34.980215→8.555679 by 1,000, then rose to 23.297251 at 5,000; matched-quality sensitivity remained large. |
| H2 representative card | **unresolved** | R differs from X, but E failed the 0.02 quality gate at 5,000, so Expected≈Exact cannot be evaluated fairly. |
| H3 normalization/posterior | **supported** | normalization L1 factor ~2 by construction; compatible deals ~0.985–1.051; conditional Bayes 0.148–1.740 and joint posterior correlations are now preserved. |
| H4 true strategic sensitivity | **partially supported** | substantial sensitivity remains after matched 0.05 and 0.02 quality, but it cannot yet be cleanly separated from abstraction effects. |
| H5 fixed-point pathology | **supported** | Gate D fails; confirmatory ratio 4.368; nine range directions have ratio 27.632–45.063; multiple initial states remain separated. |

## Architectural conclusion

Finite CFR error matters but is not the sole blocker. Representative-card error is real but not proven causal because Expected-bucket did not converge adequately. The strongest evidence supports an unstable/non-contractive outer operator in this reduced architecture. Future work should first make E computationally/convergently viable or adopt a unified coupled-game formulation; it must not force D through tiny damping.
