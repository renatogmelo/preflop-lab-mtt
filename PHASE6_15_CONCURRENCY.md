# Fase 6.15 — Concorrência e scheduler recovery

Locks são diretórios criados atomicamente pelo filesystem e contêm owner/PID. Dois processos reais disputaram o mesmo target: o primeiro adquiriu e o segundo recebeu `CONCURRENT_WRITER`. Release é idempotente.

Após crash com lock retido, o recovery verifica o PID; somente owner comprovadamente morto permite limpar o stale lock. Lock sem owner legível falha fechado.

O scheduler descobre manifestos, valida checksum/status, aplica retry limit 3, ignora terminais, impede duplicatas e relata `resumed`, `failed`, `skipped` ou `duplicate-prevented`. Ele não trata exit do child como conclusão sem manifesto/evidência.
