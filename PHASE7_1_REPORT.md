# Preflop Lab — Research Console 1.0.0 (Fase 7.1)

Baseline: `4c128679cf51f49dc85b45a35c0cd5b913cb7e95`.

## Resultado

Foi entregue um console web funcional, responsivo por contrato CSS e conectado à SDK real do Research Engine. A computação fica no worker isolado; o navegador consome REST/SSE. Nenhum algoritmo, range ou formato histórico foi alterado.

## Respostas obrigatórias

1. Sim, a interface e o backend local estão funcionais; inspeção visual automatizada ficou não testada por ACL.
2. Overview, Experiments/list/detail, New Experiment, Algorithms, Game Explorer, Results/list/detail, Checkpoints, Diagnostics e Settings.
3. 26 componentes visuais.
4. Sim; o sidecar instancia `createResearchSdk`.
5. Sim, com validação Experiment V1 e persistência real.
6. Sim: Vanilla CFR, CFR+ e DCFR via worker isolado.
7. Sim, por SSE com replay persistido e sequência ordenada.
8. Sim, apenas séries reais do Result V1.
9. Sim, com aviso para configurações não equivalentes.
10. Sim, JSON integral e CSV numérico com proveniência.
11. Sim; checkpoint/cancel/resume passaram no E2E real.
12. Sim; estado é reconstruído pelo backend após refresh.
13. Origin, guard POST, limite de body, IDs, paths derivados, providers built-in, cap de árvore e Resource Policy passaram.
14. 9/9 E2E de API/engine passaram; browser clique-a-clique ficou NOT TESTED.
15. 310 TypeScript + 3 Rust; release focal histórico 80/80.
16. U1–U7 PASS; U8 e U9 PARTIAL pela ausência de Browser QA, sem falha funcional conhecida.
17. Consulte `PHASE7_1_LIMITATIONS.md`.
18. `npm run research:console`, depois `http://localhost:3000/research`.
19. Base pronta para Browser QA, empacotamento desktop e futura autenticação/serviço remoto sem expor o engine.
20. Commit final é informado após commit/push.

## Gates

| Gate | Estado | Evidência |
|---|---|---|
| U1 Engine Integration | PASS | SDK real, quatro providers, 13 capabilities e 14 operações públicas preservadas |
| U2 Experiment Management | PASS | create/list/search/filter/detail persistidos |
| U3 Live Execution | PASS | worker real + SSE + eventos duráveis |
| U4 Convergence Visualization | PASS | Canvas sobre Result V1, sem valores artificiais |
| U5 Results & Artifacts | PASS | JSON/CSV/checksum E2E |
| U6 Checkpoint & Recovery | PASS | cancel/resume real com Checkpoint V5 |
| U7 Security & Resource Safety | PASS | guards e Resource Policy testados |
| U8 Responsive & Accessible UI | PARTIAL | implementação/lint PASS; Browser visual NOT TESTED |
| U9 End-to-End Validation | PARTIAL | engine/API E2E PASS; browser navigation NOT TESTED |

Gate D histórico permanece FAIL e datasets Verified permanecem zero.
