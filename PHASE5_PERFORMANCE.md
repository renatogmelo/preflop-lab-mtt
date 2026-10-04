# Phase 5 Performance

Measured on 2026-10-03. Numbers are observations on this machine, not guarantees.

## Environment

- Node.js: v24.20.0
- Platform: Windows x64
- CPU: Intel Core i5-2400 @ 3.10 GHz
- Logical cores: 4
- Memory: 16,051,453,952 bytes
- Solver: TypeScript/f64, single-threaded

## Reference weighted-range subgame

- Compatible private deals: 46
- Tree nodes: 11,179
- Action nodes: 5,704
- Chance nodes: 967
- Terminal nodes: 4,508
- Information sets: 2,032
- Maximum depth: 11
- DCFR iterations: 20
- Solve time: 4,757 ms
- Throughput: 4.20 iterations/s
- Approximate heap increase: 17,252,880 bytes
- NashConv: 0.541129
- Exploitability: 0.270565
- Strategy delta: 1.0

## Preflop comparison

Each provider used three seeds and 4,000 sampled training iterations. Final strategy evaluation enumerated all 46 compatible private deals.

| Provider | Mean solve + evaluation | Mean exact evaluation | Mean exploitability |
|---|---:|---:|---:|
| Strength proxy | 1,562 ms | 44 ms | 0.002270 |
| Exact equity | 14,105 ms | 6,312 ms | 0.001664 |
| Solved continuation table | 1,540 ms | 39 ms | 0.024244 |

Equity is slow because exact turn/river enumeration is repeated for each unique continuation request. Memoization limited calls to unique request identities, but hand evaluation remains the dominant path.

## Coupling

- Outer iterations: 3
- Damping alpha: 0.6
- Iteration runtimes: 8,171 ms; 8,051 ms; 8,312 ms
- Cache: 0 hits, 3 misses, because each outer iteration produced strategically different conditional ranges.
- Final preflop strategy delta: 0.511634
- Final conditional-range L1 delta: 0.596181
- Final continuation utility delta: 1.225452
- Converged: no

## Profiling finding

The first configuration used two flop and two river sizes with three future-board outcomes. It did not complete within three minutes on the reference machine and was stopped. Reducing the main experiment to one size per street and two board buckets produced a complete 94,661 ms run.

The observed bottleneck is combinatorial tree expansion plus exact BR evaluation, not evidence that a native rewrite is already required. The next optimization should reuse compiled pair trees, batch exact equity and profile information-set aggregation before considering Rust.
