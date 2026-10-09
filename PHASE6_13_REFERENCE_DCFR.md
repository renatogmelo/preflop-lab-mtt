# Fase 6.13 — DCFR de referência

Antes de cada iteração `t`, a referência aplica:

- `R+ *= t^α/(t^α+1)`;
- `R- *= t^β/(t^β+1)`;
- `S *= ((t-1)/t)^γ`.

Depois executa as atualizações alternadas de P0/P1 sem recorte. A configuração padrão confirmada é `α=1.5`, `β=0`, `γ=2`. Em `t=1`, as escalas são `0.5`, `0.5` e `0`. Índices inválidos e parâmetros/resultados não finitos geram erro.

DCFR coincidiu exatamente com produção em fixtures analíticas, 32 jogos gerados, escalas de utilidade `1e-200` e `1e100` e checkpoint 5+5 contra execução contínua de 10 iterações.
