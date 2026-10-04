# Phase 6.5 Fixed Point

Status: **Experimental**. `Verified = 0`.

## Map being tested

The outer map is explicitly:

`F(S) = exact preflop solve → conditional Bayesian ranges → solved postflop raw pair utilities → damped utilities → exact preflop solve`.

Raw postflop utilities and damped utilities are different objects in memory and in the artifact. Damping is never reported as if it changed the raw solved response.

## Gate D

Predeclared before the final run:

- preflop reach-weighted strategy delta `<= 0.02`;
- conditional-range L1 delta `<= 0.02`;
- damped continuation-utility delta `<= 0.02`;
- postflop reach-weighted strategy delta `<= 0.02`;
- all four for three consecutive outer iterations.

## Damping screen at iteration 10

| Alpha | Worst residual | Preflop RW | Range L1 | Damped utility | Postflop RW |
|---:|---:|---:|---:|---:|---:|
| 0.05 | 0.129909 | 0.095919 | 0.052723 | 0.129909 | 0.014199 |
| 0.10 | 0.314612 | 0.035035 | 0.301609 | 0.314612 | 0.072565 |
| 0.15 | 0.295538 | 0.077317 | 0.295538 | 0.278991 | 0.078197 |
| 0.20 | 0.476071 | 0.091291 | 0.424696 | 0.476071 | 0.096589 |
| 0.25 | 0.276473 | 0.128454 | 0.273753 | 0.276473 | 0.048276 |
| 0.40 | 0.747132 | 0.290707 | 0.499836 | 0.747132 | 0.087793 |

Alpha `0.05` advanced to confirmatory budgets 25, 50 and 100 because it was best and kept improving without a detected cycle.

## Confirmatory result at 100

Gate D failed:

- preflop max / reach-weighted delta: `0.009863 / 0.001211`;
- range delta: `0.079894`;
- raw / damped continuation delta: `2.660087 / 0.053868`;
- postflop max / reach-weighted delta: `1.0 / 0.044017`;
- consecutive passes: `0`;
- period-2/3 cycle: not detected;
- convergence: false.

The raw strategy maximum of 1.0 is retained but is not used alone as a stopping rule; reach weighting prevents low-reach corners from dominating Gate D.

## Checkpoint and warm start

Continuous outer 20 and `10 → checkpoint → resume 20` produced:

- preflop strategy distance `0`;
- identical damped-utility hash;
- identical metric-trajectory hash after normalizing wall-clock time.

Exact CFR resume is safe when game/provider identity is unchanged. Warm-starting regrets across outer iterations was rejected because the continuation provider changes, so it could introduce path dependence rather than accelerate the same solve.

## Cycles, contraction and acceleration

Period-2 and period-3 approximate-cycle diagnostics were evaluated on the full damped-utility state vector plus strategic residuals. No final cycle was detected. Simple damping remained the official method; Anderson acceleration was not activated because synthetic and production safeguards were not sufficiently justified. Rust migration remains blocked because this small exact preflop solve averages well under one second and is not the scaling bottleneck.