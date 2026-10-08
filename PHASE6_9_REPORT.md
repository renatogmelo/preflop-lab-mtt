# Phase 6.9 Report — Compact Game Tree

Version 0.9.0 was implemented from baseline `8f0eaa0c932e5a1db43068c760ef57012c771e8c`. The primary artifact is `solver/artifacts/phase6-9-compact-tree-v0.9.0.json` (semantic hash `49f4404427892c18`). Trust remains **Experimental**, Verified remains **0**, and historical Gate D remains **FAIL**.

## Outcome

The double-materialized path was replaced for synthetic research games by a direct `SyntheticGameConfiguration → CompactGameProvider → CompactIndexedTree` path. It supports exact chance enumeration, stable numeric infosets, Vanilla CFR/CFR+/DCFR, iterative EV, Best Response V2, and Checkpoint V4.

At S4, compact topology uses 28.50 B/node instead of 40.00 B/node for Phase 6.8 indexed topology. Including removed object graphs, resident logical storage fell by 95.15%. The compact S4 pipeline was 1.90x faster than indexed eager, and exact evaluation/BR was 12.53x faster than legacy.

A/B/C differential tests passed S0–S4 at `1e-12`. Checkpoint/resume was bit-identical. All gates M1–M7 passed. S5 was safely blocked because 2,097,149 nodes exceed the unchanged 250,000-node budget; no resource limit was raised.

## Mandatory answers

1. Yes, double materialization was eliminated in the new direct compact path.
2. A generic numeric provider, direct typed-array topology, compact CFR, iterative evaluation/BR V2, and Checkpoint V4 were implemented.
3. Successor generation and explicit-stack EV are genuinely lazy; repeated exact CFR is compact/eager because it visits the full tree.
4. S4 topology plus registry costs 28.50 B/node; raw node fields are 28 B/node.
5. S4 estimated resident logical storage fell 95.15%; compact versus Phase 6.8 indexed topology alone fell 28.75%.
6. S4 construction was 1.67x faster than B.
7. S4 traversal was 4.32x faster than B.
8. S4 exact evaluation/BR was 12.53x faster than A.
9. S4 full pipeline was 1.90x faster than B.
10. No executed scale regressed in traversal or the full measured pipeline. Small-scale gains were modest (S0 pipeline 1.07x), while S4 reached 1.90x.
11. Yes, S0–S4 differential tests passed at `1e-12`.
12. Yes. The six Phase 6.8 metamorphic transformations remain green and compact structural equivalence passed S0–S4.
13. Yes, Checkpoint V4 resume produced identical typed state hashes.
14. Yes for the measured synthetic S4 curve: exploitability fell from 0.325526 to 0.000226; this is not a universal convergence proof.
15. The extended S4 run completed 16 iterations.
16. No. S5 was safely aborted by the unchanged node budget.
17. S4 processed 4,194,208 CFR node visits by iteration 16. S5 processed zero nodes.
18. The largest S4 paired-process samples were 230.71 MB heap and 542.60 MB RSS; they include A/B/C and are not a C-only peak.
19. S4 exploitability at iteration 16 was 0.00022610393414868035.
20. S4 NashConv at iteration 16 was 0.0004522078682973607.
21. For exact typed resident storage, yes: Estimator V2 had 0% logical resident error on executed scales. Peak process estimates remain conservative rather than native-peak measurements.
22. The unchanged node budget blocks S5; JSON checkpoint copies and full-tree exact CFR work remain secondary bottlenecks.
23. M1, M2, M3, M4, M5, M6, and M7 all passed.
24. 168/168 tests passed, together with TypeScript, ESLint, and the production build.
25. Yes. The sequential TypeScript architecture met the phase goals; Rust remains unnecessary now.
26. Next research should test isolated-process peak profiling and a reviewed streaming/decomposition design that can respect a formal resource policy above the current node proxy without weakening memory/runtime limits.
