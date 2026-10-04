# Phase 6 Performance

Measured on 2026-10-04. All values are observations on one machine, not CI pass/fail limits or production guarantees.

## Environment

- Node.js: v24.20.0
- Platform: Windows
- CPU: Intel Core i5-2400 @ 3.10 GHz; 4 logical cores
- Memory: 16,051,453,952 bytes
- Runtime: TypeScript, IEEE-754 f64, single-threaded
- Reference: 46 private deals, 11,179 nodes, 2,032 infosets

## Changes

The Phase 6 fast path does not alter the game or formulas:

1. the game is compiled once into indexed nodes;
2. regrets and strategy sums use `Float64Array` storage;
3. the two-action traversal avoids per-node allocations;
4. exact EV, best response, reach and counterfactual diagnostics traverse the compiled tree;
5. postflop pair utilities are read from root chance branches instead of rebuilding 46 singleton trees;
6. exact equity results and five-card index combinations are cached;
7. checkpoints serialize all regret/strategy state and resume deterministically.

The object-tree implementation remains the differential oracle. At 500 iterations, indexed and object solvers produced exactly equal average strategies and infoset checkpoint state.

## Measured throughput

| Engine | Iterations | Iterations/s | Runtime | Exploitability |
|---|---:|---:|---:|---:|
| Object-tree DCFR | 1,000 | 61.66 | 16.519 s | 0.024914 |
| Indexed-tree DCFR | 2,500 | 610.18 | 4.474 s | 0.016319 |

Normalized traversal throughput speedup: **9.90x**. The Phase 5 20-iteration solve took 4.757 s; the Phase 6 indexed 20-iteration checkpoint took about 0.082 s in the baseline DCFR run, a measured wall-clock ratio of **57.70x**. The larger figure includes eliminated compile/rebuild overhead and must not be read as pure traversal speedup.

## Profile of the selected 5,000-iteration run

| Phase | Time | Share |
|---|---:|---:|
| Tree compilation, chance/board setup, hand evaluation | 874.91 ms | 10.00% |
| CFR traversal, regret matching, infoset lookup | 7,479.12 ms | 85.50% |
| Strategy evaluation | 31.62 ms | 0.36% |
| Compiled best response | 201.56 ms | 2.30% |
| Reach and counterfactual diagnostics | 125.86 ms | 1.44% |
| Serialization | 26.10 ms | 0.30% |
| Hashing/cache identity | 8.17 ms | 0.09% |

Measured total for profiled groups: 8.747 s. Traversal is now the dominant hot path; the former dynamic best-response path is no longer dominant.

## Focused microbenchmarks

| Operation | Before/cold | After/warm | Ratio |
|---|---:|---:|---:|
| Best response | 4,144.53 ms dynamic | 35.30 ms compiled | 117.40x |
| Equity, 46 pairs | 8,529.51 ms cold | 0.316 ms cached | 27,026x |
| 2,000 seven-card evaluations | 193.96 ms reference | 167.11 ms cached-combination evaluator | 1.16x |

The equity cache ratio measures repeated identical requests and is not a claim about cold equity performance. Cache metrics were 46 misses followed by 46 hits.

## Memory and scale

The final point reported 154.5 MB heap used and a 30.5 MB positive interval delta. The experiment visited 111,790,000 nodes. No memory stop was triggered. Runtime and heap gates are explicit in the convergence harness.

## Rust decision

Rust is not required for the current frozen game. TypeScript achieved ~610-669 indexed iterations/s, a full 5,000-iteration solve in 7.87 s, and complete Phase 6 in 460.96 s. A native port would currently add a second correctness surface before seed and coupling instability are solved.

Reconsider a native traversal core only after a declared scale gate (more boards/ranges/actions) demonstrates that indexed traversal, already 85.5% of measured time, prevents the required research iteration rate. Preserve the object-tree oracle, artifact schema and differential tests if that gate is reached.

## Benchmark policy

Performance values are baselines, not brittle CI assertions. CI checks structural invariants and deterministic strategic outputs. Use `npm run solver:phase6` for a full remeasurement and compare its source commit, environment and reference hash.