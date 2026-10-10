# Fase 7.1 — Design System

O Research Console é dark-first, técnico e deliberadamente distinto de um painel administrativo genérico.

## Tokens

- Fundo `#07100d`, superfícies `#0c1713/#101e19`, bordas `#24372f`.
- Texto `#eef7f1`, secundário `#899b92`.
- Ação/êxito `#b9f45b`, informação `#64d9b9/#7eafff`, atenção `#ffb45f`, erro `#ff6d75`.
- Raios de 6–14 px, sombras discretas e tipografia Geist/Geist Mono.

## Componentes

StatusBadge, MetricCard, EmptyState, ErrorState, Loading skeleton, ProgressBar, Dialog, Toasts, ConvergenceChart, ValidationBadge, tabelas, filtros, formulários, cards, árvore e listas de eventos.

## Acessibilidade

- Controles rotulados, focus visível, navegação sem mouse e diálogo com Escape.
- `aria-live` em erros/toasts, `role=progressbar`, labels do canvas e nomes acessíveis.
- Contraste por estado sem depender apenas de cor.
- `prefers-reduced-motion` reduz animações.
- Layouts em 1120, 860 e 620 px; tabelas ganham scroll e cards/controles são reorganizados no mobile.

O build e o ESLint com `jsx-a11y` passaram. A inspeção visual automatizada no navegador permaneceu `NOT TESTED` por falha de ACL do runtime do Browser.
