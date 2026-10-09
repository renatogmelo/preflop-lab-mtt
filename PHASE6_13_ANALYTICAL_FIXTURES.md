# Fase 6.13 — Fixtures analíticas

Cinco famílias foram usadas:

1. Matching Pennies: informação oculta, equilíbrio uniforme e valor zero.
2. Rock–Paper–Scissors: três ações, equilíbrio uniforme e valor zero.
3. Jogo sequencial de informação perfeita: decisões condicionais distintas de P1.
4. Jogo de informação oculta: chance privada, ranges de decisão distintos para P0 e infoset compartilhado por P1.
5. Chance não uniforme: probabilidades `0.8/0.2`, utilidades positivas e negativas e ação ótima conhecida.

Matching Pennies e RPS produziram NashConv e exploitability zero nas estratégias analíticas. Todas as fixtures passaram por compilação genérica, diferencial de iteração e validação independente de EV/BR. Elas exercitam somente o domínio matemático declarado; não representam ranges de poker.
