# Phase 6.11 — Limitations

- Compiler V2 é especializado no provider sintético; não é um compilador universal de árvores de poker.
- O provider conhece node count exato. Dynamic growth para providers desconhecidos não foi implementado; H3 é INCONCLUSIVE.
- Chunking melhora controle/cancelamento, mas não reduz a capacidade residente dos buffers pré-alocados.
- Alguns subestágios são intercalados; tempos não separáveis são `null`, não estimados.
- Cache load ainda copia ~57 MiB e revalida a estrutura inteira; não há mmap/zero-copy.
- “Cold load” significa processo novo; o cache do sistema operacional não foi purgado.
- Cache write eleva temporariamente RSS por conter payload serializado e árvore residente.
- Rust suporta somente os jogos sintéticos S0–S5 e a topologia; não implementa solver.
- `tanh` diverge até ~2,22e-16 entre runtimes; o contrato é 1e-12, não bit identity.
- Duas repetições caracterizam esta máquina, não uma distribuição universal de performance.
- Gate D histórico continua FAIL; Verified continua zero.
- Nenhum resultado desta fase melhora ou valida ranges de poker.