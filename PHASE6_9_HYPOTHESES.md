# Phase 6.9 Hypothesis Verdicts

## H1 — Double Materialization: Supported

The old path retained declarative nodes, compiled objects, temporary indexed nodes, and final arrays. Direct compilation removes those intermediate graphs. At S4, compact resident logical storage was 4.08 MB versus an 84.23 MB combined eager estimate, a 95.15% reduction.

## H2 — Object Overhead: Supported

Typed compact topology uses 28.50 B/node at S4 versus 40.00 B/node for the already-indexed Phase 6.8 topology, before counting the declarative and compiled JavaScript object graphs.

## H3 — Eager Expansion: Partially supported

Lazy successors and an O(depth) explicit-stack EV traversal work correctly. Exact CFR still visits every logical node, so compact eager topology is retained for repeated iterations. The benefit is primarily memory locality and construction cost, not reduced mathematical complexity.

## H4 — Evaluation Overhead: Supported

BR V2 eliminated recursive Map-based grouping and repeated subtree evaluation. S4 exact evaluation/BR fell from 258.76 ms for legacy to 20.66 ms for compact, a 12.53x speedup.

## H5 — Checkpoint Overhead: Partially supported

Runtime state remains in two typed buffers and Checkpoint V4 is generated only on demand. S4 checkpoint size fell from about 2.39 MB to 0.93 MB. Explicit JSON serialization still creates a proportional temporary copy, so the hypothesis is not fully resolved.
