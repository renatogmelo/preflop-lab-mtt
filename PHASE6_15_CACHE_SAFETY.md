# Fase 6.15 — Cache e shared-view safety

Structural Cache V1 e V2 permanecem compatíveis. V2 continua validando schema, identity, SHA-256 completo, offsets, alinhamento, bounds, invariantes e structural hash. Cache importado continua exigindo verificação semântica conforme a política da Fase 6.12.

O registro de leases adiciona `leaseId`, owner, generation e cache identity. Uso com owner/generation incompatível é rejeitado; gerações antigas são invalidadas; checksum detecta alteração indevida.

Typed arrays JavaScript não são fisicamente read-only. Shared view evita cópia explícita do payload, retém o buffer e usa proteção lógica/detecção. Safe-copy permanece a opção quando isolamento por cópia é necessário.
