# Phase 6.7 Mathematics

## Extensive-form model

A game is defined by players `N={0,1}`, histories `H`, terminal histories `Z`, legal actions `A(h)`, player/chance function `P(h)`, chance distribution `pi_c(a|h)`, information partitions `I_i`, transition `T(h,a)` and utilities `u_0(z)=-u_1(z)`. All chance distributions are normalized and all nodes inside one information set share actor and legal actions.

Perfect recall is checked by comparing, for every pair of histories in an information set, the complete sequence of that player's earlier information sets and own actions. A strategy receives only the information-set key; private state absent from that key is therefore inaccessible.

## Unified solve

The unified solver applies counterfactual regret minimization over the complete tree. At information set `I`, regret matching uses positive cumulative regret:

`sigma(I,a) = max(R(I,a),0) / sum_b max(R(I,b),0)`.

The experiment uses deterministic DCFR parameters `(alpha=2, beta=0, gamma=3)`. Initial and continuation regrets are updated in the same iteration and against the same reach distribution.

## Exact evaluation

For a behavioral profile `sigma`, strategy EV is the exact tree expectation. Best response selects one action per information set, weighted by chance and opponent counterfactual reach. For a zero-sum game:

`NashConv(sigma) = BR_0(sigma_1) + BR_1(sigma_0)`

and `exploitability = NashConv / 2`.

## Independent ground truth

The reference method enumerates every pure contingent plan for each player, constructs the normal-form payoff matrix, enumerates candidate support pairs, solves their linear indifference systems and verifies all off-support saddle inequalities. It does not call CFR to obtain the reference equilibrium. The three matrix sizes are `4x2`, `4x4` and `4x16`; all reference exploitabilities are exactly zero within serialized precision.

## Decomposition operator

For an initial strategy vector `S`, the continuation is solved with `S` frozen. The resulting continuation strategy is then frozen while the initial stage is re-solved, producing `F(S)`. Diagnostics use the raw residual:

`R(S) = F(S) - S`.

Reported norms are L1, L2, L-infinity and normalized L2. The actual damped movement is recorded separately as `alpha R(S)`. A small damped movement is never treated as proof of a small raw residual.

LocalResponseRatio compares successive observed operator movements:

`||F(S_t)-F(S_(t-1))||_2 / ||S_t-S_(t-1)||_2`.

It is a directional diagnostic, not a global contraction proof. Anderson candidates are projected back onto each information-set simplex and accepted only after a fresh operator evaluation passes the residual safeguard.
