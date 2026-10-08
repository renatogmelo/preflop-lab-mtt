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


## PHASE 6 AUDIT - 2026-10-04

Baseline audited: `a9f3f8fe530f32a34020698299c9c522c41f1bc3` (solver `0.3.0`). The Phase 5 artifact is preserved unchanged.

### Frozen reference game

- 46 compatible weighted private deals on flop `8h 7d 2c`;
- 11,179 nodes, 2,032 information sets, 967 chance nodes and 4,508 terminals;
- HU 10bb preflop with SB fold/raise-to-2 and BB fold/call;
- postflop bets fixed at 33% flop, 50% turn and 100% river;
- no raises or jams in the principal experiment;
- deterministic two-outcome future-board abstraction;
- formal Phase 6 identity: `phase6-reference-game-v1`.

### Numerical state found

- inner DCFR at 20 iterations: NashConv `0.541129`, exploitability `0.270565`, maximum strategy delta `1.0`;
- solved-provider within-provider seed distance: `0.203640` across only three seeds;
- equity-vs-solved weighted strategy distance: `0.636867`;
- coupling alpha `0.6`, three outer iterations, final deltas `0.511634 / 0.596181 / 1.225452 / 1.0`, not converged;
- all Hold'em outputs are `Experimental`; `Verified = 0`.

### Implementation findings

- CFR, CFR+ and DCFR share the same compiled object tree and exact infoset-safe BR evaluator;
- CFR+ clips cumulative regrets and uses delayed linear averaging; DCFR applies separate positive/negative regret and strategy-sum discounts before each iteration;
- exact BR currently rebuilds an evaluation tree for each player and checkpoint, which is a likely wall-clock hot path;
- maximum strategy delta gives full weight to newly visited and near-zero-reach information sets, so `1.0` is not sufficient evidence that the trunk itself moved by 100 percentage points;
- exact equity recreates runouts and evaluates repeated showdowns without a cross-request matchup cache;
- the outer loop has one-shot thresholds but no convergence patience, oscillation detector or divergence state;
- continuation-result semantics correctly distinguish exact private chance from abstracted future boards and finite strategic approximation.

### Phase 6 controls

The main game definition, ranges, fixed flop, board buckets and betting abstraction will not change. Phase 6 will add convergence histories, reach-aware diagnostics, counterfactual action EV, deterministic resume tests, profiling, algorithm/parameter/seed studies and fixed-point controls without overwriting Phase 5 evidence.

## PHASE 6 RESULT - 2026-10-04

- Implemented indexed Float64 CFR, compiled EV/best response, reach-aware deltas, counterfactual per-action EVs, checkpoint/resume, explicit runtime/memory gates and experiment manifests.
- Frozen reference: `phase6-reference-game-v1`, hash `bfd3615d6ee13da1`, 46 deals, 11,179 nodes and 2,032 infosets.
- Selected DCFR 2/0/3 reached exploitability `0.010074` and reach-weighted delta `0.003723` at 5,000 iterations in 7.870 s.
- Indexed traversal measured `9.90x` the object-tree oracle; strategies/checkpoints remain differential-identical.
- Five-seed Solved distance improved from `0.203640` to `0.126345` but fails the `<0.1` stability gate.
- Equity-vs-Solved distance is `0.653360`; ProviderSeparationRatio is `5.171253`.
- No coupling alpha converged. Alpha 0.25 was least unstable; alpha 0.6 and 1.0 diverged.
- Stop gate: A pass, B fail, C pass, D fail. Phase 7 expansion is blocked.
- All strategic outputs remain Experimental; Verified remains zero.
- Full evidence: `PHASE6_REPORT.md`, `PHASE6_CONVERGENCE.md`, `PHASE6_COUPLING.md`, `PHASE6_PERFORMANCE.md`, and `SOLVER_ERROR_BUDGET.md`.
- Final repository validation: TypeScript, lint, production build and 82/82 tests passed on 2026-10-04.

## PHASE 6.5 AUDIT - 2026-10-04

Baseline audited: `893d62720ca465153030ba5d3dcff25403f8f979` (solver `0.4.0`). Phase 5 and Phase 6 artifacts remain immutable evidence.

### Frozen scope and evidence

- the experiment remains `phase6-reference-game-v1`, hash `bfd3615d6ee13da1`;
- the private chance model remains the same 46 weighted compatible deals on `8h 7d 2c`;
- the postflop game remains 11,179 nodes / 2,032 infosets with the same betting and future-board abstractions;
- all Hold'em output remains `Experimental`; `Verified = 0`;
- Phase 6 gates were A pass, B fail, C pass and D fail, so Phase 7 stays blocked.

### Root cause found

- `HoldemPreflopV2Solver` samples one private deal per iteration from a single mutable RNG stream;
- the exact 46-deal chance tree already exists in `HoldemPreflopEvaluationGame`, but was used only for evaluation, not training;
- coupling therefore mixed a stochastic preflop response with a solved postflop response, obscuring whether Gate B/D failures came from sampling noise or the fixed-point map itself;
- the current coupling metric uses unweighted maximum postflop strategy movement and only detects period two on one continuation probe;
- no subsystem RNG ledger, fixed chance schedule, deal-coverage report, sensitivity Jacobian, generalized cycle detector or resumable outer-loop checkpoint exists;
- damping is applied to continuation utilities; those damped utilities must remain distinct from raw solved utilities in every artifact and convergence test.

### Phase 6.5 controls frozen before implementation

- add exact preflop traversal over all 46 weighted deals and retain sampled traversal as a differential subject;
- derive deterministic RNG streams from `masterSeed + subsystemId` and account for every draw in a randomness ledger;
- compare IID, fixed-CRN, stratified/quasi-deterministic and exact modes on seeds `1, 7, 19, 42, 99`;
- preserve the official Gate B threshold `< 0.10` and report stricter `< 0.05 / 0.02 / 0.01 / 0.005` tiers;
- predeclare Gate D as all required deltas `<= 0.02`, using reach-weighted postflop strategy delta for three consecutive outer iterations;
- test damping alphas `0.05, 0.10, 0.15, 0.20, 0.25` plus `0.40` control, without changing the frozen game;
- do not recommend Phase 7 unless A, B, C and D all pass after revalidation.

## PHASE 6.5 RESULT - 2026-10-04

- Added a subsystem `RandomnessLedger`, fixed CRN, interleaved stratified and quasi-deterministic schedules, coverage metrics and importance weights.
- Added synchronous exact preflop CFR over all 46 weighted private deals, exact EV/NashConv/action-EV evaluation, order invariance and deterministic checkpoint/resume.
- Exact 5,000-iteration Solved runs averaged `325.495 ms`; repeated and cross-seed strategy distance is `0`.
- Quasi-deterministic was the best sampled approximation: mean distance `0.063091` at 5,000 and `0.046900` at 10,000 for seed 19.
- Exact Equity↔Solved distance is `0.629219`; provider separation remains material after seed noise is removed.
- Canonical bucket identity passed all 46 deal/order audits; finite-difference sensitivity flagged a possible artificial discontinuity.
- Damping alpha `0.05` was best, but deterministic coupling failed after 100 outer iterations. Final residuals were preflop RW `0.001211`, range `0.079894`, damped utility `0.053868`, and postflop RW `0.044017`.
- Continuous outer 20 and 10→resume→20 were strategy-, utility- and trajectory-identical.
- Final gates: A pass, B pass, C pass, D fail. Phase 7 remains blocked.
- All strategic output remains Experimental; Verified remains zero.- Final Phase 6.5 validation: TypeScript, lint, production build and 93/93 tests passed on 2026-10-04.

## PHASE 6.6 AUDIT - 2026-10-04

Baseline audited: `ef0b0b06971d86a06446cecff93d036fe34873f9` (solver `0.5.0`). The frozen `phase6-reference-game-v1` and hash `bfd3615d6ee13da1` remain unchanged. All Hold'em outputs remain `Experimental`; `Verified = 0`.

### Confirmed baseline

- Gates remain `A PASS / B PASS / C PASS / D FAIL`.
- Exact preflop traversal enumerates all 46 compatible private deals synchronously and is seed-invariant.
- The postflop reference tree has 11,179 nodes and 2,032 infosets under the two-representative future-board abstraction.
- At outer iteration 100 with alpha `0.05`, preflop reach-weighted movement was small (`0.001211`), while conditional ranges (`0.079894`), raw continuation (`2.660087`), damped continuation (`0.053868`) and postflop reach-weighted movement (`0.044017`) did not establish a fixed point.
- Phase 6.5 sensitivity changed sharply with epsilon (`297.913854`, `53.726274`, `28.905781`, `7.048194`), but did not isolate finite-solve, posterior, representative-card or true operator response effects.

### Implementation findings

- Gate D currently tests damped update size, not the raw fixed-point residual `F(S)-S`; a sufficiently small alpha could therefore create false convergence.
- `BucketedBoardProvider` assigns deterministic physical buckets but replaces each bucket with one visible representative card. Stable identity does not bound the abstraction error.
- Conditional ranges correctly use the complete compatible joint deal posterior, but the pipeline does not expose stage-by-stage normalization, joint-deal and posterior amplification metrics.
- Postflop coupling uses a fixed iteration count and can consume continuation values without an explicit exploitability plus reach-weighted movement quality gate.
- Checkpoint/resume is exact for Phase 6.5 state, but does not carry raw residual history, inner-quality state or acceleration state.
- Full exact future enumeration would materialize about 5.5M nodes; the audit found no evidence that this is a fundamental limit rather than a consequence of eager tree materialization.

### Phase 6.6 controls frozen before experiments

- Preserve the official reference game and historical Representative model.
- Add a separate microgame laboratory with Representative (R), probability-weighted Expected Bucket (E) and Exact physical future enumeration (X).
- Keep bucket membership deterministic and range-independent for a fixed card state.
- Predeclare Gate D v2 with raw normalized continuation residual `<= 0.02`, every legacy strategic delta `<= 0.02`, LocalResponseRatio `<= 1`, inner quality passed and three consecutive passes.
- Run the declared damping grid, quality-conditioned sensitivity, multiple initializations and guarded acceleration without changing thresholds after observing results.
- Keep `Verified = 0` regardless of Gate D outcome and do not implement Phase 7 in this phase.

<!-- PHASE6.6 START -->
## PHASE 6.6 COMPLETE — 2026-10-05

Implemented finite/fixed-quality sensitivity, joint-posterior audit, ExpectedBucketBoardProvider, exact-future microgame, residual norms, LocalResponseRatio, adaptive inner quality, Coupling V2, safeguarded Anderson, multiple initializations, checkpoint V2, artifact/goldens and 25 new tests (20 functional + 5 golden).

Result: A PASS / B PASS / C PASS / D FAIL. Best α=0.15; outer-25 raw residual 0.103773; LocalResponseRatio 4.368. Tiny α=0.001 was correctly rejected despite damped delta 0.004784. H1 partial, H2 unresolved, H3 supported, H4 partial, H5 supported. Build + 118/118 tests pass. Verified=0. Phase 7 is not recommended.
<!-- PHASE6.6 END -->

## Phase 6.8 — Research Solver 0.8.0

- Implementado `SyntheticExtensiveGameGenerator` parametrizado por estados privados, sinais públicos, estágios, ações, seed e dependências.
- Estimador prévio coincidiu com todas as árvores materializadas; validation-first cobre chance, infosets, perfect recall, alcance, soma zero, leakage e finitude.
- Vanilla CFR, CFR+ e DCFR usam a mesma interface e registram iterações, tempo, nós, memória, exploitability e NashConv.
- Oracle object-based e engine indexed-f64-v1 coincidiram em estratégias, utilities, regrets, strategy sums e métricas em S0–S4.
- Checkpoint V3 e repetição integral preservaram determinismo semântico.
- Maior escala materializada: 131.069 nós; primeira escala bloqueada: S5 com 2.097.149 nós estimados.
- Rust não recomendado antes de reduzir a materialização eager.
- Resultado: S1–S6 PASS, 152/152 testes; sem mudança em poker, Gate D ou Verified.