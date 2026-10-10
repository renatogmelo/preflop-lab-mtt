# Fase 6.15 — Auditoria de confiabilidade

Baseline auditado: `c53579bd7b8d68d6bf7b48f4c68292b70099d1a2`.

Foram revisados os relatórios 6.10–6.14, validação/progresso, Compiler V2/V3, Structural Cache V1/V2, shared views, Checkpoint V5, Resource Policy V3, isolated runner, watchdog e scheduler 6.14.

## Falhas reais encontradas no baseline

- Checkpoint V5 era correto e checksummed, mas o writer mantinha apenas target/backup transitório e apagava o backup após sucesso; não havia gerações duráveis.
- `recoverAtomicCheckpoint` restaurava `.bak` apenas quando o target faltava; target presente porém corrompido não causava seleção automática do backup.
- Não havia manifesto durável ligando run, commit, algoritmo, topologia, budgets, checkpoint e histórico de recovery.
- O scheduler 6.14 mantinha estado somente em memória e não descobria runs interrompidos.
- Não havia lock interprocesso para impedir dois writers no mesmo checkpoint/manifesto.
- Shared view possuía checksum e release, mas sem ownership, geração ou registro de leases.
- Falhas eram majoritariamente mensagens livres, sem código estruturado uniforme.
- O checksum V5 protege arrays; o hash semântico protege identidades selecionadas e índices, mas não substitui um checksum do arquivo inteiro.
- `file.sync()` era usado, porém não havia evidência de fsync do diretório ou garantia contra queda de energia.

## Correções

Foram adicionados state machine explícito, manifesto checksummed, escrita atômica, lock visível ao SO, detecção segura de lock órfão com PID morto, gerações V5, descoberta/validação de candidatos, fallback, scheduler de recovery, leases gerenciados, códigos estruturados e crash injection em processos reais.

Checkpoint V5, caches e algoritmos permaneceram compatíveis; nenhum formato histórico foi reescrito.
