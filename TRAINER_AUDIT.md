# Trainer Audit — Phase 2

Audit date: 2026-10-03

## Decision Trainer

- Skill: choose an action inside a complete preflop node while reading position, stack, sizing and prior action.
- Measures: selected-action reference frequency, dominant-action deviation, confidence calibration and EV loss only when the dataset supplies EV.
- Corrections: trust/version badge, three explanation levels, nearby/explorer links, stack/position comparison, boundary handoff and review marking.
- Remaining limitation: modeled frequencies are educational estimates; professional users should enable trusted-only inspection until curated/verified nodes exist.

## Frequency Trainer

- Skill: estimate the complete action distribution rather than memorize one percentage.
- Measures: MAE in percentage points, per-action error, dominant-action accuracy and calibration band.
- Corrections: feedback now distinguishes correct composition from frequency over/underestimation and never labels a close distribution simply “wrong”.
- Remaining limitation: precision is bounded by the current dataset trust.

## Range Trainer

- Skill: construct an entire 169-class range and understand its regions.
- Measures: VPIP, aggressive frequency, missing hands, excess hands, dominant-action errors, mixed-frequency errors, boundary errors and largest deviations.
- Corrections: reference/you comparison, error overlay and clickable hand-level explanation.
- Remaining limitation: the editor records one chosen action per hand; continuous user frequencies are trained in Frequency Trainer.

## Boundary Trainer

- Skill: identify where range structure changes.
- Measures/priority: action switches, neighboring strategy distance, mixed regions, historical errors, high-confidence mistakes, hand importance and EV gap when available.
- Corrections: no longer ranks only hands near 50%; personal history changes the queue.
- Remaining limitation: EV cannot influence modeled nodes because EV is honestly unavailable.

## Mixed Strategy Trainer

- Skill: understand a mixture progressively.
- Measures: recognition (pure/mixed), composition (which actions), then frequency MAE.
- Corrections: replaced the previous frequency-only alias with three explicit stages.
- Remaining limitation: exact percentages should only be treated as exact for verified data.

## Leak Trainer

- Skill: correct repeated statistical patterns, not isolated misses.
- Measures: grouped attempts, accuracy, frequency error, confidence-weighted misconceptions and EV only when present.
- Corrections: evidence labels are `possible`, `likely` and `confirmed`; default minimum sample is four and confirmation requires a materially larger sample.
- Remaining limitation: causal explanations remain hypotheses; the UI describes the observed region rather than claiming psychological cause.

## Custom Sessions

- Skill: focus a study block by stack, position, scenario, difficulty and mixed-only filter.
- Measures: dominant-action accuracy across the chosen queue.
- Corrections: all questions resolve through StrategyRepository and display trust.
- Remaining limitation: full adaptive diversity is implemented in Today's Training V2; custom sessions retain the user's narrow scope by design.

## Cross-trainer conclusions

- Every trainer consumes StrategyRepository.
- Modeled/curated data is never called GTO.
- EV is omitted when unavailable.
- Dataset id/version/node id are retained in each decision.
- Mistakes feed history, mastery, leaks and review.
- The professional study loop is now: Decision → explanation → nearby/evolution → Explore → Boundary → Review → Progress.
