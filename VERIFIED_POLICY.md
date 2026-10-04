# Verified Policy — Solver Datasets

## Regra

`internal-solve` descreve origem; não concede confiança. Todo export do solver nasce `Experimental`. Promoção exige pipeline explícito:

```text
RAW → SOLVED → VALIDATED → REVIEWED → VERIFIED
```

## Critérios obrigatórios

Um candidato só pode usar `Verified` quando todos forem verdadeiros:

1. solver/version e schema do artefato registrados;
2. GameDefinition, abstração, stacks, blinds, antes e utility imutáveis e hasheados;
3. seed, algoritmo, parâmetros, iterações e stop condition registrados;
4. checkpoint íntegro e reprodução independente dentro de tolerância declarada;
5. probability, reach, utility, legal-action, card-removal e zero-sum invariants aprovados;
6. best response/exploitability ou métrica equivalente matematicamente válida para o jogo;
7. threshold justificado pelo jogo e uso do dataset, definido antes do solve;
8. continuation provider elegível, versionado e validado — Level 0 é proibido;
9. differential/regression suite aprovada;
10. raw combo strategy preservada; agregação 169 auditável;
11. revisão humana registrada, sem bypass editorial;
12. licença/origem permitem uso e publicação;
13. ValidationReport sem falha obrigatória e com limitações publicadas;
14. golden snapshot associado ao dataset Verified.

## Thresholds

Não existe um número universal. Cada manifesto de validação deve justificar exploitability/NashConv em unidades do jogo, erro numérico, precisão de frequência e finalidade. O limite `0.01` usado nos testes de Kuhn valida o motor pequeno; não é política automática para Hold'em.

## Bloqueadores absolutos

- utility/continuation aproximada sem validação adequada;
- exploitability indisponível quando deveria ser aplicável;
- NaN, frequência inválida, ação ilegal ou checkpoint incompatível;
- árvore/sizing diferente do declarado;
- resultado não reproduzível;
- review ausente;
- dados proprietários de terceiros incorporados sem licença.

## Estado do POC 0.1.0

O dataset `solver-experimental-6a62393e944f6db2` falha eligibility por Level 0 continuation e ausência de best response Hold'em. Ele permanece `Experimental`, é excluído da resolução automática e não conta como cobertura Verified.

## Estado ap?s a Fase 4

`Verified` permanece zero. Leduc valida o motor, n?o produz dados NLHE. O subgame Level 2 ? eleg?vel como evid?ncia matem?tica do cen?rio exato, mas n?o como dataset de treino: ranges s?o degenerados, board ? fixo e abstraction limita apostas. Hold'em V2 ainda n?o possui BR/NashConv e usa Level 0 no benchmark de cobertura.

Nenhum artefato da Fase 4 deve entrar no Trainer/Academy. Ele pertence somente ao Solver Lab at? que acoplamento, BR, sampling, cobertura e revis?o independente cumpram todos os crit?rios desta pol?tica.


## Phase 5 decision

Verified remains zero. Phase 5 artifacts are Experimental because the reference postflop solve has 0.270565 exploitability, future boards are bucketed, only one flop is covered, solved-provider seed variance is material, and the outer loop did not converge. Passing structural tests or computing Hold'em BR does not override these blockers.
