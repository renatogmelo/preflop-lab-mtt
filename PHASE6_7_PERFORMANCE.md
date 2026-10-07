# Phase 6.7 Performance

Performance is secondary to correctness in this phase. Measurements below are machine observations from the final artifact, not portable guarantees.

## Unified 10,000-iteration runs

| Game | Tree nodes | Infosets | Runtime | ms/iteration | Nodes visited | Exact evaluation |
|---|---:|---:|---:|---:|---:|---:|
| Sequential Hidden Choice | 11 | 3 | 128.304 ms | 0.012830 | 220,000 | 0.252 ms |
| Public Signal Game | 19 | 4 | 177.622 ms | 0.017762 | 380,000 | 0.130 ms |
| Coupled Decision Game | 31 | 6 | 318.270 ms | 0.031827 | 620,000 | 0.131 ms |

The final process heap snapshots were approximately `12.2 MB`, `14.5 MB` and `13.4 MB`. Heap deltas are also stored, but can be negative because garbage collection is process-global; the absolute before/after snapshots are the auditable memory measurements.

## Cost interpretation

Runtime grows with full-tree node visits, as expected. Exact best-response evaluation is negligible at this scale. Decomposition is not directly faster here: each outer step executes two finite inner solves and acceleration may require a third operator evaluation. The artifact records runtime and visited nodes for every method.

No Rust migration is justified. TypeScript solves the largest reference game for 10,000 iterations in well under one second on the recorded machine. Scaling to large games would first require abstraction and memory profiling evidence, not a language change by assumption.
