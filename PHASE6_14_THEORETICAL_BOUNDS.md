# Fase 6.14 — Bounds teóricos

Para jogos finitos de dois jogadores, soma zero e recordação perfeita, a decomposição de regret contrafactual do Vanilla CFR relaciona regret externo médio dos jogadores à explorabilidade da estratégia média. Sob utilities limitadas, o bound clássico decai na ordem de `O(1/√T)`, com constantes dependentes da amplitude de utility, quantidade de infosets e ações.

O projeto mede regrets cumulativos, escala de utility, iterações e NashConv, mas não constrói neste artefato todas as constantes de um certificado formal por jogo. Portanto, a slope empírica log-log não é substituto do bound.

CFR+ usa regret matching+ e média linear; resultados teóricos dependem da variante e da convenção de averaging. DCFR desconta regrets positivos, negativos e soma de estratégia por `α/β/γ`; não é correto aplicar automaticamente a constante ou a taxa do Vanilla CFR a essas variantes.

Aplicável aqui: relação geral regret baixo → estratégia média aproximadamente Nash no domínio declarado. Não demonstrado aqui: taxa assintótica exata da implementação alternada, garantia específica para os parâmetros DCFR, comportamento em recordação imperfeita, multiplayer, soma não zero ou jogos de poker abstraídos.
