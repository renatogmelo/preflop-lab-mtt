# Phase 6.6 — Performance and Resource Safety

The full benchmark took 43.54 minutes on 4 logical CPUs with 14.95 GiB reported memory. It covered 28 fixed-iteration sensitivity points, four fixed-quality targets, nine deterministic directions, R/E/X microgames, eight damping alphas, confirmatory coupling, three methods, four initializations, micro coupling, tiny-alpha and checkpoint resume.

The full future-card topology remains capped: 5,533,605 projected nodes > 2,000,000. No silent cap increase occurred. The controlled E/X microgame used 71,833 nodes; R used 181.

The 5.5M projection is not a fundamental mathematical limit. It is evidence that eager materialization is unsuitable at this scale in the current TypeScript pipeline. Candidate investigations are streaming chance expansion, lazy nodes, shared compiled topology, dynamic programming and subtree reuse. A large refactor requires profiling first. Rust migration remains deferred.

Production build and 118 tests passed. The 13.5 MB primary artifact and golden file retain configurations, hashes, failures and trajectories. Verified remains 0.
