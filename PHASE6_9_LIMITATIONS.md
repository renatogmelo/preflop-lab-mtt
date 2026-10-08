# Phase 6.9 Limitations

- The games are synthetic engineering oracles. They do not validate or alter poker ranges, actions, or recommendations.
- S5 was not executed because the unchanged node budget rejected it, despite improved memory and runtime estimates.
- Memory samples are explicit `process.memoryUsage()` checkpoints, not native continuously sampled peak measurements.
- A/B/C coexist in the comparison process, so process RSS cannot be attributed to C; logical typed-buffer accounting is exact and reported separately.
- Lazy traversal does not reduce the full-tree work required by exact CFR.
- Checkpoint V4 JSON serialization still duplicates numeric state temporarily.
- Stable numeric infoset IDs currently target the regular synthetic family; additional game providers require their own stable semantic registry.
- Only sequential execution was studied. Parallelism was intentionally excluded.
- S4's 16-iteration curve is encouraging but does not prove equilibrium convergence in general.
- Historical Gate D remains FAIL. No dataset was promoted to Verified; Verified remains zero.
