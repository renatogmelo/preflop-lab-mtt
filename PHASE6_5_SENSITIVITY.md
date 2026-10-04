# Phase 6.5 Sensitivity

Status: **Experimental**. `Verified = 0`.

## Range → continuation finite differences

The last player-zero range weight was perturbed by epsilons `1e-4`, `1e-3`, `1e-2`, and `5e-2`. Each point reran the same 250-iteration deterministic postflop configuration and compared the complete sorted vector of 46 pair utilities.

| Epsilon | Max absolute derivative |
|---:|---:|
| 0.0001 | 297.913854 |
| 0.001 | 53.726274 |
| 0.01 | 28.905781 |
| 0.05 | 7.048194 |

Derivative slope variation was `261.960593`, so the diagnostic flags a possible artificial discontinuity. This can arise from finite CFR response changes and the representative-card abstraction; it is not evidence of a smooth contraction.

## Bucket stability

`BucketedBoardProvider` now sorts available physical cards by `card.id`, assigns them round-robin to the frozen two buckets and selects each bucket's middle card. All 46 private deals were audited with normal and reverse card order for turn and river outcomes. Mapping hashes matched in every case.

Stable identity removes an implementation-order discontinuity. It does not remove the strategic error created by representing many physical cards with one card.

## Exact future-card ablation

The full exact-board strategic ablation was not executed. Scaling the frozen tree gives a projected `5,533,605` nodes, above the declared single-process safety cap of `2,000,000`. The blocked run is preserved in the manifest rather than silently omitted.

An expectation-over-bucket payoff was also not substituted because it would change the frozen game during a stability phase. Both questions belong to future Board Coverage & Abstraction Validation, but that phase is not recommended until Gate D passes.

## Conclusion

Range→continuation sensitivity is high and epsilon-dependent. This is consistent with the fixed-point failure: small range changes can trigger materially different approximate postflop responses, which feed back into the next preflop strategy.