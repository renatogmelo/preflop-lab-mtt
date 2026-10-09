# Phase 6.11 — TypeScript Compiler V2

`IncrementalSyntheticCompiler` preserva o compilador anterior como referência e especializa somente o provider sintético.

## Mudanças

- percurso sequencial por níveis;
- coordenadas de deal/history derivadas do ordinal;
- filhos contíguos sem `transition` repetido;
- IDs de infoset diretos;
- buffers exatos com overflow/budget antes da alocação;
- utility/chance sem token arrays e `split` intermediários;
- reachability, normalização, zero-sum e claims de informação preservados;
- SHA-256 sobre metadata e todos os arrays.

| Escala | Nós | Baseline mediana | V2 mediana | Speedup |
|---|---:|---:|---:|---:|
| S3 | 32.765 | 262,263 ms | 91,450 ms | 2,87× |
| S4 | 131.069 | 979,122 ms | 419,421 ms | 2,33× |
| S5 | 2.097.149 | 16.569,014 ms | 5.667,428 ms | 2,92× |

Duas execuções por célula. S5 baseline: 16.325,619–16.812,410 ms, σ 243,395 ms. V2: 5.273,086–6.061,770 ms, σ 394,342 ms.

V2, baseline e cache TypeScript produziram o mesmo structural hash, solver state hash e métricas.