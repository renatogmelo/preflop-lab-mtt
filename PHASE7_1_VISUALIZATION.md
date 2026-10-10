# Fase 7.1 — Visualização

`ConvergenceChart` usa Canvas responsivo e somente pontos presentes em `ResearchResultV1.convergence`.

- Métricas disponíveis são derivadas das chaves reais da série.
- Eixo X alterna entre `iteration` e `runtimeMs` quando presente.
- Escala log exclui valores não positivos em vez de transformá-los artificialmente.
- Tooltip apresenta algoritmo, métrica e coordenada real.
- Estado vazio substitui o gráfico quando não há série numérica.
- Comparação usa as séries de cada artefato, com cores distintas e métricas finais.

O Game Explorer usa dados de `validate`/`compile` da SDK. A árvore usa o provider público, carrega no máximo 240 nós e informa truncamento; estatísticas estruturais continuam referentes à árvore compilada completa.

Não há SVG autoral, dataset fictício, curva sintética de progresso ou valor placeholder apresentado como medição.
