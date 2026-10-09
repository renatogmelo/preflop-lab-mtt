# Phase 6.11 — Rust Performance Spike

## Escopo

Crate: `solver/native/phase611-compiler`. É uma CLI isolada que implementa apenas provider sintético, enumeração, successors, infoset registry, topology, overflow checks, checksum e export binário. Não contém CFR, UI, autenticação ou poker strategy. Não possui dependências externas e proíbe `unsafe`.

A integração escolhida foi processo nativo + protocolo binário. Bindings foram evitados porque aumentariam complexidade antes de existir ganho comprovado.

## S5 instrumentado

- compilação Rust interna: 8.961,909 ms;
- serialização/checksum: 245,579 ms;
- escrita atômica: 1.709,716 ms;
- startup/protocolo fora do total nativo: 50,539 ms;
- load, checksum, reconstrução e validação TS: 4.398,348 ms;
- validação dentro desse load: 4.352,665 ms;
- total de integração observado: 12.477,777 ms nessa execução;
- mediana da matriz: 14.288,369 ms;
- output nativo: 59.768.820 bytes;
- pico RSS mediano do pipeline: 283,18 MiB.

Rust superou o baseline frio S5 em 1,16×, mas foi 2,521× mais lento que o TypeScript V2. H5 e H6 foram rejeitadas.

## Segurança

Contagens usam `checked_*`; limites u32/u16/i32 são verificados antes da alocação. Escrita usa arquivo temporário exclusivo, sync e rename. Falhas retornam exit code não-zero; corrupção/identity mismatch são recusados pelo consumidor TypeScript. S5 rodou com preflight, tier2 explícito, processo isolado e watchdog.