# Fase 6.13 — CFR+ de referência

A variante declarada usa atualização alternada, regret matching+ e recorte `max(0,R+ΔR)` depois que todos os históricos do infoset foram agregados. O índice de iteração começa em 1. A média linear usa `w_t=max(0,t-delay)` e é acumulada na própria atualização do jogador.

Foram testados delay zero, peso zero quando `t≤delay`, vetores com regrets positivos/negativos/nulos, uma e múltiplas iterações, informação oculta, property games e retomada por Checkpoint V5. Referência e produção tiveram delta máximo `0`.
