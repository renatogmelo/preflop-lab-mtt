# Continuation Values

## O problema

Preflop não termina quando alguém paga ou quando dois jogadores chegam ao flop. A utility correta depende de posição, realização de equidade, apostas futuras, implied/reverse implied odds e estratégia postflop. `equity × pot` não substitui isso.

## Interface

`ContinuationValueProvider.evaluate(heroCombo, villainCombo, context)` devolve utilities para ambos os jogadores. O solver não conhece a implementação concreta e registra provider, nível e eligibility no artefato.

## Level 0 — desenvolvimento

Provider atual: `strength-proxy-v1`.

- usa força relativa determinística das hole cards e pequeno ajuste posicional;
- preserva chance e card removal no sampling;
- não enumera boards nem resolve apostas postflop;
- `utilityModel = equity-approximation`;
- `eligibleForVerified = false`.

Todo resultado Level 0 é `Experimental`. Nem convergência baixa do CFR torna a utility verdadeira.

## Level 1 — continuação melhorada

Próximo estágio possível: tabelas externas originais/licenciadas ou modelo de realização calibrado, versionado por stack/posição/ranges. Continua não sendo automaticamente Verified e precisa de validação própria.

## Level 2 — continuação resolvida

Subgames postflop resolvidos ou solução acoplada, com card removal, ranges condicionais, sizings e erro/convergência auditáveis. Só Level 2 defensável pode entrar como candidato real a Verified, ainda sujeito a reprodução, regressão e review.

## Estado atual

O problema matemático permanece aberto para Hold'em profissional. O POC comprova infraestrutura, não uma estratégia GTO. A prioridade para o primeiro candidato Verified é escolher um único cenário pequeno e substituir Level 0 por continuação defensável antes de escalar cobertura.

## Phase 4 ? providers concretos

- `StrengthProxyProvider`: Level 0, for?a das hole cards, Experimental.
- `EquityProvider`: Level 1, enumera??o exata ou sampling determin?stico, Experimental porque ignora betting/realiza??o.
- `RealizationModelProvider`: Level 1, exige fatores e metodologia expl?citos, Experimental.
- `SubgameSolverProvider`: Level 2, consome utilities de um artifact estrat?gico resolvido.
- `CachedSolvedContinuationProvider`: cacheia somente Level 2 pelo hash completo do request.

Level 2 significa utility derivada de ?rvore estrat?gica expl?cita com chance, betting, showdown, convergence e BR documentados. O primeiro artifact cumpre isso apenas para `AsAh vs KdKc` no flop `2s3d4c` e abstraction declarada. N?o pode ser extrapolado para outro range ou board.

A compara??o da fase prova que o strength proxy pode errar materialmente. Ela n?o autoriza substituir um range geral pelo subgame fixo. Consulte `PREFLOP_POSTFLOP_COUPLING.md`.


## Phase 5 semantics and evidence

ContinuationResult now separates:

- chanceResolution: exact-enumeration, sampled, abstracted or not-applicable;
- strategicSolution: unvalidated, approximate-equilibrium, converged-approximation or validated.

A finite CFR solve is never called exact merely because public cards were enumerated.

The first weighted-range solved continuation used 46 compatible deals, a fixed flop and a two-bucket future-board abstraction. At 20 DCFR iterations it had 0.270565 exploitability. It produced a 0.636867 weighted strategy distance from exact-equity continuation in the reduced preflop game, but the result is not reliable enough for training because convergence and seed stability are insufficient.

## Phase 6 evidence

The three provider pipelines were rerun for seeds 1, 7, 19, 42 and 99 at 10,000 preflop iterations. Mean within-provider distance is Proxy `0.138480`, Equity `0.005514`, Solved `0.126345`. Equity-vs-Solved weighted distance is `0.653360`, producing the explicitly nonstandard Preflop Lab diagnostic `ProviderSeparationRatio = 5.171253`.

Provider separation is larger than measured seed noise, but Solved is not seed-stable and neither provider has external truth validation. Continuation outputs remain Experimental and are not eligible as default Trainer answers.
## Phase 6.5 continuation-value semantics

Pair-table continuation now participates in a deterministic outer map. Each iteration stores both:

- raw solved pair utilities from the postflop subgame;
- damped pair utilities actually consumed by the next exact preflop solve.

These objects are never mixed. At outer iteration 100, raw maximum movement was `2.660087` while damped movement was `0.053868`; reporting only the damped value would hide the response instability.

Exact provider comparison uses the same frozen preflop tree: Equity↔Solved weighted strategy distance is `0.629219`. This remains Experimental because future boards are abstracted and no external solver has validated the pair utilities.