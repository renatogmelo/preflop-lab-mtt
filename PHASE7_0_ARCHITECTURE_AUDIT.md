# Fase 7.0 — Auditoria de arquitetura

Baseline obrigatório auditado: `be5bd289f339535c6cbf1fe5788a8564e923538e` (Fase 6.15, versão 0.15.0).

## Evidência revisada

Foram lidos integralmente os relatórios 6.9–6.15, a especificação e auditoria matemática 6.13, `SOLVER_VALIDATION.md`, `SOLVER_PROGRESS.md` e `PROGRESS.md`. O repositório contém uma aplicação Vinext/React e um solver TypeScript separado, com spike Rust diferencial. A Fase 7.0 não reorganiza o frontend nem altera dados de poker.

## Estado encontrado

| Fronteira | Implementação existente | Estado no baseline |
|---|---|---|
| Core | tipos de jogo, versão, hashing estável | maduro, mas exportado junto de internals |
| Providers | compacto sintético e Provider Contract V2 | validado para o escopo sintético |
| Compiler | V2 especializado e V3 genérico | ambos preservados e diferencialmente testados |
| Algorithms | CFR, CFR+ e DCFR compactos | corrigidos/validados nas Fases 6.13–6.15 |
| Evaluation | EV, BR, NashConv, exploitability | produção + oracles independentes |
| Execution | runner isolado 6.10 e scheduler 6.14/6.15 | poderoso, porém orientado às campanhas de fase |
| Persistence | Cache V1/V2, Checkpoint V5, manifestos 6.15 | formatos íntegros; sem API pública coesa |
| Experiments | runners específicos por fase | configurações não formavam um contrato público único |
| CLI | `solver/cli/index.ts` | CLI legada de solve/benchmark, sem workflow Research Engine |
| Package | `solver/index.ts` | exportava muitos detalhes internos mutáveis |
| Release | scripts e artefatos por fase | sem SemVer/API/SDK/release gate estáveis |

## Déficits confirmados

- Não havia Public API versionada ou SDK.
- Não havia Provider V3 nem negociação formal de capabilities.
- A CLI não possuía `info`, `capabilities`, `status`, `cancel`, `checkpoint`, `results` e `doctor` sob um contrato comum.
- Configurações externas não compartilhavam um schema runtime único.
- Eventos, resultados e erros não tinham contratos públicos estáveis.
- Os runners seguros eram específicos das campanhas e não compunham um workflow reutilizável.
- `package.json` não expunha uma superfície pública restrita.
- Não havia matriz formal de compatibilidade ou pipeline de release 1.0.

## Decisão arquitetural

Foi adicionada uma fachada em `solver/research/public/`, sem reescrever algoritmos, compiladores, caches ou checkpoints. Ela depende dos módulos validados; consumidores dependem apenas da fachada. O worker executa compilação e iterações fora do processo chamador, sob preflight, old-space, watchdog, cancelamento, limite de RSS observado e paths confinados ao workspace.

Provider V2 é adaptado por delegação explícita para V3. Fast Compiler V2 é escolhido somente quando a capability e o configuration hash já validados permitem; os demais providers usam Generic Compiler V3. Typed arrays não cruzam a API pública.

## Dependências permitidas

`Public API/SDK/CLI → validation/configuration → Provider V3 adapter → Compiler V2/V3 → Compact CFR → evaluation/checkpoint`.

O sentido inverso não existe. O frontend não depende da nova API nesta fase. Não há suporte multijogador, mudança de ranges, promoção de dataset ou alteração do Gate D.
