# Phase 6.6 — Fixed-point Operator and Gate D v2

## Definition

For the valid vector components, `R(S)=F(S)-S`. Reported norms are L1, L2, L∞ and reach-weighted. The gate uses normalized utility residual `||R||₂ / max(1, ||S||₂, ||F(S)||₂)`. LocalResponseRatio is `||F(S+δ)-F(S)||₂ / ||δ||₂`; it is a finite diagnostic, not a contraction proof.

## Predeclared Gate D v2

Preflop RW ≤0.02; range L1 ≤0.02; normalized raw continuation residual ≤0.02; damped continuation delta ≤0.02; postflop RW ≤0.02; LocalResponseRatio ≤1; inner quality PASS; three consecutive passes.

## Damping screening

| α | iterations | stop | normalized raw residual | damped Δ | range Δ | ratio |
|---:|---:|---|---:|---:|---:|---:|
| 0.010 | 10 | iterations | 0.797696 | 0.047342 | 0.000000 | 0.000000 |
| 0.025 | 10 | iterations | 0.699725 | 0.095249 | 0.037404 | 17.007685 |
| 0.050 | 10 | iterations | 0.689479 | 0.160649 | 0.210526 | 20.405825 |
| 0.075 | 10 | iterations | 0.462901 | 0.209125 | 0.070223 | 1.045360 |
| 0.100 | 10 | iterations | 0.395431 | 0.223784 | 0.362331 | 11.734393 |
| 0.150 | 10 | iterations | 0.323343 | 0.255334 | 0.583809 | 5.880240 |
| 0.200 | 3 | inner-quality-failed | 0.700994 | 0.638468 | 0.350006 | 4.752145 |
| 0.250 | 8 | inner-quality-failed | 0.418711 | 0.644532 | 0.677142 | 5.142922 |

Alpha 0.15 had the lowest screened raw residual and advanced. At outer 25 it reached raw residual 0.103773, but range delta 0.041403 and ratio 4.368121 still failed. Resume then hit inner-quality-failed at outer 32; 100 and 200 were skipped under the predeclared stop rule.

## False convergence, methods and initialization

At α=0.001, damped delta was 0.004784 while raw residual was 0.881776. The raw gate prevented false convergence.

Plain damping ended at raw 0.103773. Adaptive damping shrank α to 0.012 but raw residual remained 0.370046. Corrected safeguarded Anderson rejected 2 steps, restored the damped fallback, and ended at 0.282606. It did not help.

| initialization | iterations | stop | raw residual | preflop RW | range L1 | ratio |
|---|---:|---|---:|---:|---:|---:|
| equity | 25 | iterations | 0.103773 | 0.017077 | 0.041403 | 4.368121 |
| neutral-zero | 25 | iterations | 0.229221 | 0.147006 | 0.414934 | 5.679833 |
| phase6-5 | 11 | inner-quality-failed | 0.152811 | 0.076719 | 0.171787 | 5.391414 |
| frozen-range-solved | 14 | inner-quality-failed | 0.394584 | 0.061671 | 0.202224 | 10.010281 |

Final points are path-dependent: continuation L2 pair distances are 1.708045–3.068916. Gate D v2 FAILS.

Checkpoint schema 2 preserves state, previous map/input, strategies, residual and quality history, acceleration state and rejected steps. Continuous and resumed semantic hashes are identical (bf9aaf148a9bd648); runtimeMs is explicitly excluded.
