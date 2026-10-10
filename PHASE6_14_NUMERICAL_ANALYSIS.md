# Fase 6.14 — Análise numérica

Foram exercitadas escalas de utility `1e-6`, `1e-3`, `1`, `1e3` e `1e6`. Em DCFR/10.000, NashConv escalou linearmente com a utility, enquanto o máximo regret normalizado permaneceu aproximadamente `2,765794066e-4`. Comparar os valores absolutos entre escalas seria incorreto; a análise usa grandezas normalizadas.

Chance foi testada com probabilidades `0`, `1e-12`, `0,5`, `1-1e-12` e `1`. Branches de probabilidade zero permaneceram estruturais, estratégias normalizadas e utilities/regrets finitos.

Os guards detectam regrets, strategy sums ou utilities não finitos, erro de normalização acima de `1e-12` e NashConv negativo além da tolerância. O experimento afetado é interrompido; nenhum caso real acionou esses guards.

Não foi observada evidência de overflow, underflow prejudicial ou cancelamento catastrófico na matriz. Isso não prova segurança para milhões de iterações, utilities fora das escalas testadas ou plataformas com outra semântica numérica.
