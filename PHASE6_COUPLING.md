# Phase 6 - Preflop/Postflop Coupling

Status: Experimental. The outer loop did not converge; no coupled output is eligible for Trainer publication.

## Protocol

The frozen game and continuation abstraction are unchanged from Phase 5. Each outer iteration:

1. solves preflop for 10,000 iterations with a fixed seed;
2. derives card-removal-aware conditional ranges;
3. solves the 46-deal postflop subgame for 1,000 indexed DCFR iterations;
4. damps continuation values by alpha;
5. measures preflop strategy, conditional range, continuation utility and postflop strategy deltas;
6. requires all four thresholds (`0.02`) for three consecutive iterations.

The engine also records period-two oscillation, divergence, stop reason, range/cache hashes and continuation probes.

## Damping grid

| Alpha | Outer iterations | Stop | Preflop delta | Range delta | Utility delta | Postflop delta | Diverging |
|---:|---:|---|---:|---:|---:|---:|---|
| 0.25 | 10 | budget | 0.152837 | 0.164987 | 0.356127 | 1.000000 | no |
| 0.40 | 10 | budget | 0.384412 | 0.158117 | 0.840704 | 1.000000 | no |
| 0.60 | 6 | divergence | 0.983709 | 0.371820 | 2.320141 | 1.000000 | yes |
| 1.00 | 4 | divergence | 0.998476 | 0.465613 | 4.383728 | 1.000000 | yes |

No alpha satisfied one convergence pass, let alone the required patience of three. Alpha `0.25` is the best observed configuration because it has the smallest final preflop and continuation-utility movement without triggering divergence. It is not a fixed point.

The period-two detector did not fire (`oscillating=false`) in the final states. This does not mean the loop is stable: alpha 0.6 and 1.0 show growing amplitude and are classified as divergent, while 0.25 and 0.4 remain far outside tolerance after ten iterations.

## Ablations

- Fixed continuation + same seed is exactly reproducible: strategy distance 0.
- Fixed continuation + five seeds retains mean distance 0.126345.
- Frozen postflop range + five seeds yields one strategy hash and zero pairwise distance; the full-tree postflop traversal is deterministic.
- Therefore the major seed noise is in sampled preflop continuation evaluation, while the outer instability is a separate feedback-loop problem.

## Cache identity and quantization

The cache key includes board, pot, stacks, acting player, position, action history, both ranges, betting abstraction and algorithm configuration. Quantization is explicit.

A controlled range perturbation of `4e-9` was intentionally tested:

| Quantization | Same key? | Maximum rounding error per weight |
|---:|---|---:|
| 1e-6 | yes | 5e-7 |
| 1e-8 | yes | 5e-9 |
| 1e-9 | no | 5e-10 |
| 1e-10 | no | 5e-11 |

Selected quantization remains `1e-9`. The measured strategy distance for the controlled perturbation was zero at the tested preflop budget, but the distinct key is retained rather than silently assuming equivalence.

## Diagnosis and next experiment

The evidence points to two coupled causes, not a single math failure:

- sampled preflop evaluation creates material strategy variance for the Solved provider;
- the one-board/two-outcome future-board abstraction produces discontinuous range-to-continuation feedback, and stronger damping reacts by diverging.

Do not loosen thresholds. Before expanding boards or 8-max scope:

1. remove or control preflop sampling variance (common random numbers or exact evaluation in this tiny game);
2. rerun five-seed stability until mean Solved distance is clearly below 0.1;
3. use a continuation mapping with controlled sensitivity and repeat alpha <= 0.25 for more outer iterations;
4. require three consecutive all-metric passes;
5. only then reconsider the Phase 7 scale gate.