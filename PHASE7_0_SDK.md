# Research Engine 1.0 — SDK TypeScript

```ts
import { createResearchSdk } from "preflop-lab/research";

const sdk = createResearchSdk({ workspaceRoot: process.cwd() });
const result = await sdk.run(configuration, {
  onProgress: (event) => console.log(event.type, event.progress),
});

if (!result.ok) console.error(result.error.code, result.error.message);
```

`PreflopResearchSdk` encapsula `ResearchEngine` e retorna unions discriminadas, sem duplicar solver ou avaliação. Métodos: `capabilities`, `validate`, `compile`, `createExperiment`, `runExperiment`, `run`, `status`, `cancel`, `checkpoint`, `resume`, `results`, `verify` e `doctor`.

Eventos usam `research-event-v1` e contêm sequência, tipo, identidade, estado, iteração, total, progresso, timestamp e métricas opcionais. O callback é observacional; eventos também são persistidos em NDJSON.

Os modelos para a futura UI incluem `FutureUiExperimentSummary` e `FutureUiExperimentDetails`, cobrindo lista/detalhe, progresso, convergência, comparação, validação, histórico de checkpoint, diagnósticos e recursos. A Fase 7.0 não implementa UI visual.

Dez exemplos executáveis estão em `examples/research-engine/`: validar, compilar, executar os três algoritmos, consultar métricas, checkpoint, resume, comparação e verificação. A suíte da Fase 7.0 executa todos automaticamente.
