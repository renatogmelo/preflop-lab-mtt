# Phase 6.6 — Board Abstraction Laboratory

## Scope

This is a controlled microgame, not the reference game: two private combos per player, flop/turn/river and physical card removal preserved, with strategic river decisions and a narrowed earlier-street betting tree. The official reference game was not changed.

| model | continuation model | nodes | infosets | 250-it exploitability | RW sensitivity |
|---|---|---:|---:|---:|---:|
| R | representative-bucket | 181 | 44 | 0.021536 | 0.524879 |
| E | expected-bucket | 71833 | 44 | 0.195218 | 24.677395 |
| X | exact-future | 71833 | 17424 | 0.017620 | 0.361152 |

E and X enumerate every legal physical future card with exact conditional probability. E exposes deterministic bucket observations; X exposes physical runouts. R materializes only a representative branch. Bucket membership is stable under permutation.

## Fixed-quality result

| model | provider | gate | iterations | exploitability | NashConv | RW movement |
|---|---|---|---:|---:|---:|---:|
| R | representative-bucket | PASS | 500 | 0.013727 | 0.027453 | 0.001302 |
| E | expected-bucket | FAIL | 5000 | 0.054667 | 0.109335 | 0.003111 |
| X | exact-future | PASS | 500 | 0.011882 | 0.023765 | 0.001020 |

R and X reached the common 0.02/0.02 gate at 500 iterations. E did not: exploitability was 0.054667 at 5,000. Therefore **Expected≈Exact is not established** and H2 is unresolved. Equal-iteration E errors cannot be separated from finite-solve error.

Only identical infoset/action keys are used for per-action comparison. R↔X has 76 common actions and reach-weighted EV error 0.525854. E↔X has only 4 common actions and reach-weighted EV error 0.455544; this is insufficient for promotion.

## Full-tree cap

The frozen full Expected/Exact topology projects 5,533,605 nodes, above the 2,000,000 cap. This is primarily a cost of eager materialization/topology. It is not proof that exact enumeration is mathematically impossible. Lazy/streaming traversal, shared topology and subtree reuse require profiling in a future research phase; no cap increase or Rust migration occurred.
