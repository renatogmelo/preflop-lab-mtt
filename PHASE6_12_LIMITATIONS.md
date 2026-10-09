# Fase 6.12 — Limitações

- Shared-view não torna typed arrays fisicamente read-only. O lease detecta alteração quando auditado, mas não impede escrita arbitrária.
- O buffer completo do cache permanece retido durante a vida das views.
- Não há mmap e não há alegação de zero-copy de ponta a ponta.
- Checksum SHA-256 e structural hash fazem duas passagens importantes pelo payload; continuam sendo o gargalo de validação.
- Streaming validation não melhorou o tempo nesta amostra.
- Generic V3 é cerca de 6,69× mais lento que V2 no S3 regular. V2 deve permanecer no dispatch.
- O benchmark irregular intermediário tem 40.745 nós; esta fase deliberadamente não forçou milhão de nós.
- A estimativa de providers desconhecidos usa teto conservador e watchdog, não contagem exata.
- O oracle por enumeração de políticas puras cresce combinatoriamente e só é independente em fixtures pequenos.
- A auditoria de vazamento privado depende de o provider preencher corretamente o contrato de observação; inconsistências são rejeitadas, mas o compilador não pode inferir semântica que o provider omite.
- A compatibilidade V1 mantém o custo de cópia do decoder antigo.
- Resultados são da máquina e runtime registrados no artefato; não constituem promessa universal de performance.
- Gate D histórico continua FAIL e nenhum dataset foi promovido para Verified.
