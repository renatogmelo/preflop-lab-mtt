# Phase 6.8 Report — Unified Solver Scalability, Validation and Performance

## Resultado

A arquitetura unificada permaneceu estruturalmente válida, determinística e diferencialmente equivalente ao solver de referência até **S4: 131.069 nós, 10.922 information sets e profundidade 15**. S5, com 2.097.149 nós estimados, foi interrompido com segurança antes da materialização por ultrapassar os budgets de nós e memória.

Isso demonstra crescimento controlado no laboratório sintético; não demonstra escala de poker nem precisão profissional. Nenhuma estratégia de poker foi alterada. `Verified = 0` e o Gate D histórico continua **FAIL**.

## Gates do laboratório

| Gate | Resultado | Evidência |
|---|---|---|
| S1 — Structural Validity | PASS | validação estrutural completa nos jogos materializados e 24 casos determinísticos |
| S2 — Mathematical Consistency | PASS | ground truth em S0, best response/NashConv, diferencial e metamórfico |
| S3 — Reproducibility | PASS | checkpoints idênticos e hash semântico `3db676a9e81ac2bd` repetido |
| S4 — Controlled Scaling | PASS | S0–S4 concluídos; S5 recusado no preflight |
| S5 — Performance Evidence | PASS | throughput, memória, compilação, BR, serialização e checkpoint medidos |
| S6 — Honest Limitations | PASS | limites matemáticos e computacionais preservados |

## Respostas obrigatórias

1. **Maior jogo resolvido:** S4 (`scale-s4`).
2. **Nós:** 131.069.
3. **Information sets:** 10.922.
4. **Profundidade:** 15.
5. **Runtime:** DCFR 474,833 ms para 2 iterações de traversal; experimento completo 41,736 s.
6. **Memória máxima observada:** 421.613.984 bytes de heap no run DCFR de S4 (amostragem entre checkpoints, não profiler nativo).
7. **Exploitability final:** DCFR S4 `0,0397833330` após somente 2 iterações.
8. **NashConv final:** DCFR S4 `0,0795666661`.
9. **Melhor desempenho:** DCFR obteve simultaneamente o menor runtime e a menor exploitability em S4.
10. **Tempo confirmou iterações?** Neste corpus, sim: DCFR foi o melhor nas duas leituras; isso não é universalizado para outros jogos.
11. **Gargalo principal:** traversal exponencial e memória da árvore materializada; BR já custa ~196 ms em S4.
12. **Houve ganho compilado/indexado?** Sim, mantendo equivalência matemática.
13. **Quanto:** speedup do indexado sobre a referência entre `3,72x` e `10,73x` no mesmo ambiente; S4 `3,72x`.
14. **Diferencial passou?** Sim em S0–S4, incluindo strategy, utilities, regrets, strategy sums, NashConv e exploitability.
15. **Metamórfico passou?** Sim: renomeação, ordem de chance, escala de utility, estados privados e jogadores.
16. **Checkpoint/resume determinístico?** Sim, estratégia e estado semântico idênticos em S0–S4; envelope V3 válido.
17. **Primeiro limite:** S5, no preflight: 2.097.149 nós e ~1,172 GiB combinados estimados para definição + árvore compilada.
18. **Rust é necessário?** Não nesta fase; a primeira ação é reduzir materialização/representação e explorar traversal lazy.
19. **Gates:** S1–S6 PASS.
20. **Testes totais:** 152/152 (135 anteriores + 17 novos), além de TypeScript, ESLint e build de produção.
21. **Limitações:** jogos sintéticos 2-player zero-sum; ground truth independente apenas em S0; memória amostrada; kernel calibrado; sem prova de poker-scale.
22. **Próxima pesquisa:** topologia lazy/iterativa e avaliação em batches, mantendo o oracle de referência e o mesmo protocolo diferencial antes de considerar paralelismo ou Rust.

## Evidência

O artefato canônico é `solver/artifacts/phase6-8-unified-scalability-v0.8.0.json`. Ele contém seeds, configurações geradoras, hashes, validação estrutural, curvas, métricas, resultados diferenciais, checkpoints, safe abort, falhas, gates e limitações.

