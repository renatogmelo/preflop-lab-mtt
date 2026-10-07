# Phase 6.7 Limitations

- The evidence covers three intentionally small, synthetic, two-player zero-sum games. It does not establish scalability to full poker.
- No poker strategy, range, sizing or training recommendation was generated or modified.
- Normal-form support enumeration grows exponentially and is a reference method only for small games.
- DCFR convergence is empirical at finite budgets; exploitability is small but not mathematically zero for the unified finite solves.
- The decomposed operator uses 250-iteration inner solves. Its residual combines architectural inconsistency with remaining finite inner-solve error.
- The directional sensitivity perturbation used in the artifact returned zero on the chosen coordinate for these finite maps; this does not override trajectory LocalResponseRatios above one or establish global contraction.
- Strategy distance can remain large when a game has multiple equilibria, as observed in Coupled Decision Game. Exploitability and NashConv are the relevant equilibrium metrics.
- Process heap snapshots are coarse and affected by garbage collection; they are not retained-object profiles.
- There is no external solver comparison or independent human review.
- All research output remains Experimental. Verified datasets remain zero.
- Historical Gate D remains FAIL. U1-U5 are research gates and neither replace nor approve Gate D.
- The work does not authorize Phase 7 or 8-max expansion.
