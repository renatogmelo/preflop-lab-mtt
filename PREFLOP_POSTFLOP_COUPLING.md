# Preflop ↔ Postflop Coupling

## O problema

Os ranges que chegam ao flop são produzidos pela estratégia preflop. Ao mesmo tempo, a estratégia preflop depende do valor das continuações pós-flop. Resolver uma continuação uma vez e congelá-la sem declarar essa aproximação quebra essa dependência circular.

## Arquitetura implementada na Fase 4

`ContinuationRequest` transporta estado, ranges, board, posição, histórico e o identificador da abstraction. `ContinuationResult` devolve utilities zero-sum, modelo, confiança, metadata e `computationId`. O hash do cache inclui board, pote, stacks, ranges quantizados a `1e-9`, posição, abstraction e configuração.

O primeiro Level 2 é deliberadamente pequeno: dois ranges degenerados (um combo por jogador), flop fixo, turn e river enumerados, checks forçados no flop/turn e uma aposta de meio pote no river. Ele prova a interface e a matemática; não representa uma solução geral de NLHE.

## Acoplamento iterativo proposto

1. Inicializar uma estratégia preflop explicitamente identificada.
2. Derivar ranges condicionais por `reach × strategy`, com card removal.
3. Agrupar apenas estados de continuação compatíveis com a abstraction declarada.
4. Resolver cada subgame e armazenar artefatos por hash completo.
5. Recolocar as utilities nos leaves preflop.
6. Resolver novamente o preflop.
7. Repetir até que estratégia preflop, ranges e continuation values estabilizem dentro de thresholds prévios.

Não há prova de convergência desta decomposição na implementação atual. Ela pode oscilar ou convergir para um ponto dependente da decomposição. Por isso o loop ainda é pesquisa, não `Verified`.

## Alternativa: árvore unificada

Uma árvore única preflop + postflop remove a interface aproximada e deixa o CFR propagar valores diretamente. A vantagem é coerência matemática. O custo é a explosão combinatória de deals privados, 22.100 flops possíveis antes de blockers, turn/river, ranges combo-level e branches de apostas. Mesmo com poucas apostas, a árvore excede o que a implementação tabular TypeScript deve materializar.

O caminho defensável é validar primeiro subgames enumerados, depois chance sampling contra versões enumeradas pequenas e, somente então, decidir entre decomposição iterativa e traversal unificado nativo.

## Estado honesto

- Level 0 `strength-proxy-v1`: baseline heurístico, Experimental.
- Level 1 `equity-provider-v1`: equity real, mas sem estratégia futura, Experimental.
- Level 2 `solved-subgame-provider-v0`: subgame estratégico real, mas restrito ao cenário/abstraction exatos, ainda Experimental.
- Integração completa de ranges preflop dinâmicos com todos os flops: pendente.


## Phase 5 executed coupling experiment

The architecture was executed for three outer iterations with damping alpha 0.6. Final deltas were 0.511634 (preflop strategy), 0.596181 (conditional range) and 1.225452 (continuation utility). The postflop strategy delta remained 1.0 and the loop did not converge. The result demonstrates the pipeline but blocks any promotion to training data.

## Phase 6 fixed-point result

The outer loop now supports fixed/incrementing preflop seeds, configurable cache quantization, runtime stop, divergence and period-two detection, all-metric convergence passes and patience. Every iteration records continuation history and all postflop artifacts.

Grid result: alpha 0.25 and 0.4 exhausted ten iterations without a pass; alpha 0.6 diverged at six; alpha 1.0 diverged at four. Alpha 0.25 was least unstable but ended with preflop/range/utility/postflop deltas `0.152837 / 0.164987 / 0.356127 / 0.9999998`. No fixed point exists in the tested budget. See `PHASE6_COUPLING.md`.
## Phase 6.5 deterministic coupling result

The preflop leg now enumerates all 46 private deals exactly, so outer-loop results no longer depend on a preflop sampling seed. Damping alphas `0.05, 0.10, 0.15, 0.20, 0.25, 0.40` were screened under the same frozen map. Alpha `0.05` advanced through budgets 25, 50 and 100.

Gate D requires preflop reach-weighted strategy, conditional-range L1, damped continuation utility and postflop reach-weighted strategy deltas all `<=0.02` for three consecutive iterations. It failed at 100 because the last three non-preflop residuals remained `0.079894`, `0.053868`, and `0.044017`.

No approximate period-2/3 cycle was detected. Checkpoint/resume exactly reproduced the continuous 20-iteration trajectory. Therefore remaining instability belongs to the approximation feedback map, not RNG or resume mechanics.

<!-- PHASE6.6 START -->
## Phase 6.6 Coupling V2

Coupling V2 uses exact preflop traversal, an explicit joint Bayesian posterior, adaptive inner postflop budget, raw/damped value separation, component residuals, LocalResponseRatio and schema-2 checkpoints. Plain, adaptive and safeguarded-Anderson methods were compared. The full C-R operator failed Gate D; C-E full was blocked by the node cap and micro C-E failed inner quality; micro C-X remained unstable. Outer coupling is retained only as an Experimental diagnostic baseline.
<!-- PHASE6.6 END -->
