# Phase 6.9 Scalability

## Executed scale ladder

| Scale | Nodes | Infosets | Status | Differential iterations |
|---|---:|---:|---|---:|
| S0 | 53 | 6 | Completed | 100 |
| S1 | 509 | 42 | Completed | 50 |
| S2 | 8,189 | 682 | Completed | 10 |
| S3 | 32,765 | 2,730 | Completed | 2 |
| S4 | 131,069 | 10,922 | Completed | 1 |
| S5 | 2,097,149 | 174,762 | Safe abort | 0 |

S0–S4 passed structural validation and A/B/C differential comparison. The maximum S4 BR discrepancy was `2.7755575615628914e-17`; all strategy, regret, strategy-sum, EV, exploitability, and NashConv errors otherwise recorded zero at the `1e-12` acceptance tolerance.

## S4 convergence extension

DCFR was extended from the historical two-iteration result to 16 iterations:

| Iteration | Exploitability | NashConv |
|---:|---:|---:|
| 1 | 0.3255263445 | 0.6510526890 |
| 2 | 0.0397833330 | 0.0795666661 |
| 4 | 0.0126000517 | 0.0252001034 |
| 8 | 0.0032215618 | 0.0064431236 |
| 16 | 0.0002261039 | 0.0004522079 |

This is a clear improvement curve for this synthetic instance, not proof of general convergence or a solved poker game.

## S5 decision

S5 was not allocated. Although Estimator V2 projected 169.2 MB and 7.34 seconds, its 2,097,149 nodes exceed the unchanged 250,000-node safety limit. Gate M6 passes because the preflight produced a deterministic, justified safe abort. Overcoming S5 now requires a separately reviewed node-budget policy or a streaming/decomposition architecture; this phase did not silently change the policy.
