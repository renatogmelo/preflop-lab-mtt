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
