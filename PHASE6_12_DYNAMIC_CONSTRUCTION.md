# Fase 6.12 — Construção Dinâmica

O benchmark usa o jogo irregular intermediário com 40.745 nós, duas repetições isoladas por política e o mesmo teto conservador de 100.000 nós.

| Política | Tempo mediano | Eventos de crescimento | Bytes copiados | Fragmentação | Pico RSS |
|---|---:|---:|---:|---:|---:|
| Geometric | 1.279,34 ms | 70 | 3.137.056 | 694.148 B | 172.449.792 B |
| Chunked | 1.138,95 ms | 70 | 6.466.592 | 6.020 B | 181.946.368 B |
| Segmented | 1.119,08 ms | 63 | 1.303.840 | 6.020 B | 163.692.544 B |

Os 1.303.840 bytes do modo segmentado correspondem integralmente à cópia obrigatória de finalização para arrays compactos; ele não copia o payload antigo durante crescimento. Geometric copia durante realocações e deixa mais folga. Chunked reduz a folga, mas copia a cada extensão.

**Escolha:** segmented é o default do V3. Nesta amostra foi simultaneamente o mais rápido, o menor pico RSS e a menor cópia total. A política não muda hashes nem matemática.

Two-pass continua aplicável ao provider regular com contagem exata e é representado pelo fast path V2. Para providers desconhecidos, um primeiro passe completo duplicaria expansão e validações; por isso não é o default.

O compilador verifica cancelamento, runtime, profundidade e número máximo de nós por chunk. Se o teto é alcançado, libera o estado parcial e o isolated runner classifica \`structural-limit\`.
