# Solver tests

The executable solver regression suite lives in `tests/solver.test.mjs` so it runs with the product's existing Node test command. It covers known-solution Kuhn convergence, exact best response, NashConv/exploitability, differential algorithms, checkpoint integrity, the 52-card/combo engine, weighted range card removal, no-limit betting and the Experimental Hold'em export.

The Hold'em proof of concept is intentionally tested for structural integrity and reproducibility, not for GTO correctness. Its Level 0 continuation model makes it ineligible for `Verified`.
