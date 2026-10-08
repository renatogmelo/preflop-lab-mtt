# Phase 6.8 Performance

## Comparação no mesmo ambiente

| Nível | Iterações diferenciais | Referência | Indexado | Speedup |
|---|---:|---:|---:|---:|
| S0 | 500 | 29,047 ms | 5,938 ms | 4,89x |
| S1 | 200 | 59,392 ms | 6,964 ms | 8,53x |
| S2 | 20 | 127,768 ms | 11,906 ms | 10,73x |
| S3 | 5 | 152,837 ms | 19,423 ms | 7,87x |
| S4 | 1 | 188,913 ms | 50,757 ms | 3,72x |

Os ganhos são medições pareadas desta máquina, não promessas portáveis. A equivalência diferencial passou antes de o ganho ser aceito.

## S4 por algoritmo

| Algoritmo | Runtime traversal | Nós/s | Exploitability | NashConv |
|---|---:|---:|---:|---:|
| Vanilla CFR | 563,432 ms | 930.504 | 0,15868198 | 0,31736395 |
| CFR+ | 526,276 ms | 996.200 | 0,10518346 | 0,21036691 |
| DCFR | 474,833 ms | 1.104.128 | 0,03978333 | 0,07956667 |

DCFR venceu em tempo e qualidade após duas iterações em S4. A amostra é curta por desenho; não autoriza afirmar superioridade universal. Em S1, CFR+ foi marginalmente mais rápido que DCFR, reforçando essa cautela.

## Perfil

O artefato separa geração, validação, compilação object/indexed, traversal, best response, checkpoint e serialização. Regret update e strategy accumulation são microkernels calibrados e explicitamente não somáveis ao wall-clock; GC não foi forçado e fica `null`.

O gargalo dominante é traversal/materialização. Em S4, compilar o objeto levou 109,056 ms, construir índices 96,429 ms e avaliar best response DCFR 196,463 ms. Paralelismo complexo foi adiado: primeiro é necessário reduzir a pressão estrutural preservando determinismo.

