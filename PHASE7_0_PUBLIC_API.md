# Research Engine 1.0 — Public API V1

Versão: `research-api-v1`. Importação estável: `preflop-lab/research` ou `solver/research/public/index.ts` no monorepo.

## Operações públicas

| Operação | Entrada | Saída | Efeito colateral principal |
|---|---|---|---|
| `getCapabilities()` | nenhuma | capabilities, algoritmos, providers, formatos e escopo | nenhum |
| `registerProvider(provider)` | Provider V3 confiável | relatório do contrato | registro em memória |
| `validateProvider(provider)` | Provider V3 | identidade/capabilities/issues | nenhum |
| `validateGame(config)` | Experiment V1 desconhecido | estrutura, hipóteses, preflight e diferencial pequeno | compila em memória |
| `compileGame(config)` | Experiment V1 | resumo imutável de compiler/topologia | compila em memória |
| `createExperiment(config)` | Experiment V1 | `experimentId` e `runId` | grava configuração, índice, status e evento |
| `runExperiment(handle)` | handle persistido | status + Result V1 | cria processo isolado, checkpoints e artefato |
| `getExperimentStatus(runId)` | id seguro | Status V1 | leitura |
| `cancelExperiment(runId)` | id ativo | status `cancelling` | cria marcador cooperativo |
| `checkpointExperiment(runId)` | id | confirmação ou último checkpoint | solicita Checkpoint V5 |
| `resumeExperiment(runId)` | id interrompido/completo | novo resultado do mesmo run | valida/restaura Checkpoint V5 em worker |
| `getExperimentResults(runId)` | id completo | Result V1 verificado | leitura + checksum |
| `verifyArtifact(path)` | path relativo ao workspace | artefato verificado | leitura |
| `doctor()` | nenhuma | diagnóstico estruturado | apenas probe de escrita removido em seguida |

## Garantias comuns

- Entradas externas são validadas em runtime antes de compilar ou executar.
- Falhas usam `ResearchEngineError` com código estável; a SDK oferece `ResearchOperationResult<T>` discriminado.
- Resultados incompletos não são retornados como `ResearchResultV1` completo.
- Arrays e buffers internos nunca são expostos.
- Output e verificação ficam confinados ao workspace; paths absolutos, `..` e symlinks são rejeitados.
- Execução numérica ocorre em processo filho; o processo chamador mantém watchdog e estado durável.
- A API não certifica poker e não transforma validação sintética em `Verified`.

## Erros

`VALIDATION_ERROR`, `UNSUPPORTED_CAPABILITY`, `INVALID_CONFIGURATION`, `RESOURCE_LIMIT`, `COMPILATION_ERROR`, `EXECUTION_ERROR`, `CHECKPOINT_ERROR`, `CACHE_ERROR`, `RECOVERY_ERROR`, `ARTIFACT_ERROR` e `INTERNAL_ERROR`.

Cada erro contém `code`, mensagem compreensível, detalhes não sensíveis e `recoverable`. Erros não são convertidos em resultados válidos.

## Configuração V1

`research-experiment-v1` inclui provider, algoritmo/parâmetros, budgets de iteração/runtime/memória, tier, agenda de avaliação/checkpoint, diretório relativo e opções de validação. Mudanças breaking exigirão nova versão do schema.

## Resultados e classificação

`research-result-v1` separa conclusão, métricas, convergência, runtime/memória, checkpoints, evidência e limitações. Os níveis são `unvalidated`, `structurally-validated`, `differentially-validated`, `analytically-validated` e `reproducible-research-result`; nenhum equivale a certificação de poker. O indicador histórico `Verified` continua separado e em zero.

## Limites

A API estável cobre apenas jogos finitos sintéticos, dois jogadores, soma zero, recordação perfeita e chance explícita. Providers programáticos são confiáveis pelo host; a CLI não carrega código externo. Consulte `PHASE7_0_LIMITATIONS.md`.
