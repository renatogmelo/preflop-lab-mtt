# Fase 6.14 — Comparação dos algoritmos

Vanilla CFR, CFR+ e DCFR receberam jogos, estados iniciais e agendas iguais. Comparações iteration-matched e time-matched são relatadas separadamente.

## Hidden Information, 50.000 iterações

| Algoritmo | NashConv inicial | NashConv final | slope log-log empírica | R² | throughput |
|---|---:|---:|---:|---:|---:|
| Vanilla CFR | 0,25 | 2,9327e-5 | -0,8265 | 0,9740 | 360.927 iter/s |
| CFR+ | 0,25 | 2,5621e-6 | -1,0812 | 0,9817 | 361.318 iter/s |
| DCFR | 0,25 | 1,9547e-5 | -0,9949 | 0,9886 | 289.302 iter/s |

Essas slopes são regressões descritivas, não taxas provadas.

## Time-matched, 150 ms

| Algoritmo | Iterações | NashConv final |
|---|---:|---:|
| Vanilla CFR | 22.839 | 5,9885e-5 |
| CFR+ | 22.709 | 1,9548e-5 |
| DCFR | 22.039 | 3,5994e-5 |

DCFR terminou melhor nos jogos asymmetric chance, variable-depth e irregular; CFR+ terminou melhor no hidden-information longo e no ensaio time-matched. Não há vencedor universal demonstrado.
