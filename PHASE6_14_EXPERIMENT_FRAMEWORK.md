# Fase 6.14 — Framework de experimentação

O schema `phase6.14-experiment-v1` registra ID, jogo, hash estrutural, algoritmo e versão, parâmetros, seed, estado inicial, budget de iterações/tempo, agendas de avaliação/checkpoint, escala de utility, commit, ambiente e recursos.

O scheduler executa processos isolados com concorrência máxima 1. Cada child recebe limite de heap, watchdog de runtime e envelope finito de nós/trabalho/RSS. Resource Policy V3 permanece ativa como política-base; a 6.14 adiciona limites mais restritos para long-runs em árvores pequenas, sem aumentar silenciosamente qualquer teto.

Critérios de parada implementados: iterações, runtime, RSS, trabalho estimado, anomalia numérica e cancelamento. Falhas são estruturadas e preservadas no manifesto.

Cada ponto da curva contém iteração, tempo de travessia/avaliação/checkpoint, EV, BR, NashConv, exploitability, hash da estratégia média, estatísticas de regret, normalização, anomalias, RSS e heap. As séries podem alimentar gráficos de métrica×iteração, métrica×tempo, regret×iteração e memória×tempo.

Matriz executada: 52 experimentos isolados, 49 completos e 3 encerrados corretamente pelo budget time-matched de 150 ms.
