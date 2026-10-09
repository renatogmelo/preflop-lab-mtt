# Fase 6.13 — CFR de referência

`IndependentReferenceCfr` é uma implementação pequena e deliberadamente lenta. Ela percorre diretamente `ExtensiveGameProviderV2`, valida a árvore e mantém por infoset ações, regrets e somas de estratégia. Não usa Compiler V2/V3, `CompactIndexedTree`, typed arrays do solver, `CompactCfrSolver` nem avaliadores compartilhados.

Cada atualização cria um snapshot de regret matching, percorre toda a árvore, registra alcances, valores de ação, valor do nó, incremento de regret e contribuição para a média, e aplica os deltas somente no fim. O trace completo permite localizar a primeira divergência por iteração.

Oráculos executados em `t=0,1,2,25` e em fixtures com chance não uniforme, informação oculta e infosets repetidos coincidiram exatamente com o motor compacto corrigido. O maior delta observado de regrets e strategy sums foi `0`.
