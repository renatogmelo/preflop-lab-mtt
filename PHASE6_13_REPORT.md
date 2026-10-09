# Preflop Lab Solver — Relatório da Fase 6.13

Versão `0.13.0`; baseline `8cd893ff0118ebcd84ee9abfd37baf2538f2c600`.

## Resultado

Sim: dentro das hipóteses declaradas, CFR, CFR+ e DCFR foram demonstrados por uma referência independente, oráculos por iteração, cinco fixtures analíticas, best response por enumeração pura, 96 casos de propriedade, metamorfismos, adversariais numéricos e retomada determinística. Os máximos deltas de regrets, strategy sums, EV, BR e NashConv foram `0`. Gates M1–M9 passaram.

Isso não valida poker pré-flop. Nenhum dataset foi promovido, `Verified=0` e Gate D continua `FAIL`.

## Respostas obrigatórias

1. Sim, a especificação formal foi concluída em `phase6.13-formal-spec-v1`.
2. Jogos finitos, dois jogadores, soma zero, chance explícita, informação imperfeita e recordação perfeita.
3. Sim, CFR independente com trace por visita/iteração.
4. Sim, CFR+ independente com recorte e média linear explicitados.
5. Sim, DCFR independente com `α/β/γ`, ordem e índice explicitados.
6. Maior delta de regrets: `0`.
7. Maior delta de strategy sums: `0`.
8. Maior delta de EV: `0`.
9. Maior delta de best response: `0`.
10. Maior delta de NashConv: `0`.
11. Cinco jogos analíticos.
12. 32 jogos gerados e 96 casos algoritmo/jogo.
13. Seeds `61300` a `61331`; seeds auxiliares `613` e `777` para checkpoint/determinismo.
14. Nenhum contraexemplo após a correção; lista de minimizados vazia.
15. Corrigida a mutação intra-travessia do regret de infosets repetidos nos motores CFR promovidos.
16. Não houve mudança da convenção matemática declarada; a implementação passou a respeitá-la. A versão do algoritmo foi elevada para `compact-cfr-v0.13.0`.
17. Sim; escalas `1e-200`/`1e100`, alcance zero, negativos, chance assimétrica e rejeições passaram.
18. Sim, Checkpoint V5 retomou os três algoritmos bit a bit.
19. Nenhuma regressão conhecida após a suíte final.
20. Passaram 239/239 testes TypeScript (221 históricos + 18 novos) e 3/3 testes Rust.
21. M1, M2, M3, M4, M5, M6, M7, M8 e M9 passaram.
22. Nível 0: rejeições/guards; Nível 1: identidades e single-step; Nível 2: diferenciais/BR/checkpoint; Nível 3: propriedades/metamorfismos/adversariais; Nível 4: vazio.
23. Permanecem escalabilidade do oráculo, convergência profunda, motores legados e toda validação específica de poker.
24. A Fase 6.14 deve estudar convergência profunda: bounds empíricos, estabilidade longa, múltiplas seeds, variantes de média e diagnóstico de platôs sem confundir sanity check com prova.

## Evidência reproduzível

Artefato: `solver/artifacts/phase6-13-mathematical-verification-v0.13.0.json`.

Comandos principais: `npm run solver:phase6-13`, teste focal 6.13, `npm run typecheck`, `npm run lint`, `npm run build`, suíte TypeScript completa e os três testes Rust históricos.

## Validação final

`npm run check` passou: typecheck, lint, build e 239/239 testes TypeScript. Os 3/3 testes Rust históricos também passaram. O artefato registra separadamente resultados matemáticos e validação de engenharia.
