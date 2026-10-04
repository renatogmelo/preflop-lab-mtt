# Preflop Lab Solver 0.3.0

Independent mathematical and engineering core for reproducible game solves. It is not coupled to React or the training UI.

## Commands

```text
npm run solver -- solve solver/configs/kuhn-dcfr.json
npm run solver -- solve solver/configs/holdem-poc.json
npm run solver -- inspect <artifact.json>
npm run solver -- validate <artifact.json>
npm run solver -- reproduce <artifact.json>
npm run solver -- resume <checkpoint.json> <target-iterations> <output.json>
npm run solver -- benchmark 20000
npm run solver:phase4
npm run solver:phase5
```

`resume` is exposed by CLI for generic/Kuhn CFR. Hold'em checkpoint/restore is implemented in the programmatic API; its CLI resume still needs config-aware orchestration.

## Trust

Solver output is not automatically trustworthy. Version 0.3.0 adds weighted private ranges, exact reduced-game best-response evaluation, native three-street postflop subgames and an iterative preflop/postflop coupling pipeline. The Phase 5 dataset remains `Experimental`: the reference postflop solve and outer coupling loop did not converge to the thresholds required for `Verified`.

See `SOLVER_ARCHITECTURE.md`, `SOLVER_MATH.md`, `SOLVER_VALIDATION.md`, `CONTINUATION_VALUES.md`, `POSTFLOP_ABSTRACTION.md`, `PHASE5_REPORT.md` and `VERIFIED_POLICY.md`.
