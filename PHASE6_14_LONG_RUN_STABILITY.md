# Fase 6.14 — Estabilidade em long-runs

Budgets alcançados: 5.000, 10.000, 25.000 e 50.000 iterações. O maior runtime individual foi 443,31 ms e o pico RSS observado foi 63.467.520 bytes.

Resultados representativos:

| Jogo / algoritmo | Inicial | Final | Iterações |
|---|---:|---:|---:|
| Asymmetric / Vanilla | 0,28125 | 1,1250e-5 | 25.000 |
| Asymmetric / CFR+ | 0,28125 | 8,9996e-10 | 25.000 |
| Asymmetric / DCFR | 0,28125 | 5,3957e-14 | 25.000 |
| Variable-depth / Vanilla | 0,75 | 3,0000e-5 | 25.000 |
| Variable-depth / CFR+ | 0,75 | 2,3999e-9 | 25.000 |
| Variable-depth / DCFR | 0,75 | 1,4399e-13 | 25.000 |
| Irregular / Vanilla | 0,943634 | 1,8873e-4 | 5.000 |
| Irregular / CFR+ | 0,943634 | 7,5476e-8 | 5.000 |
| Irregular / DCFR | 0,943634 | 2,2640e-11 | 5.000 |

Não houve divergência nem anomalia numérica. Matching Pennies e RPS começaram no equilíbrio uniforme, portanto NashConv permaneceu zero; isso é platô analítico esperado, não sucesso causado pelas iterações.

O detector marcou oscilações tardias em CFR+ no hidden-information e na seed 61400. A métrica final ainda melhorou materialmente; o diagnóstico registra investigação, não declara bug. Execução contínua e três resumes intermediários produziram hashes bit a bit iguais nos três algoritmos.
