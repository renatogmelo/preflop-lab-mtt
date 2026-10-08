# Phase 6.8 Memory Architecture

## Representações

A implementação de referência continua orientada a objetos. A versão otimizada usa topologia compilada compartilhada, IDs numéricos de information sets e arrays tipados (`Uint8Array`, `Int8Array`, `Uint16Array`, `Uint32Array`, `Int32Array`, `Float64Array`). O custo da topologia indexada convergiu para aproximadamente 40 bytes por nó.

| Nível | Bytes indexados | Maior heap observado entre os três runs |
|---|---:|---:|
| S0 | 2.108 | 13.344.648 |
| S1 | 20.348 | 15.208.472 |
| S2 | 327.548 | 51.802.952 |
| S3 | 1.310.588 | 183.102.704 |
| S4 | 5.242.748 | 421.613.984 |

O heap inclui definição, árvore compilada, estratégias, checkpoints, avaliadores e objetos temporários; portanto não equivale ao tamanho dos arrays. A medição é amostrada entre checkpoints e pode perder picos entre amostras.

## Decisão arquitetural

Não foi criada uma Compiled Tree V2 adicional: o profiling mostrou que a representação `indexed-f64-v1` existente já entrega equivalência e speedup relevante. Reescrever tudo simultaneamente aumentaria risco sem isolar o ganho. O próximo experimento deve atacar a árvore objeto/materialização — lazy traversal, construção iterativa ou representação declarativa compacta — mantendo o solver de referência como oracle.

