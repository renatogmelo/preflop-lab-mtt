# Fase 6.15 — Resource stress

Resource Policy V3 não foi relaxada: teto 768 MiB, 30 s, Tier 0 até 250k nós e budgets históricos de iteração.

| Alvo | Nós reais | Runtime | RSS observado | Resultado |
|---|---:|---:|---:|---|
| ~40k | 39.317 | 1.031 ms | 170.823.680 B | completo |
| ~100k | 104.681 | 2.796 ms | 301.658.112 B | completo |
| ~250k | 232.333 | 5.916 ms | 424.177.664 B | completo |
| ~500k | 515.520 | 14.622 ms | 699.142.144 B | completo, Tier 1 controlado |
| ~1m | 1.070.770 estimados | — | — | negado pelo preflight |

Os números são amostras observadas ao final do child, não máximos garantidos. O processo de ~500k ficou próximo do teto; por isso ~1m não foi forçado.
