# Preflop Lab Solver — Relatório da Fase 6.14

Versão `0.14.0`; baseline `e5cc8e22126cfa2707fbdc8918582931a91f1b05`.

## Resultado

A infraestrutura reproduzível de long-run foi implementada e executada. Foram 52 experimentos isolados: 49 completaram o budget de iterações e 3 terminaram corretamente pelo budget time-matched de 150 ms. V1–V9 passaram. Não houve divergência ou instabilidade numérica; o maior delta contra oracles independentes foi `2,7756e-17` em 713 cross-checks.

As evidências sustentam estabilidade e melhoria observada nos jogos testados, não uma prova geral de convergência. Gate D continua `FAIL`, `Verified=0` e nenhuma estratégia de poker mudou.

## Respostas obrigatórias

1. 52 experimentos.
2. Matching Pennies, RPS, Hidden Information, cinco Controlled Random, Irregular Branching, Variable-Depth Hidden Information, Asymmetric Chance e Chance Stress.
3. Vanilla CFR, CFR+ e DCFR.
4. 5.000, 10.000, 25.000 e 50.000 iterações.
5. 150 ms por algoritmo no grupo time-matched; watchdog máximo de 12 s por processo.
6. No Hidden/50k: `0,25 → 2,9327e-5` Vanilla, `2,5621e-6` CFR+ e `1,9547e-5` DCFR.
7. Exploitability acompanhou exatamente NashConv/2 por convenção.
8. CFR+ foi melhor no Hidden; DCFR foi melhor nas famílias asymmetric, variable-depth e irregular; não houve vencedor universal.
9. Não. Nenhum guard numérico foi acionado.
10. Sim: equilíbrios uniformes já exatos ficaram em platô zero; três séries CFR+ tiveram oscilação tardia registrada.
11. Não.
12. `61400`–`61404`; `61402` também parametrizou Irregular Branching.
13. Sim, em 713 pontos; maior delta `2,7756e-17`.
14. `2,7755575615628914e-17` nas métricas independentes.
15. 63.467.520 bytes RSS.
16. Hidden/50k: ~360.927 iter/s Vanilla, 361.318 CFR+ e 289.302 DCFR.
17. Sim, contínuo versus resumes em 1k/5k/25k foi bit a bit igual nos três algoritmos.
18. Nenhuma regressão conhecida após a validação final.
19. Passaram 261/261 testes TypeScript (239 históricos + 22 novos) e 3/3 testes Rust.
20. V1–V9 passaram.
21. Os três time-matched são `BUDGET LIMITED` por desenho; oscilações tardias são diagnósticas, não conclusões de falha.
22. O regret-to-equilibrium do Vanilla CFR e ordem geral `O(1/√T)` sob as hipóteses declaradas; bounds específicos não foram transferidos automaticamente para CFR+/DCFR.
23. Escala sintética, BR combinatório, timing dependente do ambiente, amostragem de RSS e ausência de prova formal.
24. Fase 6.15: ampliar tamanhos sob Resource Policy, repetir timing com distribuição estatística, instrumentar constantes de bounds e estudar precisão/platôs em horizontes maiores.

## Validação final

`npm run check` passou: typecheck, lint, build e 261/261 testes TypeScript. Os 3/3 testes Rust históricos também passaram.
