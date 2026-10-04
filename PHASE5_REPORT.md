# Phase 5 Report - Strategic Continuation and Coupling

Status: completed as an Experimental research milestone. Verified remains zero.

## Executive answer

The reduced solver did transform postflop model changes into measurable preflop strategy changes. However, the solved-continuation runs had substantial seed variance, the postflop solve was not sufficiently converged, and the outer coupling loop did not converge. Therefore the experiment proves the pipeline and detects sensitivity; it does not yet establish reliable professional ranges.

## 1. Files and architecture

New core modules:

- solver/cards/private-chance.ts
- solver/evaluation/holdem-preflop.ts
- solver/ranges/conditional.ts
- solver/game/range-postflop-subgame.ts
- solver/comparison/strategy-distance.ts
- solver/continuation/cache.ts
- solver/coupling/engine.ts
- solver/benchmarks/phase5.ts

New evidence:

- solver/artifacts/phase5-strategic-coupling-v0.3.0.json
- datasets/solver-experimental/preflop-lab-solver-experimental-v0.3.0.json
- tests/golden/phase5-v0.3.0.json
- POSTFLOP_ABSTRACTION.md
- PHASE5_PERFORMANCE.md

Training traversal remains chance-sampled. Evaluation traversal is a separate exact private-deal game for the reduced weighted ranges.

## 2. Bugs and semantic fixes

- finite CFR is no longer described as strategically exact;
- chance resolution and strategic solution quality are separate fields;
- Infinity used for missing outer-loop comparisons was replaced by null;
- private chance now normalizes joint combo weights after collisions and board blockers;
- cache identity now includes every declared strategic input;
- V2 can sample from explicit weighted ranges instead of only uniform full-deck combos.

## 3. Hold'em Preflop V2 best response

HoldemPreflopEvaluationGame enumerates all compatible private deals for the reduced game. Generic BR chooses one action per information set and weights states by chance plus opponent reach, excluding own reach.

The evaluation reports strategy EV, both BR values, NashConv, exploitability, information sets, nodes and runtime. In the three-seed comparison, mean exploitability was:

- proxy: 0.002270
- equity: 0.001664
- solved continuation: 0.024244

These metrics apply only to the declared reduced preflop game and the supplied continuation provider.

## 4. Weighted-range postflop

The reference range subgame used seven physical combos per player and produced 46 compatible private deals after collisions and flop blockers.

Tree:

- 11,179 nodes
- 2,032 information sets
- 967 chance nodes
- 4,508 terminals
- flop, turn and river decisions
- exact showdown and tie handling

At 20 DCFR iterations:

- P0 EV: +0.129798
- NashConv: 0.541129
- exploitability: 0.270565
- strategy delta: 1.0

This is structurally valid but not converged enough for professional conclusions.

## 5. Conditional ranges

ConditionalRangeSnapshot is immutable and contains player, public history, board, normalized combo weights, blocked combo count, source solve id, strategy hash and game-definition hash.

The posterior is computed from the full compatible joint deal distribution multiplied by every observed behavioral action probability. This captures Bayes conditioning and blocker correlations rather than filtering 169 hand classes.

## 6. Continuation comparison

All models used the same ranges, fixed flop, stack, actions, seeds and 4,000 training iterations.

Mean range frequencies:

| Provider | SB raise | BB call | P0 strategy EV |
|---|---:|---:|---:|
| Proxy | 84.45% | 78.17% | +0.135006 |
| Equity | 99.79% | 62.55% | +0.241463 |
| Solved | 60.37% | 34.07% | +0.093423 |

Strategy weighted mean absolute distance:

- proxy vs equity: 0.794812
- proxy vs solved: 1.091453
- equity vs solved: 0.636867

Largest equity-vs-solved shifts included T9s BB call (99.81% to 6.10%), QQ SB raise (99.77% to 9.96%), AKs SB raise (99.87% to 33.90%), JJ BB call (99.76% to 36.84%) and AKo SB raise (99.91% to 48.55%).

Those magnitudes are not treated as poker truth because the solved provider's postflop convergence is weak.

## 7. Multiple seeds

Pairwise within-provider weighted strategy-distance mean:

- proxy: 0.151476, range 0.109332 to 0.188546
- equity: 0.016041, range 0.005630 to 0.021415
- solved: 0.203640, range 0.136919 to 0.238416

The solved model's seed variance is material. Claims about individual marginal combos must wait for more iterations and lower postflop exploitability.

## 8. Sampled versus enumerated

Against a 4,000-iteration enumerated Vanilla CFR reference, sampled-training weighted distance was:

- 250 iterations: 0.308649
- 1,000 iterations: 0.311702
- 4,000 iterations: 0.176883

The final distance improved, but finite-iteration progress was not monotonic. This supports the expected direction without proving convergence at the tested budget.

## 9. Coupling and damping

CoupledPreflopPostflopSolver executes:

preflop solve -> joint Bayesian ranges -> postflop solve -> pair continuation values -> damped update -> preflop re-solve.

Damping alpha was 0.6. After three outer iterations:

- preflop strategy delta: 0.511634
- conditional-range delta: 0.596181
- continuation utility delta: 1.225452
- postflop strategy delta: 1.0
- converged: no

This is a negative but useful result. The current inner postflop solves are too noisy for stable fixed-point convergence.

## 10. Cache and quantization

Range weights are quantized at 1e-9. Tests prove hits for identical requests and misses after range, board, pot, stack or abstraction mutation.

The main coupling run had 0 hits and 3 misses because each iteration changed conditional ranges. A separate deterministic test produced a hit when the ranges were unchanged.

## 11. Tests and golden artifacts

Phase 5 adds ten focused tests covering private chance, normalization, board blockers, conditional Bayes ranges, exact preflop BR, information-set consistency, range-vs-range postflop, three-street chance, all-ins, strategy distance, cache identity, continuation semantics, coupling and damping.

The golden file is explicitly a regression baseline for this abstraction, not theoretical poker truth.

## 12. Experimental dataset

Preflop Lab Solver Experimental v0.3.0 contains the mean solved-provider strategy, hashes, methodology, provider distances, seed variance, coupling metrics and limitations. It is not installed into default Trainer resolution and remains Experimental.

## 13. Limitations and blockers for Verified

- reduced HU game, not 8-max;
- one fixed flop;
- two-bucket future-board abstraction;
- no raises in the main experiment;
- postflop exploitability 0.270565;
- material solved-provider seed variance;
- outer loop did not converge;
- per-action preflop counterfactual EV export is missing;
- no full board coverage;
- no independent external solve validation;
- no methodology review or human approval.

## 14. Recommended next experiment

Keep the same 46-deal game. Increase postflop iterations until exploitability is below a predeclared threshold, run at least five seeds, and test damping alpha 0.25, 0.4 and 0.6. Do not add more boards or sizings until seed variance is clearly below the provider-induced strategy distance.
