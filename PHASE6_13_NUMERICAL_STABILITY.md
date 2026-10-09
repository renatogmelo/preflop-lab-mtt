# Fase 6.13 — Estabilidade numérica

Os testes cobrem regrets positivos e negativos coexistentes, vetor totalmente não positivo, alcance zero, chance não uniforme, utilidades negativas, escalas `1e-200` e `1e100`, normalização e rejeição de `NaN`/`Infinity`.

Não foram adicionadas tolerâncias para esconder divergências. Comparações do mesmo caminho determinístico e checkpoint exigem igualdade bit a bit. A tolerância `1e-12` existe apenas como teto explícito para implementações independentes; o delta efetivamente observado foi zero.

Não há promessa para overflow causado por magnitudes arbitrárias além de `Number`, underflow extremo, acumulação por milhões de iterações ou plataformas com semântica de ponto flutuante distinta. Kahan summation e aritmética de maior precisão ficam como pesquisa futura se dados empíricos justificarem.
