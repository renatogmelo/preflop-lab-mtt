# Phase 6.8 Mathematical Validation

## Validation first

Antes da compilação, cada jogo materializado verifica normalização de chance, ações legais, consistência de information sets, perfect recall, alcance dos terminais, utilities soma zero, ausência de vazamento do estado privado adversário e finitude numérica. Os 24 casos property-based guardam seed e configuração em caso de falha.

## Validação independente e compartilhada

S0 preserva o oracle independente por enumeração de estratégias puras: matriz 4 × 16, valor `-0,0037894458` e exploitability zero. Em S1–S4 a enumeração é inviável; por isso a evidência combina best response, NashConv, exploitability, conservação soma zero, testes diferenciais e metamórficos. Esses componentes maiores compartilham partes do stack de avaliação e não são descritos como prova independente completa.

## Oracle diferencial

O solver orientado a objetos e o solver indexado recebem exatamente o mesmo jogo, configuração e número de iterações. Em S0–S4, tolerância `1e-12`, coincidiram:

- estratégia média;
- utilities;
- regrets;
- strategy sums;
- NashConv e exploitability;
- estado semântico de checkpoint.

## Testes metamórficos

Passaram renomeação de ações/infosets, reordenação dos ramos de chance, multiplicação positiva das utilities, permutação dos estados privados e permutação dos jogadores com troca correta das utilities. O artefato S0 usa tolerância `1e-10`; o teste ramificado adicional usa `2e-8`, calibrado pela diferença máxima observada de aproximadamente `1,60e-8` causada pela ordem de acumulação floating-point.

## Estabilidade numérica

As estratégias são normalizadas, regrets/strategy sums/utilities são finitos e nenhum dos 24 casos gerou NaN ou Infinity. Reach probabilities muito pequenas continuam em `Float64`; não houve underflow observado nas profundidades até 15. Escalar utilities por 3 preservou a estratégia e escalou exploitability dentro da tolerância.

Checkpoint V3 registra game hash, configuration hash, iteração, solver version, regrets, strategy sums e versão estrutural `indexed-f64-v1`. Execução contínua e checkpoint → resume foram semanticamente idênticos.

