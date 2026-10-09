# Preflop Lab Solver — Validation Report 0.1.0

## Resumo honesto

O core CFR está validado em Kuhn. O POC de Hold'em é estrutural e Experimental. Continuation values profissionais, exploitability Hold'em, Leduc e solução 8-max completa ainda não existem.

## Kuhn — execução oficial

| Métrica | Resultado |
|---|---:|
| Algoritmo | DCFR α=1.5, β=0, γ=2 |
| Iterações | 2.500 (early stop) |
| Infosets | 12 |
| Nós visitados | 275.000 |
| Valor P0 | -0,05556017 |
| Valor conhecido | -0,05555556 |
| Exploitability | 0,00271726 |
| NashConv | 0,00543451 |
| Strategy delta final | 0,00093571 |
| Runtime observado | 381 ms |
| Checkpoint observado | 3.212 bytes |

Probability integrity, valor conhecido, best response, exploitability, NashConv e estabilidade numérica passaram.

## Validação diferencial — 20.000 iterações

| Algoritmo | Exploitability | NashConv | Iterações/s | Nós/s |
|---|---:|---:|---:|---:|
| Vanilla CFR | 0,00150381 | 0,00300763 | 9.630 | 1.059.286 |
| CFR+ | 0,00107534 | 0,00215068 | 9.819 | 1.080.145 |
| DCFR | 0,00093680 | 0,00187360 | 10.373 | 1.140.986 |

Os três algoritmos resolvem exatamente o mesmo jogo e convergem para valores compatíveis. Runtime e heap são observações da máquina, não garantias.

## Hold'em POC — execução oficial

| Métrica | Resultado |
|---|---:|
| Jogo | HU SB vs BB, 10bb, push/fold |
| Algoritmo | chance-sampled CFR |
| Iterações/amostras | 5.000.000 |
| Infosets | 2.652 |
| Raw strategies | 1.326 combos por jogador |
| Memória tabular estimada | 84.864 bytes |
| Runtime observado | 4.598 ms |
| Average positive regret reportado | disponível no artefato |
| Strategy delta final | 0,03610995 |
| Exploitability/NashConv | indisponível (`null`) |
| Continuation | Level 0 `strength-proxy-v1` |
| Trust | Experimental |

Passaram: combo count, frequency integrity, card-removal, seed/checkpoint e export das 169 classes. Falham eligibility para Verified: continuation aproximada e ausência de best response/exploitability aplicável.

## Testes

- 52 cartas únicas, 1.326 combos, 169 classes e multiplicidades 6/4/12;
- weighted ranges e 1.225 combos restantes após blocker;
- pot inicial 8-max BBA de 2,5bb e UTG first-to-act;
- short all-in sem reabrir raise para quem já agiu;
- 500 sequências legais geradas com conservação de fichas;
- CFR, CFR+ e DCFR em Kuhn;
- valor conhecido, best response, exploitability e NashConv;
- checkpoint/resume determinístico e rejeição de configuração divergente;
- POC determinístico, combo-level e sem EV inventado;
- dataset validado, Experimental e excluído do auto-resolution.

## Artefatos

- `kuhn-dcfr-v0.1.0.json` e checkpoint;
- `benchmark-kuhn-v0.1.0.json`;
- `holdem-poc-v0.1.0.json`, checkpoint e validation report;
- `datasets/solver-experimental/holdem-poc-v0.1.0.json`.

## Limitações matemáticas restantes

1. Leduc não implementado.
2. Best response/exploitability Hold'em não implementado.
3. POC não representa árvore 8-max nem jogadores foldados condicionais.
4. Continuação Level 0 não modela postflop.
5. Strategy delta do POC ainda mostra ruído de amostragem; aumentar iterações não corrige utility incorreta.
6. Não há paralelização, f32, compressão binária ou profiling nativo.
7. Nenhum resultado é Verified.

## Resultado da primeira execução

1. Arquitetura: core isolado + exporter boundary.
2. Linguagem: TypeScript estrito para referência auditável; Rust planejado após profiling.
3. Algoritmos: Vanilla CFR, CFR+ e DCFR; chance-sampled CFR no POC.
4. Kuhn: validado contra valor conhecido.
5. Leduc: não implementado, declarado.
6. Métricas: números nas tabelas acima.
7. Hold'em: POC HU combo-level, push/fold.
8. Infosets: 12 Kuhn; 2.652 POC.
9. Performance: registrada acima e em artifact.
10. Memória: checkpoints/estimativas registrados.
11. Testes: unitários, property traces, differential e integration.
12. Limitações: explícitas neste documento.
13. Continuation: Level 0, bloqueador de Verified.
14. Dataset: `solver-experimental-6a62393e944f6db2`.
15. Roadmap: Leduc → BR escalável → NLHE tree → 8-max conditioning → Level 2 → um candidato Verified.

## Phase 4 validation 0.2.0

O artefato can?nico ? `solver/artifacts/phase4-validation-v0.2.0.json`; os thresholds versionados est?o em `tests/golden/phase4-v0.2.0.json`.

- Leduc: 9.457 n?s, 936 infosets; oracle uniforme id?ntico ao OpenSpiel.
- 2.000 itera??es: Vanilla `EV ?0,087226 / expl 0,013544`; CFR+ `?0,085979 / 0,034451`; DCFR `?0,086083 / 0,032495`.
- Hold'em V2: 51 n?s/deal, 21.216 infosets potenciais, 5.000 amostras, 20.776 infosets visitados; BR indispon?vel.
- Postflop: 17.958 n?s, 8.012 infosets, 46 chance nodes; DCFR 200, EV P0 `+1,64848551`, exploitability `0,0000010427`.
- Proxy/Equity/Solved no mesmo estado: `+0,05171429 / +1,64848485 / +1,64848551` para P0.

Os resultados de Hold'em continuam Experimental. O subgame valida a arquitetura, n?o ranges gerais nem todos os boards.


## Phase 5 validation 0.3.0

Artifact: solver/artifacts/phase5-strategic-coupling-v0.3.0.json.

Preflop exact evaluation enumerates 46 compatible private deals. BR policies are selected once per information set, and tests verify that keys contain only the acting player's private combo plus public history.

Weighted-range postflop validation:

| Metric | Result |
|---|---:|
| Nodes | 11,179 |
| Infosets | 2,032 |
| Chance nodes | 967 |
| DCFR iterations | 20 |
| P0 EV | +0.129798 |
| NashConv | 0.541129 |
| Exploitability | 0.270565 |

Structural, card, chance-normalization, zero-sum, strategy-normalization and reproducibility checks passed. Convergence is insufficient for professional use.

The main provider comparison used three seeds per provider. Exact reduced-preflop mean exploitability was 0.002270 (proxy), 0.001664 (equity) and 0.024244 (solved). The solved model remained materially seed-sensitive.

Coupling validation executed three outer iterations with damping 0.6. It did not converge. This failure is preserved in the golden artifact and report.

## Phase 6 validation addendum - 0.4.0

The indexed solver is validated against the object-tree implementation as an oracle: average strategy and complete infoset checkpoint state are identical in the frozen reference test. Compiled EV and best response match the dynamic implementation; optimized hand evaluation matches the reference across 1,000 random seven-card samples; 250 -> 500 checkpoint resume matches a continuous 500-iteration run.

The 5,000-iteration reduced-game result has exploitability `0.010074`, but the strict converged-approximation policy is not satisfied because the limit is `0.01` and Solved seed distance is `0.126345`. Coupling did not converge. These checks validate implementation invariants, not professional poker accuracy. External solver comparison and independent review are still missing; Verified remains zero.
## Phase 6.5 deterministic validation layer

The frozen reference game now has an exact 46-deal training oracle in addition to exact evaluation. Validation covers chance normalization, isolated RNG streams, fixed schedules, importance weights, deal coverage, exact determinism, input-order invariance, sampled-to-exact distance, warm resume, bucket identity, finite-difference sensitivity, damping, convergence patience, period-2/3 cycles and outer checkpoint/resume.

Exact repeated runs and five provenance seeds produce distance `0`. Golden v0.5.0 records the exact oracle, deterministic provider comparison, fixed schedule, coupling trajectory and gate matrix. Golden data is a regression baseline, not poker truth.

Final gates: `A=true`, `B=true`, `C=true`, `D=false`. No dataset is Verified.

<!-- PHASE6.6 START -->
## Phase 6.6 validation

Reference game remained frozen at phase6-reference-game-v1 (bfd3615d6ee13da1). A/B/C were executed again and passed. Gate D v2 adds normalized raw fixed-point residual, LocalResponseRatio, inner-solve quality and three-pass patience; it failed. Continuous/resumed semantic checkpoint hashes match after excluding runtimeMs only. The full regression is 118/118 with a successful production build. Artifacts are Experimental and no dataset is Verified.
<!-- PHASE6.6 END -->

## Phase 6.8 validation

Artifact: `solver/artifacts/phase6-8-unified-scalability-v0.8.0.json`.

S0 preserva ground truth independente por enumeração normal-form com exploitability zero. S1–S4 usam best response, NashConv, differential oracle e invariantes metamórficos, declarados como evidência compartilhada e não como prova independente completa. Os 24 casos determinísticos validam estrutura, estratégias normalizadas, regrets, strategy sums e utilities finitos. Checkpoint V3 contínuo/resumido é idêntico. S5 é um safe abort legítimo do preflight, não um resultado omitido.

Gates do laboratório S1–S6 passaram. A/B/C/D histórico continua PASS/PASS/PASS/FAIL, os outputs são Experimental e `Verified = 0`. Validação de repositório: TypeScript, ESLint, build e 152/152 testes.

## Phase 6.9 validation

Artifact: `solver/artifacts/phase6-9-compact-tree-v0.9.0.json`.

Direct compact compilation matches the legacy and Phase 6.8 indexed engines on S0–S4. The acceptance tolerance is `1e-12`; behavioral strategies, complete regrets, strategy sums, strategy EV, best-response EV, exploitability, and NashConv pass. The largest observed BR error is floating-point noise at `2.7755575615628914e-17`. Checkpoint V4 continuous/resumed typed state hashes are identical.

S4 extended DCFR from two to 16 iterations and recorded exploitability `0.00022610393414868035`; this is empirical progress, not an equilibrium claim. S5 is a recorded safe abort under the unchanged node budget. Gates M1–M7 pass. Historical Gate D remains FAIL, all strategic output remains Experimental, and Verified remains 0.

Final validation: TypeScript PASS, ESLint PASS, production build PASS, and 168/168 tests PASS.
## Phase 6.10 validation — 0.10.0

Artefato canônico: `solver/artifacts/phase6-10-resource-safe-v0.10.0.json`.

- S2/S3/S4: duas repetições isoladas por escala, hashes semânticos estáveis.
- Calibração: pico inicial subestimou todas as seis execuções; V3 passou a usar overhead fixo 79.773.696 B e multiplicador variável 2,6713.
- S5 preflight: 352.411.221 B / 19.263 ms estimados; limite 805.306.368 B / 30.000 ms.
- S5 real: 2.097.149 nós, 174.762 infosets, profundidade 19, uma iteração; 16.946/17.669 ms e 200.675.328 B no maior pico.
- Repetibilidade S5: hash `802fdfa46193da98` nos dois processos.
- Validação estrutural S5: chance error 0, zero-sum error 0, reachable, no leakage e perfect recall.
- Subárvore controlada: EV error 0 a tolerância `1e-12`; escopo não equivale a prova full-game independente.
- Checkpoint S4 V4/V5: 927.392/349.995 B; resume determinístico e corrupção recusada.
- Failure recovery: timeout, unresponsive, memory limit, child crash, checkpoint interruption e corrupção cobertos.
- R1–R8: PASS.
- TypeScript, ESLint, build e 180/180 testes: PASS.

Trust permanece Experimental. Gate D permanece FAIL. Verified permanece 0. S5 foi iterado e avaliado, não convergiu nem foi declarado solved.

## Validation Report 0.11.0 — Phase 6.11

### Resultado

- Artifact: `phase6-11-fast-compiler-v0.11.0.json` (`800f715766ed8c5b`).
- C1–C9: PASS.
- Processos isolados: 40/40 concluídos.
- TypeScript: build e 198/198 testes passaram na suíte completa final.
- Rust: 3/3 testes; rustfmt e Clippy (`-D warnings`) aprovados.

### Equivalência

- V2 versus baseline: structural hash e numeric state idênticos.
- Cache + Checkpoint V5: state hash contínuo/restaurado `0b8d83f225fa2613a9250ac7efc7d57654fd771bd8da15bc76de07e18dbecf08`.
- Rust versus TypeScript S0–S5: integer topology exata, chance error 0, utility error máximo 2,22e-16, tolerância 1e-12.
- EV, best response, exploitability e NashConv: delta máximo da matriz ≤ 1e-10.

### Segurança e confiança

S5 manteve processo isolado, preflight, tier2 explícito, watchdog, runtime/memory budgets e logging. Nenhuma mudança de poker strategy. Gate D FAIL; Verified 0.