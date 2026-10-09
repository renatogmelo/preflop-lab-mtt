# Fase 6.12 — Performance

Todos os números são medianas de duas execuções em processos filhos monitorados, exceto validações matemáticas pequenas. Limite por processo: 768 MiB e 30 s.

## Compilação

No S3 regular, Compiler V2 levou 85,21 ms; Generic V3 segmentado levou 569,68 ms, cerca de 6,69× mais. Isto não é regressão do produto: o dispatch preserva V2 para providers regulares compatíveis. V3 é a alternativa para topologias desconhecidas.

No irregular de 40.745 nós, segmented levou 1.119,08 ms, geometric 1.279,34 ms e chunked 1.138,95 ms. Segmented teve menor cópia e menor RSS entre os três.

## Cache S5

| Loader | Startup | Pico RSS | Payload copiado |
|---|---:|---:|---:|
| V1 safe | 579,86 ms | 205.613.056 B | 59.768.748 B |
| V2 safe | 584,39 ms | 206.020.608 B | 59.768.748 B |
| V2 streaming safe | 587,11 ms | — | 59.768.748 B |
| V2 shared streaming | 559,33 ms | 146.014.208 B | 0 B |

O ganho de startup do shared-view contra V1 foi modesto (~3,5%); o ganho de RSS (~29%) é mais relevante. Checksum e structural hash continuam dominando o decode. Streaming não foi mais rápido nesta máquina, mas mantém hashing incremental e sem payload redundante.

O artefato preserva construction, validation, loading, solver initialization, traversal e checkpoint como etapas separadas. Nenhum resultado mistura o custo do cache quente do sistema operacional com mmap explícito.
