# Phase 6.9 Performance

All values below are paired S4 measurements from the same benchmark execution. S4 has 131,069 nodes and 10,922 information sets.

| Metric | A Legacy | B Indexed eager | C Compact | Gain |
|---|---:|---:|---:|---:|
| Construction | 1,275.83 ms | 1,404.68 ms | 842.85 ms | C is 1.67x faster than B |
| One DCFR iteration | 249.38 ms | 60.15 ms | 13.92 ms | C is 4.32x faster than B |
| Exact evaluation/BR | 258.76 ms | 203.05 ms | 20.66 ms | C is 12.53x faster than A |
| Full measured pipeline | 1,783.98 ms | 1,667.88 ms | 877.42 ms | C is 1.90x faster than B |

The compact evaluator's large BR gain comes from flat reverse passes and a single per-infoset policy rather than Maps plus recursive subtree re-evaluation. This is an algorithmic implementation gain while preserving the same exact BR definition.

Across S0-S4, B-to-C traversal speed ranged from 1.05x to 4.32x. Every executed scale improved both traversal and the full measured pipeline; full-pipeline speedup ranged from 1.07x to 1.90x.

No parallelism, sampling, heuristic pruning, or Rust code was introduced. Reverse-level array processing already acts as deterministic batching for terminal, chance, strategy-EV, and BR calculations; a separate batching abstraction was not justified.
