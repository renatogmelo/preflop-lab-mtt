# Fase 6.12 — Auditoria de Arquitetura

## Baseline auditado

Commit obrigatório: \`36b38a58eed84d6ab7719a49e7484994cb24dc34\`.

Foram lidos integralmente os relatórios 6.11 de compilação, otimização TypeScript, construção incremental, cache, validação cross-language, performance e limitações; a decisão Rust; a política de recursos 6.10; o checkpoint binário; e o progresso do projeto.

A arquitetura inicial era:

\`SyntheticCompactProvider regular → Compiler V2 com tamanho exato → Structural Cache V1 → CompactCfrSolver → Checkpoint V5\`.

## Constatações

O Compiler V2 é correto e rápido porque conhece a topologia regular e pré-aloca exatamente os arrays. Essa vantagem não generaliza para providers com branching, profundidade ou chance irregulares. Substituí-lo por uma implementação genérica criaria uma regressão desnecessária; por isso a fase mantém dois caminhos.

O contrato legado mistura convenções da árvore compacta com o provider. O Provider Contract V2 agora expõe estado, actor, ações, transition, chance, information set, utility terminal, identidade semântica e capabilities sem exigir um layout físico.

A compilação genérica precisava resolver quatro riscos: índices instáveis durante crescimento; identidade de information sets dependente da ordem de alocação; providers não determinísticos; e budgets desconhecidos. O V3 usa expansão BFS determinística, buffers com índices estáveis, canonicalização semântica no final e checks de budget/runtime/cancelamento durante a expansão.

O Cache V1 é seguro, mas reconstrói os nove arrays por cópia. O Cache V2 alinha payloads, conserva SHA-256 completo, diferencia trust classes e permite views compartilhadas sob um lease. \`Object.freeze()\` não é tratado como proteção física dos bytes.

## Decisões

- Compiler V2 permanece o fast path da família regular declarada.
- Compiler V3 é o caminho seguro padrão.
- Dispatch por capabilities + configuration hash; nunca por nome de classe.
- Segmented buffers são a política genérica padrão.
- Cache V2 usa SHA-256 completo e validação estrutural obrigatória.
- Shared-view é opt-in, mantém o backing buffer vivo e oferece detecção de mutação por lease.
- Streaming significa hashing incremental; não significa leitura mmap nem ausência de alocação do arquivo.
- Rust continua oracle experimental: **KEEP TYPESCRIPT**.
- O domínio continua dois jogadores, soma zero.
- Nenhuma regra, range ou recomendação de poker foi modificada.

## Riscos residuais

Typed arrays compartilhados continuam mutáveis no JavaScript. O lease detecta mudança quando verificado, mas não impede escrita. Cache importado exige verificador semântico do provider. Oracles por enumeração pura só escalam em jogos pequenos. Providers desconhecidos recebem um teto conservador e watchdog, não uma promessa de estimativa exata.
