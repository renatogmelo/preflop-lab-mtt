# Preflop Lab Solver — Architecture 0.1.0

## Decisão tecnológica

O núcleo de referência inicial é TypeScript estrito, executado fora do React por Node.js. A escolha é consciente:

- permite auditar fórmulas, estados e artefatos junto da aplicação atual;
- reduz o risco de divergência no primeiro marco de correção;
- torna os testes diferenciais e a exportação reproduzíveis sem uma ponte nativa prematura;
- é suficiente para Kuhn e para o POC pequeno de Hold'em.

TypeScript **não** é uma decisão definitiva para solves grandes. Depois de profiling, o plano é portar traversal/storage de infosets para Rust nativo, mantendo GameDefinition, artefatos, validação, CLI e exporter compatíveis. WASM só será considerado para workloads interativos pequenos; solves offline pesados devem preferir binário nativo.

## Fronteiras

```text
Game Definition
      ↓
ExtensiveGame / Betting Engine / Cards
      ↓
CFR | CFR+ | DCFR
      ↓
Raw Solve Artifact + Checkpoint
      ↓
ValidationReport
      ↓
SolverDatasetExporter
      ↓
StrategyRepository (Experimental por padrão)
```

`solver/` não importa React, views, D1 nem componentes. Apenas `solver/export/` conhece os tipos de StrategyDataset, formando uma camada anticorrupção explícita.

## Módulos

- `core/`: contratos, identidade determinística, RNG, versão e estimativa de recursos.
- `algorithms/`: Vanilla CFR, CFR+ e DCFR sobre uma interface comum.
- `games/`: benchmark Kuhn com chance, infosets, utilities e best response exatos.
- `cards/`: deck de 52 cartas, 1.326 combos, 169 classes, colisão e força aproximada isolada.
- `game/`: GameDefinition, betting engine e POC de Hold'em.
- `tree/`: tipos explícitos ChanceNode, ActionNode e TerminalNode.
- `continuation/`: interface de continuation values e provider Level 0.
- `validation/`: relatórios e critérios verificáveis.
- `storage/`: JSON e checkpoints.
- `export/`: agregação combo → 169 e StrategyDataset.
- `cli/`: solve, resume, inspect, validate, reproduce e benchmark.
- `benchmarks/`: medições reproduzíveis do núcleo de referência.

## Identidade e determinismo

`solveId = hash(gameDefinition + solverConfiguration + continuationProvider + solverVersion)`.

Checkpoint contém hashes separados da definição e configuração. Restore falha explicitamente se jogo, parâmetros ou versão divergirem. Randomness usa seed visível e estado do RNG serializado.

## Game abstraction

`ExtensiveGame<State, Action>` separa chance de decisões estratégicas. O solver recebe actor, ações, transição, utility terminal e infoset determinístico. Avaliação e best response são capacidades opcionais do jogo, portanto métricas não são inventadas quando não existe cálculo matematicamente válido.

## Poker abstraction

O betting engine suporta stacks por jogador, blinds, ante/BBA, committed/dead chips, call, check, fold, raise-to, all-in curto, min-raise, reabertura, ordem HU/multiway e conservação do pote. Os sizings são dados, nunca criados implicitamente.

O POC atual é heads-up push/fold SB vs BB, 10bb, sem ante. Ele prova combo-level chance, card removal, regret updates, checkpoint e export. Não representa a árvore 8-max completa.

## Precisão e storage

O núcleo usa `number`/f64. Correção e estabilidade vêm antes de f32/compactação. Tabelas guardam regret e strategy sum por ação. Artefato bruto preserva estratégias por combo; o dataset da aplicação é uma projeção agregada separada.

## Perfect recall e conditioning

Infoset IDs incluem jogador, informação privada e histórico observável. Kuhn possui perfect recall por construção. Em CFR, ranges condicionais emergem de reach probabilities das estratégias comportamentais; não existem filtros heurísticos. O POC de Hold'em tem uma única decisão por jogador, portanto perfect recall é trivial, mas ainda não prova conditioning multi-round/8-max.

## Evolução nativa

Portar para Rust somente após profiling e manter testes diferenciais contra esta implementação. Prioridades futuras: arrays compactos, arena de infosets, checkpoint binário versionado, traversal paralela determinística e, apenas depois, SIMD. GPU/cluster não fazem parte da versão 0.1.0.

## Architecture 0.2.0 ? public chance e continuation

`compileGameTree` materializa jogos pequenos uma vez; CFR e suas variantes percorrem essa representa??o imut?vel. Avalia??o foi separada em `StrategyEvaluator`, `BestResponseEvaluator` e `NashConvEvaluator`. O BR ? exato para jogos finitos two-player zero-sum com perfect recall: resolve infosets de baixo para cima e pesa estados por reach de chance + oponente, excluindo reach pr?prio.

`LeducPoker` usa o mesmo `ExtensiveGame` e prova private/public chance, duas rodadas, card removal, fold/showdown e 936 infosets. `PostflopHoldemSubgame` usa cards Hold'em reais, turn/river chance, betting abstraction e showdown exato.

Continuation agora tem `ContinuationRequest/Result`, providers separados, range hash quantizado a 1e-9 e cache compat?vel apenas com Level 2. Abstractions e configura??o participam do hash; um valor n?o pode ser reutilizado em outro board/pote/stack/range.

Hold'em Preflop V2 permanece chance-sampled e separado do traversal tabular completo. Isso evita materializar ~1,6 milh?o de deals privados ? ?rvore, mas exige futuro BR amostrado validado e depois BR exato/limitado antes de qualquer promo??o.


## Architecture 0.3.0 - weighted ranges and coupling

New boundaries:

- cards/private-chance.ts owns normalized compatible private deals;
- evaluation/holdem-preflop.ts separates exact evaluation traversal from sampled training;
- ranges/conditional.ts owns immutable Bayesian snapshots;
- game/range-postflop-subgame.ts owns weighted-range strategic continuation;
- comparison/strategy-distance.ts owns formal strategy diffs;
- continuation/cache.ts hashes every strategic input;
- coupling/engine.ts owns fixed-point outer iterations and damping.

The coupled flow is Preflop solve -> joint range conditioning -> postflop solve -> pairwise continuation evaluation -> damped utility update -> preflop re-solve. Inner and outer convergence are reported separately.
