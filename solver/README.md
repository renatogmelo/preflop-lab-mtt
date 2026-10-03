# Preflop Lab Solver 0.1.0

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
```

`resume` is exposed by CLI for generic/Kuhn CFR. Hold'em checkpoint/restore is implemented in the programmatic API; its CLI resume still needs config-aware orchestration.

## Trust

Solver output is not automatically trustworthy. The bundled Hold'em POC is `Experimental`, excluded from default repository resolution and ineligible for `Verified` because it uses a Level 0 continuation approximation and has no valid Hold'em exploitability calculation.

See `SOLVER_ARCHITECTURE.md`, `SOLVER_MATH.md`, `SOLVER_VALIDATION.md`, `CONTINUATION_VALUES.md` and `VERIFIED_POLICY.md`.
