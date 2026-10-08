# Phase 6.10 — Binary Checkpoint V5

## Formato

O V5 armazena um header fixo e metadata JSON pequena, seguidos de regrets e strategy sums em `Float64` little-endian. O header contém:

- magic `PLCPV5`;
- versão 5 e endianness;
- tamanho do header e payload;
- iteração e nós visitados em 64 bits;
- comprimentos dos arrays;
- checksum SHA-256 do payload;
- semantic state hash;
- game/configuration hashes;
- versões do solver, algoritmo e representação estrutural.

Layouts são explícitos e versionados. O reader recusa versão, algoritmo, jogo, estrutura ou tamanhos incompatíveis antes de restaurar o solver.

## Integridade

Testes cobrem arquivo truncado, payload alterado, versão incompatível, game hash incorreto, algoritmo incorreto, representação incompatível, comprimentos inválidos e `NaN/Infinity`. A retomada V5 restaura arrays diretamente e valida o hash semântico.

V4 permanece legível para checkpoints compactos 0.9.0 compatíveis. Um teste reconstrói sua identidade e confirma restauração após o bump 0.10.0.

## Comparação S4 no mesmo estado

| Métrica | V4 JSON | V5 binário | Variação |
|---|---:|---:|---:|
| Tamanho | 927.392 B | 349.995 B | -62,26% |
| Serialização | 13,8512 ms | 7,6247 ms | 1,82× / -44,95% |
| Desserialização | 4,6036 ms | 6,3500 ms | V5 1,75 ms mais lento |
| Memória temporária modelada | 1.276.896 B | 349.995 B | -72,59% |
| Validação de checksum | — | 1,3729 ms | custo explícito |

A melhora de tamanho/serialização não esconde a regressão de desserialização nesta amostra. O custo extra inclui checksum e validações do formato.

## Deterministic resume

`Continuous Run` e `Run → V5 → Resume` terminam com regrets, strategy sums, average strategy, iteração e state hash idênticos. Os dois runs S5 também produziram payload/semantic state equivalentes.

## Escrita atômica

O writer usa arquivo temporário, sync, leitura/validação, backup recuperável do alvo anterior, rename e cleanup. A simulação `after-backup` prova que o checkpoint válido anterior é recuperado.

Rename atômico depende das garantias do filesystem. No Windows, substituição de destino existente não possui exatamente as mesmas semânticas de todos os filesystems POSIX; o backup validado reduz o risco, mas não transforma falha de hardware em transação distribuída.
