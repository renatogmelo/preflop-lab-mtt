# Phase 6.11 — Performance

Todas as medições são processos novos e monitorados. Cada célula S3–S5 tem duas repetições. S5 exigiu Resource Policy V3, preflight calibrado, tier2 explícito, limite de 768 MiB, timeout de 30 s e watchdog.

## Cold compile/cache matrix

| Escala | Baseline | TS V2 | Rust total | Cache TS | Cache Rust |
|---|---:|---:|---:|---:|---:|
| S3 | 262,263 ms | 91,450 ms | 231,383 ms | 21,892 ms | 24,562 ms |
| S4 | 979,122 ms | 419,421 ms | 828,643 ms | 66,130 ms | 57,409 ms |
| S5 | 16.569,014 ms | 5.667,428 ms | 14.288,369 ms | 722,292 ms | 617,499 ms |

## S5 stages

| Implementação | Compile/load mediano | Traversal | Evaluation | Pico RSS mediano |
|---|---:|---:|---:|---:|
| Baseline TS | 16.569,014 ms | 269,516 ms | 232,993 ms | 189,13 MiB |
| TS V2 | 5.667,428 ms | 329,371 ms | 255,912 ms | 254,36 MiB* |
| Rust + integração | 14.288,369 ms | registrado no artefato | registrado no artefato | 283,18 MiB* |
| Cache TS | 722,292 ms | registrado no artefato | registrado no artefato | 208,16 MiB |
| Cache Rust | 617,499 ms | registrado no artefato | registrado no artefato | 206,89 MiB |

`*` Uma das duas repetições também exportou cache. Repetições compiler-only: V2 190,90 MiB; Rust 228,26 MiB. Não houve redução material de RSS do V2 compiler-only versus baseline; a escrita do cache aumenta o pico.

S5 baseline variou 16.325,619–16.812,410 ms (σ 243,395 ms). V2 variou 5.273,086–6.061,770 ms (σ 394,342 ms).

## Leitura correta

O ganho dominante é reutilização: cache TS foi 22,94× mais rápido que baseline. V2 é o melhor cold compiler mantível. Rust não vence V2 end-to-end. Tempos “cold/warm” distinguem processos, mas o page cache do SO não foi limpo; não há claim de disco físico frio.

Miss S3: detecção 0,391 ms, compile 82,146 ms, write 40,951 ms. Invalidation S3: detecção 1,441 ms, compile da nova identidade 71,243 ms, write em nova chave 33,126 ms.

Performance não é gate funcional com thresholds estreitos; o artefato guarda mediana, mínimo, máximo, range, desvio-padrão, RSS, heap, GC e hashes para regressão controlada.