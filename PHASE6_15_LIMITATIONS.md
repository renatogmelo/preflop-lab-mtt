# Fase 6.15 — Limitações

- Não houve teste de queda de energia, fsync de diretório ou garantia do storage controller.
- RSS e heap são observações; Windows não usa Job Object hard cap nesta implementação.
- Apenas Windows/Node disponível foi executado; cross-OS e outras versões Node estão `NOT TESTED`.
- O caso irregular de ~1,07M nós foi corretamente negado e não materializado.
- Shared typed arrays continuam mutáveis; leases oferecem ownership, invalidação e detecção, não read-only físico.
- Lock órfão só é removido quando o owner PID é legível e comprovadamente morto; estado ambíguo falha fechado.
- Testes de crash cobrem pontos declarados, não toda falha possível de kernel/filesystem/hardware.
- O escopo matemático permanece sintético, dois jogadores, soma zero e recordação perfeita.
- Nenhuma estratégia/range de poker foi validada; Gate D segue `FAIL` e `Verified=0`.
