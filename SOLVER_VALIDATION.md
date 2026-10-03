# Preflop Lab Solver — Validation Report 0.1.0

## Resumo honesto

O core CFR está validado em Kuhn. O POC de Hold'em é estrutural e Experimental. Continuation values profissionais, exploitability Hold'em, Leduc e solução 8-max completa ainda não existem.

## Kuhn — execução oficial

| Métrica | Resultado |
|---|---:|
| Algoritmo | DCFR α=1.5, β=0, γ=2 |
| Iterações | 2.500 (early stop) |
| Infosets | 12 |
| Nós visitados | 275.000 |
| Valor P0 | -0,05556017 |
| Valor conhecido | -0,05555556 |
| Exploitability | 0,00271726 |
| NashConv | 0,00543451 |
| Strategy delta final | 0,00093571 |
| Runtime observado | 381 ms |
| Checkpoint observado | 3.212 bytes |

Probability integrity, valor conhecido, best response, exploitability, NashConv e estabilidade numérica passaram.

## Validação diferencial — 20.000 iterações

| Algoritmo | Exploitability | NashConv | Iterações/s | Nós/s |
|---|---:|---:|---:|---:|
| Vanilla CFR | 0,00150381 | 0,00300763 | 9.630 | 1.059.286 |
| CFR+ | 0,00107534 | 0,00215068 | 9.819 | 1.080.145 |
| DCFR | 0,00093680 | 0,00187360 | 10.373 | 1.140.986 |

Os três algoritmos resolvem exatamente o mesmo jogo e convergem para valores compatíveis. Runtime e heap são observações da máquina, não garantias.

## Hold'em POC — execução oficial

| Métrica | Resultado |
|---|---:|
| Jogo | HU SB vs BB, 10bb, push/fold |
| Algoritmo | chance-sampled CFR |
| Iterações/amostras | 5.000.000 |
| Infosets | 2.652 |
| Raw strategies | 1.326 combos por jogador |
| Memória tabular estimada | 84.864 bytes |
| Runtime observado | 4.598 ms |
| Average positive regret reportado | disponível no artefato |
| Strategy delta final | 0,03610995 |
| Exploitability/NashConv | indisponível (`null`) |
| Continuation | Level 0 `strength-proxy-v1` |
| Trust | Experimental |

Passaram: combo count, frequency integrity, card-removal, seed/checkpoint e export das 169 classes. Falham eligibility para Verified: continuation aproximada e ausência de best response/exploitability aplicável.

## Testes

- 52 cartas únicas, 1.326 combos, 169 classes e multiplicidades 6/4/12;
- weighted ranges e 1.225 combos restantes após blocker;
- pot inicial 8-max BBA de 2,5bb e UTG first-to-act;
- short all-in sem reabrir raise para quem já agiu;
- 500 sequências legais geradas com conservação de fichas;
- CFR, CFR+ e DCFR em Kuhn;
- valor conhecido, best response, exploitability e NashConv;
- checkpoint/resume determinístico e rejeição de configuração divergente;
- POC determinístico, combo-level e sem EV inventado;
- dataset validado, Experimental e excluído do auto-resolution.

## Artefatos

- `kuhn-dcfr-v0.1.0.json` e checkpoint;
- `benchmark-kuhn-v0.1.0.json`;
- `holdem-poc-v0.1.0.json`, checkpoint e validation report;
- `datasets/solver-experimental/holdem-poc-v0.1.0.json`.

## Limitações matemáticas restantes

1. Leduc não implementado.
2. Best response/exploitability Hold'em não implementado.
3. POC não representa árvore 8-max nem jogadores foldados condicionais.
4. Continuação Level 0 não modela postflop.
5. Strategy delta do POC ainda mostra ruído de amostragem; aumentar iterações não corrige utility incorreta.
6. Não há paralelização, f32, compressão binária ou profiling nativo.
7. Nenhum resultado é Verified.

## Resultado da primeira execução

1. Arquitetura: core isolado + exporter boundary.
2. Linguagem: TypeScript estrito para referência auditável; Rust planejado após profiling.
3. Algoritmos: Vanilla CFR, CFR+ e DCFR; chance-sampled CFR no POC.
4. Kuhn: validado contra valor conhecido.
5. Leduc: não implementado, declarado.
6. Métricas: números nas tabelas acima.
7. Hold'em: POC HU combo-level, push/fold.
8. Infosets: 12 Kuhn; 2.652 POC.
9. Performance: registrada acima e em artifact.
10. Memória: checkpoints/estimativas registrados.
11. Testes: unitários, property traces, differential e integration.
12. Limitações: explícitas neste documento.
13. Continuation: Level 0, bloqueador de Verified.
14. Dataset: `solver-experimental-6a62393e944f6db2`.
15. Roadmap: Leduc → BR escalável → NLHE tree → 8-max conditioning → Level 2 → um candidato Verified.
