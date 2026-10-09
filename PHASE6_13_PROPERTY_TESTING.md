# Fase 6.13 — Property testing e metamorfismos

Um gerador determinístico cria jogos pequenos com chance não uniforme, dois infosets privados de P0, dois infosets de P1 compartilhados entre estados ocultos e payoffs discretos positivos/negativos. Foram usadas 32 seeds (`61300`–`61331`) e três algoritmos, totalizando 96 casos diferenciais de três iterações.

Propriedades verificadas: regrets e médias finitos; probabilidades normalizadas; equivalência referência/produção; soma zero; estabilidade determinística. Não houve contraexemplo, portanto não houve caso minimizado.

Metamorfismos: reversão da ordem das ações preservou EV e BR; multiplicar utilidades por 3 multiplicou NashConv por 3. Os deltas residuais foram zero. Budgets de 100.000 nós e 100.000 políticas foram testados com falha explícita ao exceder limites.
