# Phase 6.11 — Structural Cache V1

O cache guarda topologia, registry, chance e terminal utilities. Regrets/strategy sums continuam no Checkpoint V5.

## Formato e identidade

Magic `PLSCV001`; schema/version; little-endian; identity/configuration/game/structural hashes; node/infoset counts; offsets, lengths e tipos; validation metadata; SHA-256 do payload.

Identidade: configuração completa, provider version, tree schema, action ordering e utility model. Node count isolado nunca autoriza reuso.

## Validação

Header, versão, endianness, identidade, total bytes, manifest, bounds, checksum, tipos, counts, child/chance/infoset invariants e structural hash são verificados antes de devolver a árvore.

## Write/recovery

Temporary exclusivo → write → sync → releitura validada → rename. Cache válido é imutável/content-addressed. Interrupção simulada limpa o temporário; `recoverStructuralCache` remove resíduos e valida o target.

## S5

- 59.772.069 bytes (~57,00 MiB);
- loads TypeScript: 746,942 e 697,642 ms; mediana 722,292 ms;
- 22,94× versus cold baseline;
- cache Rust-gerado: mediana 617,499 ms.

“Cold” significa processo novo, sem purge do page cache do SO. A segunda leitura não foi automaticamente mais rápida e não é vendida como prova de warm speedup.

Miss e invalidation retornam razões explícitas. O caller compila/grava uma nova chave; arquivo incompatível nunca vira fallback silencioso.