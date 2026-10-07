# Preflop Lab Solver — Mathematical Core

## Extensive-form game

Um estado define jogador atuante, ações legais, transições, chance e utility terminal. Um infoset `I` agrupa estados indistinguíveis para o jogador. A estratégia comportamental é `σ(I,a)` e satisfaz:

```text
σ(I,a) ≥ 0
Σa σ(I,a) = 1
```

Chance possui probabilidades próprias e nunca é tratada como jogador estratégico.

## Reach probability

Para um histórico `h`, o reach é fatorado:

```text
πσ(h) = πchance(h) × π0σ(h) × π1σ(h)
```

No update do jogador `i`, o peso contrafactual exclui o reach do próprio jogador:

```text
π−iσ(h) = πchance(h) × πopponentσ(h)
```

Isso faz ações observadas condicionarem ranges implicitamente por Bayes/reach, sem filtros manuais.

## Counterfactual regret

Para ação `a` no infoset `I`:

```text
rᵗ(I,a) = vᵗ(I,a) − vᵗ(I)
Rᵀ(I,a) = Σt π−iᵗ(I) × rᵗ(I,a)
```

Regret matching usa apenas regrets positivos:

```text
σᵀ⁺¹(I,a) = max(Rᵀ(I,a), 0) / Σa' max(Rᵀ(I,a'), 0)
```

Quando o denominador é zero, a distribuição é uniforme.

## Average strategy

Current strategy é a distribuição obtida dos regrets atuais. Average strategy acumula estratégia ponderada pelo reach do próprio jogador e chance. O artefato final usa average strategy.

## Vanilla CFR

Executa traversal completo para cada jogador a cada iteração. Regrets acumulam sem clipping e average strategy usa peso unitário.

## CFR+

Após cada update:

```text
Rᵀ⁺(I,a) = max(0, Rᵀ⁻¹⁺(I,a) + rᵗ(I,a))
```

A média recebe peso linear após `cfrPlusAveragingDelay`, registrado na configuração.

## DCFR

Antes da iteração `t`, a implementação desconta regrets positivos, negativos e strategy sums:

```text
positiveScale = t^α / (t^α + 1)
negativeScale = t^β / (t^β + 1)
strategyScale = ((t−1)/t)^γ
```

Defaults explícitos do benchmark: `α=1.5`, `β=0`, `γ=2`.

## Best response, NashConv e exploitability

Kuhn enumera todas as políticas puras do jogador em cada infoset e escolhe o maior valor contra a estratégia adversária. Como é two-player zero-sum:

```text
NashConv(σ) = BR₀(σ₁) + BR₁(σ₀)
Exploitability(σ) = NashConv(σ) / 2
```

Essa métrica é exata para o benchmark. Para o POC Hold'em, best response ainda não foi implementado; os campos permanecem `null`.

## Kuhn known solution

O valor de equilíbrio do jogador zero é `−1/18 ≈ −0.0555556`. Kuhn admite uma família de equilíbrios, então testes não fixam uma única frequência arbitrária; validam valor, probability integrity e exploitability exata.

## Numerical safety

- toda probabilidade é finita e normalizada;
- chance deve somar 1 dentro de epsilon;
- regret/strategy sum com NaN ou Infinity interrompe o solve;
- utilities zero-sum são testadas;
- checkpoints rejeitam hashes incompatíveis;
- strategy delta mede a maior mudança absoluta entre snapshots da average strategy.

## Hold'em POC

O POC usa chance-sampled CFR sobre 1.326 combos para cada jogador. Deals com cartas compartilhadas são rejeitados. O jogo é push/fold e a continuação de call vem de `EquityApproximationProvider`; logo ele resolve o jogo aproximado declarado, não NLHE completo.

## Auditoria matem?tica da Fase 4

O traversal completo preserva a fatora??o de reach. No update de `i`, regrets usam `chanceReach ? reach(oponente)`; average strategy usa `chanceReach ? reach(i)`. Chance ? expandida e normalizada. Alternating updates executam um traversal por jogador.

O novo BR n?o escolhe a??o por estado oculto. Para cada infoset, soma o valor de cada a??o em todos os estados compat?veis ponderados apenas pelo reach contrafactual de chance e oponente; infosets mais profundos s?o resolvidos primeiro. Em pol?tica uniforme, reproduz exatamente Kuhn `11/12` e Leduc `4,747222222222222` de NashConv.

Leduc usa seis cartas f?sicas observ?veis, ante 1, dois raises m?ximos, sizes 2/4 e player 0 primeiro nas duas streets. A pol?tica uniforme d? EV P0 `?0,078125`; o valor publicado usado como refer?ncia ? `?0,085606`.

O POC V2 usa chance sampling com deals uniformes compat?veis. Como chance ? amostrada da distribui??o natural, n?o h? importance weight adicional no estimador de regret. H? dois traversals alternados e strategy sum ponderado pelo reach pr?prio. Ainda falta compara??o formal contra traversal completo em uma vers?o reduzida, portanto suas m?tricas de exploitability permanecem `null`.

Equity ? `(wins + ties/2)/trials`; sampling registra seed e erro padr?o. Ela n?o ? continuation GTO. No Level 2, utilities v?m de estrat?gia m?dia do subgame e s?o medidas por BR/NashConv gen?ricos.


## Phase 5 range chance and coupling

For weighted ranges R0 and R1, private chance is:

P(h0,h1) proportional to w0(h0) * w1(h1)

only for disjoint combos that do not intersect the board. The remaining mass is normalized exactly.

Conditional range snapshots use the complete joint posterior:

P(h0,h1 | history) proportional to P(h0,h1) * product_t sigma(a_t | I_t(h_actor))

Marginals are derived after this joint update, preserving blocker correlations.

Reduced-game Hold'em BR reuses the generic counterfactual algorithm. Training may sample chance, while evaluation enumerates all compatible deals.

Outer coupling applies explicit damping:

updated = alpha * solved + (1-alpha) * previous.

Convergence requires independent thresholds for preflop strategy, conditional ranges and continuation utilities.

## Phase 6 convergence diagnostics

DCFR discount scales and CFR+ delayed linear averaging are now exported pure functions and covered by formula tests. The selected reduced-game configuration is DCFR `(alpha=2, beta=0, gamma=3)`.

For strategies sigma and sigma', four deltas are retained: raw max action-probability change; max change among infosets above the active reach threshold; reach-weighted absolute change; and probability-mass-weighted change. Raw maximum is not a whole-strategy convergence measure.

Counterfactual action EV is computed on the exact compiled reduced tree using opponent/chance reach. The diagnostic stores action probabilities, action EVs, strategy EV, counterfactual regret, reach and the EV spread among materially mixed actions. At finite iteration budgets, positive-probability actions need not have exactly equal EV.

Exploitability is `NashConv / 2` for the two-player zero-sum reference game. Phase 6 never sums exploitability, seed variance and abstraction error into one scalar uncertainty.
## Phase 6.5 exact private chance and fixed point

For private deals `d` with normalized target probability `p(d)`, exact CFR evaluates every deal each iteration. Regret updates use synchronous accumulators so all nodes for one updating player see the same frozen regret policy during the traversal. This removes within-iteration deal-order dependence.

For sampled proposal `q(d)`, the traversal multiplier is the importance weight `w(d)=p(d)/q(d)`. IID and fixed CRN use `q=p`, hence `w=1`. Stratified and quasi schedules use their empirical allocation as `q` and retain coverage/effective-sample-size diagnostics.

The coupled operator is `F(S)=P(D(C(R(S))))`: condition ranges `R`, solve postflop continuation `C`, damp utilities `D`, then solve exact preflop `P`. With raw utility vector `u_k`, the value passed back is `v_k = αu_k + (1-α)v_{k-1}`. Convergence tests `v`, never relabels it as raw `u`, and requires all four residuals at most `0.02` for three consecutive iterations.

<!-- PHASE6.6 START -->
## Phase 6.6 operator definitions

For state vector S and deterministic map F, residual is R(S)=F(S)-S. Metrics: L1, L2, L∞, reach-weighted L1, and normalized L2 = ||R||₂/max(1,||S||₂,||F(S)||₂). LocalResponseRatio = ||F(S+δ)-F(S)||₂/||δ||₂ is a finite local diagnostic, not a Lipschitz or contraction proof. Damping changes S(next)-S but cannot reduce the raw residual by definition. Mass-preserving perturbations are normalized, nonnegative and blocker-compatible.
<!-- PHASE6.6 END -->
