# Phase 6.10 — Architecture Audit

## Baseline

O commit auditado foi `fdc8e9dd6c0628bd9281bb78cf1574208e5eb764`. A Fase 6.9 já possuía provider sintético compacto, compilação direta em typed arrays, CFR exato, Best Response V2, Checkpoint V4 e safe abort em 250.000 nós. S4 era a maior escala executada; S5 era recusado antes de alocar sua árvore.

## Achados iniciais

- O limite único de nós era seguro, mas incapaz de usar evidência real de memória e runtime.
- O estimador V2 calculava armazenamento lógico, não um pico de processo calibrado.
- Benchmarks anteriores compartilhavam o processo principal e podiam misturar memória residual de arquiteturas A/B/C.
- Checkpoint V4 convertia typed arrays para arrays/JSON, duplicando estado durante serialização.
- O core matemático compacto já era diferencialmente equivalente nas escalas viáveis; não havia razão para trocar algoritmo ou linguagem.

## Arquitetura entregue

```text
parent process
  ├─ Resource Policy V3 / preflight
  ├─ independent watchdog
  ├─ OS RSS sampler
  └─ child Node process
       ├─ protocol + heartbeat
       └─ Worker
            ├─ compact compilation
            ├─ structural/subtree validation
            ├─ CompactCfrSolver
            ├─ exact evaluation / BR V2
            ├─ Checkpoint V5
            └─ cleanup + memory samples
```

O heartbeat roda fora do Worker de cálculo. Assim, um traversal bloqueado não impede o pai de detectar timeout ou falta de resposta. O filho recebe uma única requisição serializada e recusa perfis sem `ALLOW`, tier correspondente, iteração autorizada e contagem compilada igual à estimada.

## Fronteiras preservadas

- `CompactGameProvider`, topologia e semântica CFR não foram alterados.
- `COMPACT_CFR_VERSION` permanece a identidade do algoritmo 0.9; `SOLVER_VERSION` passou a 0.10.0 para a infraestrutura.
- V4 permanece legível para checkpoints 0.9.0 compatíveis.
- Gate D continua FAIL; `Verified` continua 0.
- Nenhum range, frequência, sizing ou recomendação de poker mudou.

## Decisões

- TypeScript foi mantido: o profiling não justificou migração automática para Rust.
- Processos não são executados em paralelo durante a medição individual.
- Tier 2 não é default e aceita no máximo uma iteração.
- O pico usado para calibração é o maior entre amostra do SO e autorrelato, evitando tratar uma amostra espaçada como pico absoluto.

## Resultado da auditoria

A arquitetura compacta não exigia reescrita matemática. O problema real era operacional: isolamento, política multidimensional, calibração e checkpoint. A implementação da Fase 6.10 resolve essas lacunas e deixa a compilação S5 como gargalo mensurado.
