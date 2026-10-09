# Fase 6.13 — Especificação matemática formal

Versão: `phase6.13-formal-spec-v1`. Escopo: jogos extensivos finitos, de dois jogadores, soma zero, informação imperfeita, recordação perfeita e nós de chance explícitos.

## Definições

1. **Jogadores:** `N={0,1}` e chance `c`, que não maximiza utilidade.
2. **História:** sequência finita de ações `h`; a história vazia `∅` é a raiz.
3. **Prefixo:** `h ⊑ z` indica que `h` antecede uma história terminal `z`.
4. **Ações legais:** `A(h)` é um conjunto finito, não vazio em toda história não terminal.
5. **Função de jogador:** `P(h)∈{0,1,c}` identifica quem atua em `h`.
6. **Terminais:** `Z` contém histórias sem ações legais.
7. **Utilidade:** `u_i(z)` é finita e `u_0(z)+u_1(z)=0` para todo `z∈Z`.
8. **Chance:** `f_c(a|h)≥0` e `Σ_a f_c(a|h)=1` em cada nó de chance.
9. **Infoset:** partição das histórias de decisão de um jogador; todos os nós de `I` têm mesmo ator e ações na mesma ordem semântica.
10. **Recordação perfeita:** dois nós no mesmo infoset preservam a sequência de infosets e ações anteriores do próprio jogador.
11. **Estratégia comportamental:** `σ_i(I,a)≥0` e `Σ_a σ_i(I,a)=1`.
12. **Perfil:** `σ=(σ_0,σ_1)`; `σ_{-i}` denota a estratégia do oponente.
13. **Alcance:** `π^σ(h)=π_c(h)π_0^σ(h)π_1^σ(h)`.
14. **Alcance contrafactual:** para atualizar `i`, `π_{-i}^σ(h)=π_c(h)π_j^σ(h)`, `j≠i`.
15. **Valor do nó:** `v_i^σ(h)=Σ_a σ_{P(h)}(a|I(h))v_i^σ(ha)`, com expectativa de chance e caso-base `u_i(z)`.
16. **Valor contrafactual de ação:** soma dos valores de `ha` ponderada pelo alcance contrafactual das histórias do infoset; o incremento de regret é `r_i^t(I,a)=v_i^{σ^t}(I,a)-v_i^{σ^t}(I)`.
17. **Regret cumulativo e regret matching:** `R_i^T(I,a)=Σ_t r_i^t(I,a)` e `σ^{T+1}(I,a)=R_+ / ΣR_+`; se o denominador for `≤1e-15`, usa-se uniforme.
18. **Estratégia média, BR e métricas:** a média acumula a estratégia ponderada pelo alcance próprio (o fator fixo de chance por infoset é admitido e cancela na normalização). `BR_i(σ_{-i})=max_{σ'_i}u_i(σ'_i,σ_{-i})`; `NashConv(σ)=Σ_i(BR_i-u_i(σ))`; em dois jogadores soma zero, `exploitability=NashConv/2`.

## Convenções dos algoritmos

- Uma iteração executa atualização alternada de P0 e P1.
- O perfil fica congelado durante cada travessia de um jogador. Incrementos de todos os históricos do mesmo infoset são somados antes de alterar regrets.
- A atualização de P1 observa o estado já atualizado por P0 na mesma iteração.
- CFR usa regrets cumulativos sem recorte e peso de média 1.
- CFR+ aplica `R←max(0,R+ΔR)` depois da travessia e usa peso linear `max(0,t-delay)` no índice `t` iniciado em 1.
- DCFR desconta antes das duas travessias: positivos por `t^α/(t^α+1)`, negativos por `t^β/(t^β+1)` e soma de estratégia por `((t-1)/t)^γ`. Padrão: `α=1.5`, `β=0`, `γ=2`.
- Entradas não finitas, chance não normalizada, ciclos, terminais não soma-zero e infosets inconsistentes são erros; não há correção silenciosa.

## Limite da especificação

Ela não cobre jogos infinitos, mais de dois jogadores, utilidade geral, recordação imperfeita, amostragem Monte Carlo, abstração de poker ou prova assintótica da implementação. Essas extensões não podem herdar os resultados da Fase 6.13.
