# Phase 6.7 Unified Architecture

## Scope

The research module is independent of poker and targets finite two-player zero-sum extensive-form games with chance and perfect recall. It is intentionally small enough to audit exhaustively.

## Modules

- `unified/game-definition.ts`: formal players, actions, nodes, transitions, chance distributions, information sets, stages and terminal utilities.
- `unified/game-tree.ts`: adapter to the generic `ExtensiveGame` contract plus exhaustive history enumeration.
- `unified/information-sets.ts`, `chance.ts`, `utilities.ts`: perfect recall, action consistency, chance normalization and zero-sum audits.
- `unified/unified-solver.ts`: one full-tree DCFR optimization, exact evaluation and checkpoint/resume.
- `unified/ground-truth.ts`: independent normal-form pure-plan enumeration and equilibrium support solving.
- `decomposition/continuation-operator.ts`: continuation solve, conditional state distribution, continuation utilities and initial re-solve.
- `decomposition/decomposed-solver.ts`: undamped, damped and safeguarded-Anderson fixed-point iterations.
- `comparison/experiment-runner.ts`: common-game experiment matrix, budgets, hashes, gates and artifact generation.

## Unified data flow

```text
Declarative game
      |
Structural validation (chance, infosets, recall, zero-sum)
      |
Single compiled extensive-form tree
      |
DCFR updates all initial and continuation infosets
      |
Exact strategy EV + best responses + NashConv + exploitability
```

There are no frozen continuation utilities and no external fixed-point iteration in this path.

## Decomposed control

```text
Initial strategy S
      |
Conditional state reach under S
      |
Finite continuation solve
      |
Finite initial re-solve F(S)
      |
R(S) = F(S) - S
      |
Undamped / damped / safeguarded-Anderson update
```

Both paths consume the same immutable game definition and the same terminal utilities. This makes any measured difference attributable to optimization architecture rather than a changed game.

## Reproducibility identity

Every run records a game hash, configuration hash, experiment ID, algorithm version, strategy hash and checkpoint hash. The unified and decomposed continuous/resumed trajectories are tested for exact deterministic equality, excluding wall-clock time from semantic identity.
