# Preflop ↔ Postflop Coupling

## O problema

Os ranges que chegam ao flop são produzidos pela estratégia preflop. Ao mesmo tempo, a estratégia preflop depende do valor das continuações pós-flop. Resolver uma continuação uma vez e congelá-la sem declarar essa aproximação quebra essa dependência circular.

## Arquitetura implementada na Fase 4

`ContinuationRequest` transporta estado, ranges, board, posição, histórico e o identificador da abstraction. `ContinuationResult` devolve utilities zero-sum, modelo, confiança, metadata e `computationId`. O hash do cache inclui board, pote, stacks, ranges quantizados a `1e-9`, posição, abstraction e configuração.

O primeiro Level 2 é deliberadamente pequeno: dois ranges degenerados (um combo por jogador), flop fixo, turn e river enumerados, checks forçados no flop/turn e uma aposta de meio pote no river. Ele prova a interface e a matemática; não representa uma solução geral de NLHE.

## Acoplamento iterativo proposto

1. Inicializar uma estratégia preflop explicitamente identificada.
2. Derivar ranges condicionais por `reach × strategy`, com card removal.
3. Agrupar apenas estados de continuação compatíveis com a abstraction declarada.
4. Resolver cada subgame e armazenar artefatos por hash completo.
5. Recolocar as utilities nos leaves preflop.
6. Resolver novamente o preflop.
7. Repetir até que estratégia preflop, ranges e continuation values estabilizem dentro de thresholds prévios.

Não há prova de convergência desta decomposição na implementação atual. Ela pode oscilar ou convergir para um ponto dependente da decomposição. Por isso o loop ainda é pesquisa, não `Verified`.

## Alternativa: árvore unificada

Uma árvore única preflop + postflop remove a interface aproximada e deixa o CFR propagar valores diretamente. A vantagem é coerência matemática. O custo é a explosão combinatória de deals privados, 22.100 flops possíveis antes de blockers, turn/river, ranges combo-level e branches de apostas. Mesmo com poucas apostas, a árvore excede o que a implementação tabular TypeScript deve materializar.

O caminho defensável é validar primeiro subgames enumerados, depois chance sampling contra versões enumeradas pequenas e, somente então, decidir entre decomposição iterativa e traversal unificado nativo.

## Estado honesto

- Level 0 `strength-proxy-v1`: baseline heurístico, Experimental.
- Level 1 `equity-provider-v1`: equity real, mas sem estratégia futura, Experimental.
- Level 2 `solved-subgame-provider-v0`: subgame estratégico real, mas restrito ao cenário/abstraction exatos, ainda Experimental.
- Integração completa de ranges preflop dinâmicos com todos os flops: pendente.
