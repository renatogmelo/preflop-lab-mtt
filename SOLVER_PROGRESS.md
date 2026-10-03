# Preflop Lab Solver — Progress

Atualizado em: 2026-10-03  
Versão: 0.1.0

## Milestone A — Solver Mathematics

Concluído para Kuhn:

- Vanilla CFR, CFR+ e DCFR;
- chance, reach, counterfactual regret e average strategy;
- best response exato por políticas puras;
- exploitability e NashConv;
- histórico de convergência, early stopping e runtime limit;
- checkpoint/resume com hashes;
- validação diferencial dos três algoritmos;
- known-value test `−1/18`.

Leduc ainda não foi implementado. A prioridade foi concluir Hold'em estrutural e exporter sem introduzir um benchmark parcial difícil de auditar.

## Milestone B — Hold'em Core

Implementado:

- deck de 52 cartas, 1.326 combos e 169 classes;
- range com pesos 0–1 e conditioning por blockers;
- collision detection/card removal;
- GameDefinition com stack por jogador, blinds, ante/BBA e abstração;
- betting engine para HU/multiway, min-raise, raise-to, short all-in e reopening;
- Chance/Action/Terminal node contracts;
- POC combo-level heads-up push/fold;
- 500 traces geradas para invariantes do betting engine.

Ainda pendente: árvore NLHE multi-raise resolvida pelo CFR genérico, folded-player conditional ranges de uma origem 8-max e utilities postflop defensáveis.

## Milestone C — Preflop POC

Concluído como Experimental:

- 5.000.000 amostras determinísticas;
- 2.652 infosets (1.326 por jogador);
- raw combo strategy preservada;
- checkpoint, artifact, validation e export 169;
- StrategyDataset instalado no repositório;
- exclusão automática mantida; acesso exige opt-in Experimental.

Isso não é estratégia profissional nem GTO.

## Milestone D — Continuation Values

Pendente. Existe interface e Level 0 de desenvolvimento. Level 1/2 não foram implementados.

## Milestone E — First Verified Candidate

Não iniciado. `Verified` permanece 0.

## Engenharia

- CLI: solve, resume Kuhn, inspect, validate, reproduce e benchmark.
- Hold'em checkpoint/restore existe na API; resume CLI ainda requer reconstruir a configuração original programaticamente.
- artefatos JSON separados do dataset de aplicação;
- solve identity e hashes determinísticos;
- estimador de infosets/memória/runtime class e perfil de hardware;
- execução single-thread; nenhuma otimização GPU/cluster/SIMD.

## Próxima ordem

1. Leduc com public chance e duas rodadas.
2. Best response escalável para árvores maiores.
3. Integrar betting tree NLHE ao `ExtensiveGame` genérico.
4. Resolver conditioning dos jogadores que foldaram numa origem 8-max.
5. Substituir o proxy por continuation Level 1 e depois Level 2.
6. Selecionar um cenário pequeno e definir threshold pré-solve.
7. Reproduzir, revisar, comparar e somente então avaliar primeiro candidato Verified.
