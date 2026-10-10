# Fase 7.1 — Checkpoint e Recovery

- A listagem mostra arquivo V5, iteração quando identificável, tamanho, data e elegibilidade.
- Checkpoint manual apenas é solicitado em execução `running`; outros estados exibem a geração mais recente.
- Cancelamento é cooperativo e não é apresentado como concluído antes do status terminal do backend.
- Resume usa a operação pública da SDK, que seleciona e valida a geração V5 mais recente.
- Checkpoint incompatível ou corrompido continua falhando fechado no engine.

O E2E da fase executou: run ativo → checkpoint real → cancelamento → estado `cancelled` → resume → evento `RECOVERY_STARTED` → resultado completo. O teste não altera o formato V5.
