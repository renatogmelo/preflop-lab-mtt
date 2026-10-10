# Fase 7.1 — Limitações

- O console é local e requer Node; o Sites não hospeda o sidecar de execução isolada.
- Browser E2E visual e inspeção desktop/tablet/mobile ficaram `NOT TESTED` por ACL do ambiente.
- SSE usa polling do arquivo NDJSON a cada 250 ms no sidecar; é adequado ao single-user local, não a serviço distribuído.
- A listagem descobre índices persistidos do workspace; não existe operação de listagem na Public API V1.
- Maximum depth e catálogo agregado de actions não existem no resumo público compilado e não são inventados.
- Throughput é final no Result V1; durante execução, só métricas presentes no evento são exibidas.
- Tier 1/2 permanecem indisponíveis sem contrato de calibração.
- Escopo: jogos sintéticos finitos, dois jogadores, soma zero, recordação perfeita; sem multiplayer ou 8-max estratégico.
- Nenhuma estratégia/range de poker foi alterada ou certificada. Gate D continua `FAIL`; `Verified=0`.
- Cross-OS e outros Node além de Windows/x64 Node 24.20.0 permanecem não testados.
