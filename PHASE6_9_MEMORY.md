# Phase 6.9 Memory Results

Measurements were produced in the same Phase 6.9 benchmark process. `process.memoryUsage()` samples record heap used, heap total, array buffers, external memory, and RSS; they are checkpoints, not native peaks.

## S4 logical storage

| Item | Phase 6.8 eager | Phase 6.9 compact |
|---|---:|---:|
| Nodes | 131,069 | 131,069 |
| Indexed topology | 5,242,748 B | 3,669,932 B |
| Topology bytes/node | 40.00 | 28.50 |
| Compact infoset registry | — | 65,536 B |
| Regrets + strategy sums | — | 349,504 B |
| Total compact resident logical bytes | — | 4,084,972 B |
| Estimated old combined resident structures | 84,233,538 B | — |

Direct compact storage reduced the estimated resident logical footprint by 95.15%. The compact topology itself is 28 bytes per node plus the amortized numeric infoset registry, producing 28.50 B/node at S4. Compared only with Phase 6.8 indexed topology, the reduction is 28.75%.

The highest S4 same-process sample was 230,714,320 bytes heap used and 542,601,216 bytes RSS. This sample includes retained A/B/C comparison structures and therefore is not attributable to C alone. The artifact keeps both logical storage and process samples separate.

## Estimator V2

Estimator V2 accounts for topology, registry, solver state, compilation validation bytes, evaluation buffers, and a fixed 64 MiB process allowance. For S5 it predicts:

- resident logical bytes: 65,361,132;
- estimated peak: 169,170,096 bytes;
- estimated full validation: 7,340 ms;
- nodes: 2,097,149.

Memory and runtime projections fit their unchanged limits, but the unchanged 250,000-node budget rejects S5. The run was safely aborted before allocation.

## Checkpoints

At S4, Checkpoint V4 serialized to 927,390 bytes in 7.97 ms, versus about 2.39 MB and 15.65 ms for legacy/indexed checkpoints. JSON still creates a temporary full copy and is a remaining optimization target.
