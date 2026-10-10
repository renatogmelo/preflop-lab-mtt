# Research Engine 1.0 — Limitações

- O escopo matemático é finito, sintético, dois jogadores, soma zero, recordação perfeita e chance explícita.
- Não há solver multijogador, suporte estratégico 8-max ou generalização automática de CFR para multiplayer.
- Nenhuma estratégia/range de poker mudou ou foi certificada; Gate D segue `FAIL` e `Verified=0`.
- A validação independente por políticas puras é limitada a jogos pequenos pelo budget combinatório.
- Tier 1/2 genérico não é exposto sem contrato de calibração persistido; Public API V1 falha fechado.
- Windows usa old-space, watchdog e RSS observado, não Job Object com hard cap nativo.
- Durabilidade contra queda de energia, fsync de diretório e controladores de storage não foi demonstrada.
- Reprodutibilidade cross-OS/Node não foi testada; somente `win32/x64` e Node `v24.20.0` foram executados.
- Providers programáticos são confiáveis pelo host e não são sandboxed; a CLI só aceita providers built-in.
- A Public API é estável; módulos internos, benchmarks e campanhas continuam experimentais.
- Result V1 registra evidência do próprio run; não herda automaticamente `Verified` de datasets ou verdade de poker.
- A futura UI, multiplayer e integração com o Trainer ficam para fases posteriores.
