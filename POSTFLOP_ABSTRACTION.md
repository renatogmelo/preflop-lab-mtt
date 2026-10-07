# Postflop Abstraction - Phase 5

Status: Experimental. This document defines the game that was solved; it does not claim full-game GTO Hold'em.

## Strategic scope

- Heads-up Hold'em.
- Fixed flop.
- Weighted physical-combo ranges for both players.
- Private deals use weight(P0 combo) x weight(P1 combo), reject collisions and board blockers, then normalize.
- Flop, turn and river can contain decisions.
- The engine supports check, bet, fold, call, jam and at most one raise per street.
- The main Phase 5 experiment disabled raises and jams to keep the first audit tractable.

## Main experiment abstraction

- Flop: check or bet 33% pot.
- Turn: check or bet 50% pot.
- River: check or bet 100% pot.
- Raises: disabled in the main artifact; one raise is exercised by tests.
- Future boards: BucketedBoardProvider(2). Available physical cards are deterministically partitioned into two buckets. One real representative card is used per bucket and its chance weight is the bucket size divided by the number of available cards.
- Board availability is recomputed after the actual private deal and after each public card.

This board abstraction changes the game. It is not exact enumeration and is always labeled abstracted.

## Hash and cache identity

The artifact/cache identity includes board, pot, stacks, acting player, position, action history, both quantized ranges, betting abstraction, algorithm configuration and solver version.

Range weights are quantized at 1e-9. This tolerance removes insignificant floating-point noise while preserving all strategically material differences in the current experiments. Tests cover range, board, stack and abstraction cache misses.

## Known limitations

- Only one fixed flop is used by the main comparison.
- Two representative future-card outcomes are not enough for professional strategy output.
- No raises in the main experiment reduce strategic expressiveness.
- Twenty DCFR iterations left the reference subgame at 0.541129 NashConv and 0.270565 exploitability.
- All outputs remain Experimental.

## Phase 6 freeze

`phase6-reference-game-v1` preserves exactly the Phase 5 laboratory: flop `8h 7d 2c`, 46 compatible private deals, two representative future-board outcomes, one bet size per street, no raises and no jams. Hash: `bfd3615d6ee13da1`.

The faster engine does not increase board coverage or action complexity. It solves this abstract game more deeply; it does not make the abstraction equivalent to NLHE. Expansion is blocked until seed stability and outer coupling pass.

<!-- PHASE6.6 START -->
## Phase 6.6 R/E/X ablation

R uses one representative card per deterministic bucket. E enumerates each legal physical card with exact chance probability but exposes only a deterministic bucket observation. X enumerates and exposes physical runouts. The controlled tree has 181 R nodes and 71,833 E/X nodes. R and X reached the fixed quality gate; E did not at 5,000 iterations, so Expected≈Exact remains unresolved. The full 5,533,605-node projection stays over the 2,000,000 cap.
<!-- PHASE6.6 END -->
