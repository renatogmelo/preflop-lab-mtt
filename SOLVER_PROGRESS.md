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

## PHASE 4 AUDIT ? 2026-10-03

### Invent?rio encontrado

O core possu?a Vanilla CFR, CFR+, DCFR, checkpoint, Kuhn, cards/ranges, betting engine, POC push/fold e `strength-proxy-v1`. Os 48 testes anteriores cobriam invariantes, mas best response/NashConv eram capacidades opcionais do jogo e a implementa??o exata vivia dentro de Kuhn. O POC Hold'em tinha update chance-sampled pr?prio, uma decis?o por jogador e nenhuma m?trica estrat?gica defens?vel.

### D?bitos encontrados

- acoplamento de m?tricas a `KuhnPoker.bestResponseValue`;
- nenhuma public chance/multi-street depois de Kuhn;
- nenhum evaluator Hold'em real;
- continuation Level 0 confundia nome de equity com strength proxy;
- nenhum range hash/cache de continuation;
- nenhuma ?rvore HU al?m de push/fold;
- profiling apenas global e nenhum BR Hold'em.

### Entregue nesta fase

- `BestResponseEvaluator`, `StrategyEvaluator` e `NashConvEvaluator` gen?ricos;
- Leduc compat?vel com OpenSpiel: 9.457 n?s/936 infosets e oracle uniforme reproduzido;
- ?rvore compilada reutilizada pelo CFR;
- hand evaluator, equity engine e board chance;
- Hold'em Preflop V2 configur?vel com limp/raise/re-raise/jam e inspector de ranges;
- continuation API, range hash, cache e providers Level 0/1/2;
- primeiro subgame flop?turn?river resolvido com showdown real;
- ValidationSuite nos cinco n?veis e golden artifact versionado.

### Estado dos milestones

Milestone 1 Leduc: conclu?do para a variante declarada. Milestone 2 V2: estrutural/solve amostral conclu?dos, BR exato ainda pendente. Milestone 3 Postflop: conclu?do no subgame fixo declarado. Milestone 4 provider: interface/cache e consumo de artifact implementados para o estado fixo. Milestone 5: compara??o de utilities conclu?da; compara??o de estrat?gia preflop completa pendente. `Verified = 0`.


## Phase 5 - reduced Hold'em strategic validation

Completed:

- exact reduced-game Hold'em V2 evaluation and infoset-safe best response;
- 46-deal weighted physical-combo postflop subgame;
- private chance, board blockers and conditional Bayesian range snapshots;
- configurable three-street betting abstraction;
- strategy-distance and multi-seed comparison artifacts;
- sampled-vs-enumerated comparison;
- iterative coupling with explicit damping and outer-loop metrics;
- first Preflop Lab Solver Experimental v0.3.0 dataset.

Measured limitations:

- postflop NashConv 0.541129 and exploitability 0.270565 at 20 DCFR iterations;
- solved-provider within-seed strategy distance mean 0.203640;
- coupling did not converge in three outer iterations;
- fixed flop and bucketed future boards remain abstractions.

Next milestone is convergence and variance reduction in this same small game, not 8-max expansion.
