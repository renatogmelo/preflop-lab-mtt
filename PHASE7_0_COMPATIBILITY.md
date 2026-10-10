# Research Engine 1.0 — Compatibilidade de formatos

| Formato | Estado 1.0 | Migração |
|---|---|---|
| Provider Contract V2 | leitura por adaptador delegante | nenhuma; V3 adiciona metadata/capabilities |
| Provider Contract V3 | nativo | schema novo, sem regravar V2 |
| Compiler V2 | fast path preservado | nenhuma |
| Generic Compiler V3 | caminho genérico preservado | nenhuma |
| Structural Cache V1 | leitura compatível preservada | nenhuma |
| Structural Cache V2 | nativo, formato inalterado | nenhuma |
| Checkpoint V5 | nativo, formato inalterado | nenhuma |
| Run Manifest 6.15 | histórico preservado | não convertido automaticamente |
| Experiment V1 | novo contrato público | não se aplica |
| Result V1 | novo contrato público | não se aplica |

O `solverVersion` avança para `1.0.0`; versões estruturais e matemáticas internas continuam explícitas (`compact-cfr-v0.13.0`, Compiler V2/V3, Cache V1/V2 e Checkpoint V5). Compatibilidade é decidida por identidade, versão do algoritmo, game hash e configuration hash, nunca apenas pelo nome do provider.

Mudança breaking na Public API, Experiment V1, Result V1 ou Provider V3 exige major version. Campos opcionais compatíveis podem entrar em minor. Deprecações precisam de aviso e caminho de migração por pelo menos uma minor. Interfaces internas e experimentais não recebem garantia pública.
