# Phase 6.9 Compact Architecture

Research Solver 0.9.0 introduces `CompactExtensiveGame`, `CompactGameProvider`, `SyntheticCompactProvider`, `CompactIndexedTree`, `CompactCfrSolver`, and `CompactBestResponseEvaluatorV2`.

## Separation of concerns

- Logical definition: the immutable synthetic configuration.
- State identity: stable BFS ordinals represented by numbers.
- Successors: generated arithmetically on demand by the provider.
- Topology: typed arrays compiled directly from the provider.
- Information sets: stable numeric IDs derived from stage, own private state, and public history only.
- Solver state: independent `Float64Array` regrets and strategy sums.
- Evaluation: reverse-level iterative strategy EV and BR V2.
- Persistence: versioned Checkpoint V4 with semantic state hash.

## Exactness and privacy

Chance is enumerated exactly; no sampling or heuristic pruning was introduced. The information-set registry never incorporates the opponent private state. All nodes in an infoset share the same action count, and compilation rejects inconsistencies, multiple parents, invalid forward indices, chance normalization errors, non-finite terminal values, or unreachable nodes.

## Lazy versus compiled

The provider and `CompactExtensiveGame.walkLazy` genuinely generate successors only when requested and `evaluateLazyStrategy` uses an explicit O(depth) stack. The CFR engine is compact/eager after direct compilation because exact CFR traverses every node. Calling the whole solver “fully lazy” would be inaccurate.

## Traversal

- Lazy EV: explicit typed stack; no recursion or topology materialization.
- CFR: deterministic depth-first traversal over compact contiguous children.
- Strategy EV and BR: iterative reverse-level passes.
- BR policy: one action per numeric infoset, never one action per node.

All three algorithms remain supported: Vanilla CFR, CFR+, and DCFR.
