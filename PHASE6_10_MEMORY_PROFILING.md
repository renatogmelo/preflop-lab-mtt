# Phase 6.10 — Memory Profiling

## Método

Cada perfil registra memória antes/depois de compilação, inicialização, traversal, avaliação, checkpoint e cleanup. O filho coleta heap, RSS, external, ArrayBuffer e `resourceUsage().maxRSS`; o pai amostra RSS/PeakWorkingSet do PID. GC, duração de GC, taxa aproximada de alocação e memória após cleanup também são persistidos.

O termo “pico observado” significa o maior valor visto por essas medições. Ele não é apresentado como pico físico absoluto entre amostras.

## S2–S4

| Escala | Nós | Estimativa inicial | Pico conservador observado |
|---|---:|---:|---:|
| S2 | 8.189 | 67.706.632 B | 80.699.392 B |
| S3 | 32.765 | 69.500.680 B | 80.662.528 B |
| S4 | 131.069 | 76.676.872 B | 89.837.568 B |

Em S4, o maior pico independente amostrado pelo pai foi 82.391.040 B. O valor conservador de 89.837.568 B vem do `maxRSS` autorreportado e é usado na calibração porque o sampler de 500 ms pode perder um pico curto.

## Erro pré-calibração

- frequência de subestimação: 100%;
- erro relativo médio: 14,59%;
- pior subestimação: 13.160.696 B;
- pior fração relativa observada: 16,10% (ocorreu numa escala menor, onde overhead fixo domina).

Esses números invalidaram o uso direto da estimativa inicial. A Política V3 passou a usar 79.773.696 B de overhead fixo e multiplicador variável `2,6713`, incluindo margem de 15% sobre o pior crescimento variável observado.

## S5

| Run | Runtime | Pico observado | Compilação | Traversal | Avaliação | Checkpoint |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 16.946,44 ms | 200.675.328 B | 15.434,61 ms | 272,81 ms | 214,45 ms | 410,13 ms |
| 2 | 17.669,10 ms | 198.795.264 B | 16.097,49 ms | 329,93 ms | 208,63 ms | 395,29 ms |

O pico máximo de 191,38 MiB representa 24,9% do teto de 768 MiB. A estimativa calibrada foi 336,09 MiB, oferecendo folga sem elevar o orçamento.

## Cleanup

O Worker descarta provider, compilação e solver, solicita GC quando disponível e mede novamente. Isso melhora a observabilidade, mas GC explícito não é garantia de devolução imediata de páginas ao sistema operacional; por isso cada benchmark termina o processo isolado.
