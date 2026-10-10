# Fase 6.15 — Reprodutibilidade

Vanilla CFR, CFR+ e DCFR foram executados duas vezes em processos Node novos. Configuration hash, structural hash, initial/final state hash, regrets, strategy sums, average strategy, EV e NashConv foram bit a bit iguais no ambiente disponível.

Ambiente testado: Windows `win32/x64`, Node `v24.20.0`, Cache V1/V2 e múltiplas escalas/growth segmentado. Outros sistemas operacionais e versões Node estão `NOT TESTED`.

Reprodução:

- `npm run solver:phase6-15`
- `node --import tsx --test tests/solver-phase6-15.test.mjs`
- `npm run check`
- `cargo test --manifest-path solver/native/phase611-compiler/Cargo.toml --release`
