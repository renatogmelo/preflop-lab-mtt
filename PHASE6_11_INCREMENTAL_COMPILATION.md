# Phase 6.11 — Incremental Compilation

A API suporta inicializar, `processNextChunk`, inspecionar progresso, continuar, `finish` e `cancelAndRelease`.

Estados: `partial`, `complete`, `cancelled`, `failed`. `finish()` recusa topologia parcial. Node budget é pré-validado; runtime e `AbortSignal` são verificados por chunk. O processo também permanece sob Resource Policy V3/watchdog.

| Chunk S4 | Compile | Pico RSS | Cancellation checks |
|---:|---:|---:|---:|
| 4.096 | 308,784 ms | 77,80 MiB | 32 |
| 16.384 | 307,695 ms | 77,60 MiB | 8 |
| 65.536 | 302,731 ms | 77,72 MiB | 2 |
| 262.144 | 304,551 ms | 77,67 MiB | 1 |

Todos: hash `82e7911d8010…`. Padrão: 65.536, com throughput empatado com o melhor e checks limitados. 4.096 serve quando responsividade de cancelamento é prioritária.

Chunking é construção incremental da mesma árvore, não solve parcial.