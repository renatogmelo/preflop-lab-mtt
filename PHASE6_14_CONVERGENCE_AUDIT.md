# Fase 6.14 — Auditoria de convergência

Baseline auditado: `e5cc8e22126cfa2707fbdc8918582931a91f1b05`.

Foram revisados os documentos 6.11–6.13, os três motores CFR, regret matching, estratégia média, alcances, EV, best response, NashConv, exploitability, Checkpoint V5, caches estruturais V1/V2 e Resource Policy V3.

## Estado encontrado

A Fase 6.13 corrigiu a atualização intra-infoset e provou equivalência por iteração com uma referência independente. O motor compacto já coletava métricas pontuais, mas não existia uma configuração long-run versionada, scheduler, separação formal entre comparações por iteração e por tempo, classificação de platô, análise de taxa, manifesto de falhas ou séries próprias para visualização.

O Checkpoint V5 armazenava integralmente regrets e strategy sums e retomava deterministicamente. Os caches V1/V2 armazenavam apenas topologia; portanto, a composição correta é carregar a representação e restaurar o estado numérico V5, sem permitir que chunk size ou política de crescimento alterem a semântica.

## Convenções preservadas

- Perfil congelado durante a atualização de cada jogador.
- Atualização alternada P0/P1.
- NashConv como soma dos ganhos de desvio; exploitability igual a NashConv/2.
- Estratégia média como objeto de avaliação principal; estratégia instantânea permanece diagnóstico.
- CFR+ com recorte agregado e média linear; DCFR com descontos antes da iteração.
- Igualdade bit a bit para execução contínua versus resume no mesmo contrato determinístico.

Nenhuma mudança algorítmica foi necessária na 6.14. O trabalho é infraestrutura experimental e observabilidade, não ajuste de curvas.
