# Fase 7.1 — Arquitetura do Research Console

Baseline: `4c128679cf51f49dc85b45a35c0cd5b913cb7e95`. Versão: Research Console 1.0.0.

## Decisão arquitetural

O frontend existente é Vinext/React 19. O console foi adicionado em `/research/:path*` sem substituir o Trainer. A computação não roda no navegador: um sidecar HTTP local em Node usa exclusivamente a SDK pública do Research Engine, que mantém compiler, algoritmos, Resource Policy, worker isolado, Checkpoint V5 e artefatos no backend.

```text
React/Vinext → REST + SSE → Console API local → SDK pública 1.0.0
                                               ├─ Resource Policy V3
                                               ├─ worker isolado
                                               └─ storage/checkpoint/result
```

## Rotas visuais

- `/research`: overview.
- `/research/experiments`: busca, filtros, ordenação e paginação.
- `/research/experiments/:runId`: execução, eventos, controles e resultado.
- `/research/new`: wizard de oito etapas.
- `/research/algorithms`: CFR, CFR+ e DCFR.
- `/research/games`: jogos sintéticos e árvore progressiva.
- `/research/results` e `/research/results/:runId`: resultados e comparação.
- `/research/checkpoints`: gerações V5.
- `/research/diagnostics`: doctor e capabilities.
- `/research/settings`: preferências locais não autoritativas.

## Superfícies

- 26 componentes visuais, incluindo 9 áreas de produto e componentes de chart, dialog, toast, loading, erros e estados vazios.
- `solver/research/console/server.ts`: adapter HTTP fino, sem matemática duplicada.
- `solver/research/console/contracts.ts`: DTOs exclusivos do console.
- `solver/research/console/dev.ts`: launcher local único para UI + API.

## Persistência e refresh

Experimentos, status, eventos, checkpoints e resultados são reconstruídos do workspace do engine. `localStorage` guarda apenas tema e preferências de gráfico/confirmação; nunca é a fonte de verdade das execuções.
