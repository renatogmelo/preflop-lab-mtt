# Training Engine

## Seleção de perguntas

Toda pergunta aponta para um `StrategyNode` e uma classe de mão. O contexto inclui posição, stack, action history, pot, sizing, dataset e provenance.

- Beginner favorece ações puras e regiões centrais.
- Intermediate adiciona fronteiras, stacks e 3-bets.
- Advanced adiciona mixed, squeezes e vizinhança.
- Pro prioriza boundary, diferenças pequenas, frequência e leaks pessoais.

## Grading

Decision Trainer compara a ação escolhida com a frequência no node. Frequency Trainer calcula MAE em pontos percentuais. Range Trainer mede composição, mãos ausentes/excessivas e ação dominante incorreta.

EV loss só é calculado quando o dataset fornece EV para todas as alternativas relevantes.

## Confidence

Escala 1–5 acompanha cada decisão.

- erro + confiança alta → misconception;
- erro + confiança baixa → knowledge gap;
- acerto ainda instável → uncertain;
- acertos repetidos + confiança calibrada → mastered.

Confidence nunca substitui correção; ela informa prioridade de revisão.

## Repetição espaçada

O estado é identificado por `nodeId + hand` e registra attempts, correct/incorrect, streak, last seen, next review, mastery, calibration, EV loss e frequency error.

O intervalo usa:

- resultado;
- confidence;
- dificuldade;
- streak;
- número de tentativas;
- misconception.

Misconceptions retornam mais cedo. Erros não são repetidos apenas com a mesma mão: `adjacentReinforcementHands` inclui vizinhas para verificar aprendizado da região.

## Boundary selection

`boundaryCandidates` combina:

- presença de estratégia mista;
- proximidade da frequência dominante a 50%;
- distância estratégica das mãos vizinhas;
- troca de ação dominante na vizinhança.

Isso reduz perguntas óbvias e ensina onde o range começa/termina.

## Mastery

Mastery pondera accuracy, frequency accuracy, confidence calibration, streak e recência. Um fator de evidência exponencial limita o resultado com poucas tentativas. Uma única resposta nunca produz mastery alta.

A UI agrega hierarquicamente:

```text
Preflop
  → cenário
    → hero vs villain
      → faixa de stack
```

## Leak detection

Registros são agrupados por cenário, hero, faixa de stack e classe de mão. Só há insight depois de amostra mínima.

O score usa baixa accuracy, frequency error, misconceptions e EV loss quando disponível. A descrição aponta a região, não inventa causalidade que os dados não comprovam.

## Today's Training

A fila combina:

1. reviews vencidas;
2. misconceptions;
3. major leaks;
4. boundary hands;
5. mixed strategies;
6. reforço de conteúdo recente.

Itens são deduplicados por node+mão e ordenados pela prioridade adaptativa.

## Session report

Relatórios incluem decisions, accuracy, frequency MAE, EV loss disponível, strongest/weakest, misconceptions e próxima recomendação. Quando EV não existe, mostram indisponível.

## Testabilidade

O learning engine não depende de React, relógio global obrigatório ou banco. Funções aceitam `now`/timestamp, tornando scheduling, mastery e leaks determinísticos em testes.
