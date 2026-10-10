# Fase 6.15 — Failure Model

| Falha | Recuperável | Comportamento esperado | Estado persistente permitido |
|---|---|---|---|
| Encerramento normal | sim | `COMPLETED` com evidência | manifesto + gerações válidas |
| Cancelamento voluntário | sim | `CANCELLED`, sem promover parcial | último checkpoint válido |
| Timeout/watchdog | sim | filho encerrado, `INTERRUPTED` | último checkpoint válido + temporários |
| Memory/resource budget | sim antes da execução | negar/safe abort | manifesto diagnóstico |
| Crash/encerramento externo | sim | detectar ausência de conclusão | checkpoint atual ou anterior íntegro |
| Temporário incompleto | sim | ignorar e limpar | `.tmp` nunca é geração comprometida |
| Checkpoint truncado/corrompido | sim se houver geração anterior | rejeitar com código estruturado | arquivo rejeitado + anterior válida |
| Checkpoint incompatível | não automaticamente | rejeitar sem mutar solver | nenhum restore |
| Cache corrompido | recompilável | rejeitar `CACHE_CORRUPTED` | cache não confiável não é consumido |
| Cache incompatível | recompilável | rejeitar `CACHE_INCOMPATIBLE` | identity explícita preservada |
| Falha de serialização/persistência | sim se geração anterior existe | não atualizar manifesto | anterior válida |
| Falha de restore/avaliação/compilação | depende da causa | registrar e falhar fechado | sem `COMPLETED` falso |
| Writer concorrente | sim | rejeitar segundo writer | owner único |

Transições terminais não voltam a `RUNNING`. Apenas runs `RUNNING`, `CHECKPOINTING`, `INTERRUPTED`, `RECOVERABLE` ou `RESUMING` entram no fluxo de recovery.
