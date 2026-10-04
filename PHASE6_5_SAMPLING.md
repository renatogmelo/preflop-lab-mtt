# Phase 6.5 Sampling

Status: **Experimental**. `Verified = 0`.

## Randomness contract

Every stochastic subsystem derives a stream from `masterSeed + subsystemId`. The ledger stores subsystem, derived seed, stream ID, sample count and purpose. The solver contains no `Math.random` calls. Equity runout sampling also reports ledger entries; exact equity creates no draws.

## Traversal modes

- **Exact:** all 46 weighted private deals every CFR iteration; seed is provenance only.
- **IID:** inverse-CDF draws from the natural deal distribution; proposal equals target and importance weight is 1.
- **Fixed CRN:** the same deterministic IID schedule can be reused across provider comparisons.
- **Stratified:** one jittered point per unit stratum, followed by deterministic Fisher–Yates interleaving; empirical proposal weights are corrected by `target / proposal`.
- **Quasi-deterministic:** base-2 radical-inverse sequence; deterministic, interleaved and importance-weighted by empirical proposal allocation.

An initial experiment exposed an invalid temporal ordering in stratified/quasi schedules: ascending quantiles produced long deal blocks and distance near `0.88`. That provisional output was discarded. Commit `033aa308...` interleaves schedules, and the entire matrix was rerun.

## Five-seed matrix at 5,000 samples

| Mode | Mean distance to exact | Std. dev. | Unique strategy hashes |
|---|---:|---:|---:|
| IID | 0.163037 | 0.062381 | 5 |
| Fixed CRN | 0.163358 | 0.024482 | 5 |
| Stratified | 0.147677 | 0.044418 | 5 |
| Quasi-deterministic | 0.063091 | 0 | 1 |
| Exact | 0 | 0 | 1 |

Quasi-deterministic won this finite-budget comparison. It is not “more GTO” by label; it simply approached the exact same-algorithm oracle more closely in the frozen game.

## Seed 19 at 10,000 samples

| Mode | Strategy distance | Conditional-range L1 | Covered target mass | Empirical chance L1 |
|---|---:|---:|---:|---:|
| IID | 0.130130 | 0.150094 | 1.0 | 0.046382 |
| Fixed CRN | 0.152813 | 0.159222 | 1.0 | 0.049125 |
| Stratified | 0.164869 | 0.178529 | 1.0 | 0.002320 |
| Quasi-deterministic | 0.046900 | 0.062100 | 1.0 | 0.003318 |

Lower chance-distribution L1 did not guarantee lower strategy error: regret learning is path-dependent at finite budgets. Coverage, importance weighting, strategy distance, exact EV, exploitability/NashConv and conditional-range distance are all therefore retained in the artifact.

## Differential interpretation

Exact and sampled strategies are not expected to be equal at finite budgets. The oracle uses the same vanilla-CFR family for the sampled-limit comparison and DCFR `2/0/3` for the official deterministic provider study. The artifact never treats a sampled schedule as poker truth.