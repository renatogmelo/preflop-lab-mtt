# Fase 7.1 — Integração com o Research Engine

O console usa `createResearchSdk({ workspaceRoot })`; não contém CFR, CFR+ ou DCFR próprios.

## API local

- `GET /health`, `/capabilities`, `/doctor`, `/overview`, `/games`.
- `POST /validate`, `/compile`, `/experiments`.
- `GET /experiments` e `/experiments/:runId`.
- `POST /experiments/:runId/{run,cancel,checkpoint,resume,verify}`.
- `GET /experiments/:runId/{events,result,export}`.
- `GET /games/:provider/tree` com limite rígido.

Todos os resultados matemáticos, preflight, status, eventos, checkpoints e artefatos vêm da SDK/engine reais. O adapter apenas serializa, pagina e projeta dados persistidos para a UI.

## Eventos

SSE retransmite o NDJSON persistido com `id=sequence`, replay por `Last-Event-ID`, heartbeat e fechamento em estado terminal. Refresh reconstrói o estado por status + configuração + eventos + resultado, não pelo stream transitório.

## Execução local

`npm run research:console` inicia API em `127.0.0.1:8788` e Vinext em `localhost:3000`. O sidecar é intencional: o worker web do Sites não deve receber acesso a `child_process` ou ao filesystem do Research Engine.
