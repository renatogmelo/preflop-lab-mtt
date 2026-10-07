import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const artifactPath = resolve("solver/artifacts/phase6-6-continuation-operator-v0.6.0.json");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const f = (value, digits = 6) => value === null || value === undefined ? "n/a" : Number(value).toFixed(digits);
const pct = (value) => `${f(value * 100, 2)}%`;
const last = (items) => items.at(-1);
const finalConfirm = artifact.fixedPoint.confirmatory.filter((entry) => typeof entry.requestedBudget === "number").at(-1);
const finalMetric = last(finalConfirm.metrics);
const tiny = last(artifact.fixedPoint.tinyAlphaDiagnostic.metrics);
const quality = artifact.abstractionLaboratory.fixedQualityComparison;
const matrix = artifact.finiteSolveSensitivity.matrix;
const ratios = artifact.fixedPoint.responseRatios;
const hypotheses = artifact.hypotheses;

const matrixRows = matrix.map((point) => `| ${point.iterations} | ${point.requestedEpsilon} | ${f(point.maxDerivative)} | ${f(point.meanDerivative)} | ${f(point.weightedDerivative)} | ${f(point.utilityVectorL1)} | ${f(point.utilityVectorL2)} | ${f(point.maxUtilityDelta)} | ${f(point.postflopStrategyDistance.weightedMeanAbsoluteDelta)} | ${f(point.baselineQuality.exploitability)} | ${f(point.baselineQuality.nashConv)} |`).join("\n");
const directionRows = artifact.rangeAndPosterior.directions.map((entry) => `| ${entry.direction.label} | ${f(entry.transformation.amplification.normalization)} | ${f(entry.transformation.amplification.jointCompatibility)} | ${f(entry.transformation.amplification.conditionalBayes)} | ${f(entry.sensitivity.maxDerivative)} | ${f(entry.sensitivity.weightedDerivative)} | ${f(entry.localResponse.ratio)} |`).join("\n");
const dampingRows = artifact.fixedPoint.dampingScreening.map((run) => {
  const metric = last(run.metrics);
  return `| ${f(run.metrics[0].alpha, 3)} | ${run.metrics.length} | ${run.stopReason} | ${f(metric.rawContinuationResidual.normalizedL2)} | ${f(metric.dampedContinuationDelta)} | ${f(metric.conditionalRangeDelta)} | ${f(metric.localResponseRatio)} |`;
}).join("\n");
const initRows = artifact.fixedPoint.initializations.map((run) => {
  const metric = last(run.metrics);
  return `| ${run.initializationId} | ${run.metrics.length} | ${run.stopReason} | ${f(metric.rawContinuationResidual.normalizedL2)} | ${f(metric.preflopReachWeightedDelta)} | ${f(metric.conditionalRangeDelta)} | ${f(metric.localResponseRatio)} |`;
}).join("\n");
const qualityRows = ["R", "E", "X"].map((model) => {
  const item = quality[model];
  const point = last(item.innerQuality.points);
  return `| ${model} | ${item.boardContinuationModel} | ${item.innerQuality.passed ? "PASS" : "FAIL"} | ${point.iterations} | ${f(point.exploitability)} | ${f(point.nashConv)} | ${f(point.reachWeightedMovement)} |`;
}).join("\n");

async function save(name, content) {
  await writeFile(resolve(name), content.trim() + "\n", "utf8");
}

async function update(name, title, body) {
  const path = resolve(name);
  const start = "<!-- PHASE6.6 START -->";
  const end = "<!-- PHASE6.6 END -->";
  const current = await readFile(path, "utf8");
  const before = current.includes(start) ? current.slice(0, current.indexOf(start)).trimEnd() : current.trimEnd();
  await writeFile(path, `${before}\n\n${start}\n## ${title}\n\n${body.trim()}\n${end}\n`, "utf8");
}

await save("PHASE6_6_REPORT.md", `# Phase 6.6 Report — Continuation Operator Diagnosis

## Outcome

Phase 6.6 answers the central question: the deterministic preflop↔postflop operator remains unstable because finite-solve error is only part of the problem, Bayesian conditioning can amplify selected range directions, and the outer map is not locally contractive in the frozen reference game. Gate D v2 **FAILS honestly**. A/B/C remain PASS. Verified remains 0. Phase 7 is not recommended yet.

Provenance: baseline \`${artifact.baselineCommit}\`; implementation \`${artifact.implementationCommit}\`; finalizer \`${artifact.finalizationCommit}\`; reference \`${artifact.referenceGame.id}\` / \`${artifact.referenceGame.hash}\`; solver \`${artifact.solverVersion}\`.

## Gate matrix

| Gate | Result | Evidence |
|---|---|---|
| A | PASS | exploitability ${f(artifact.gates.A.exploitability)} < 0.02 |
| B | PASS | exact seed distance ${f(artifact.gates.B.seedDistance.weightedMeanAbsoluteDelta)} |
| C | PASS | Equity↔Solved RW distance ${f(artifact.gates.C.equityVsSolvedDistance.weightedMeanAbsoluteDelta)} |
| D v2 | FAIL | normalized raw residual ${f(finalMetric.rawContinuationResidual.normalizedL2)} > 0.02; range delta ${f(finalMetric.conditionalRangeDelta)} > 0.02; ratio ${f(finalMetric.localResponseRatio)} > 1; no three-pass streak |

## Mandatory answers

1. **Did sensitivity fall with more postflop iterations?** Partly, but not monotonically.
2. **How much?** At ε=1e-3, reach-weighted derivative fell from ${f(34.980214623071205)} at 50 to a minimum ${f(8.555678687423924)} at 1,000 (${pct(1 - 8.555678687423924 / 34.980214623071205)} reduction), then rose to ${f(23.297250527525396)} at 5,000; the 50→5,000 reduction was ${pct(1 - artifact.finiteSolveSensitivity.trend.weightedDerivativeRatio50To5000)}.
3. **Did it fall when exploitability was controlled?** No reliable monotonic fall: matched target 0.05 gave weighted derivative ${f(8.555678687423924)}, while target 0.02 gave ${f(23.297250527525396)}. Targets 0.01 and 0.005 were not reached by 10,000.
4. **Were giant derivatives only in low-reach states?** No. Near-zero states exist, but reach-weighted derivatives remained material (up to ${f(23.297250527525396)} in the matched 0.02 solve).
5. **Did normalization amplify?** The declared directional epsilon becomes L1 probability movement 2ε, hence the internal normalization factor is exactly ~2 by construction; this is expected geometry, not the main pathology.
6. **Did conditional Bayes amplify?** Yes, direction-dependently: factor ${f(0.14829154108505468)} to ${f(1.7396497328767442)}.
7. **Did representative-card abstraction introduce relevant error?** Yes: in the controlled microgame R↔X pair-utility L2 error was ${f(artifact.abstractionLaboratory.comparison.RVsX.pairUtilityError.l2)}. This does not prove it caused Gate D.
8. **Was Expected-bucket closer to Exact?** Unresolved. E missed the common quality gate: exploitability ${f(last(quality.E.innerQuality.points).exploitability)} at 5,000 versus the 0.02 threshold.
9. **How far was R from X?** Equal-iteration pair-utility L2 ${f(artifact.abstractionLaboratory.comparison.RVsX.pairUtilityError.l2)}; fixed-quality common-action reach-weighted EV error ${f(quality.comparison.RVsX.actionEvError.reachWeighted)} across ${quality.comparison.RVsX.commonActionEntries} comparable actions.
10. **How far was E from X?** Equal-iteration pair-utility L2 ${f(artifact.abstractionLaboratory.comparison.EVsX.pairUtilityError.l2)}, but E had poor quality. Only ${quality.comparison.EVsX.commonActionEntries} identical actions were comparable; reach-weighted EV error ${f(quality.comparison.EVsX.actionEvError.reachWeighted)}.
11. **Which had lower sensitivity?** At 250 equal iterations: X ${f(artifact.abstractionLaboratory.models.X.sensitivity.weightedDerivative)}, R ${f(artifact.abstractionLaboratory.models.R.sensitivity.weightedDerivative)}, E ${f(artifact.abstractionLaboratory.models.E.sensitivity.weightedDerivative)}. X was lowest; E is confounded by non-convergence.
12. **R LocalResponseRatio?** mean ${f(ratios.R.mean)}, median ${f(ratios.R.median)}, p90 ${f(ratios.R.p90)}, max ${f(ratios.R.max)}.
13. **E LocalResponseRatio?** Unavailable: C-E failed its inner quality gate on outer iteration 1.
14. **X LocalResponseRatio?** mean ${f(ratios.X.mean)}, median ${f(ratios.X.median)}, p90 ${f(ratios.X.p90)}, max ${f(ratios.X.max)}.
15. **Does the operator look locally contractive?** No. Nine range directions had ratio min ${f(ratios.directions.min)}, median ${f(ratios.directions.median)}, max ${f(ratios.directions.max)}; the full confirmatory run ended at ${f(finalMetric.localResponseRatio)}.
16. **Best alpha?** 0.15 by the predeclared short-screen raw-residual ranking. It still failed Gate D.
17. **Did tiny alpha create false apparent convergence?** Yes: α=0.001 produced damped delta ${f(tiny.dampedContinuationDelta)} while normalized raw residual stayed ${f(tiny.rawContinuationResidual.normalizedL2)}. Gate D correctly rejected it.
18. **Did raw residual fall?** It reached ${f(last(artifact.fixedPoint.confirmatory[0].metrics).rawContinuationResidual.normalizedL2)} at outer 25, above 0.02, then the resumed run failed inner quality at outer 32 with ${f(finalMetric.rawContinuationResidual.normalizedL2)}.
19. **Did Anderson help?** No. Corrected safeguarded Anderson ended at ${f(artifact.fixedPoint.andersonSafeguardRevalidated.finalNormalizedRawResidual)} versus plain damping ${f(last(artifact.fixedPoint.methodComparison.find((item) => item.method === "plain-damping").metrics).rawContinuationResidual.normalizedL2)}.
20. **Were accelerated steps rejected?** Yes, ${artifact.fixedPoint.andersonSafeguardRevalidated.rejectedSteps}; fallback restored the damped baseline.
21. **Did different initial states converge together?** No. Final continuation L2 distances ranged ${f(Math.min(...artifact.fixedPoint.basinDistances.map((item) => item.continuationL2)))}–${f(Math.max(...artifact.fixedPoint.basinDistances.map((item) => item.continuationL2)))}; two runs failed inner quality.
22. **Did Gate D pass?** No.
23. **Do A/B/C still pass?** Yes, all revalidated.
24. **How many tests pass?** 118/118, plus production build.
25. **Does Verified remain zero?** Yes.
26. **Can we recommend Phase 7?** No.
27. **Exact blocker?** The full C-R map retains normalized raw residual above threshold, LocalResponseRatio >1, range instability, and eventually loses the inner quality gate. Full C-E is over the 2M node cap; micro E also fails quality.
28. **Is outer coupling still defensible?** As an Experimental diagnostic baseline only, not as a reliable production solver architecture.
29. **Should future work consider unified solving?** Yes. H5 is supported; a unified coupled game, or a mathematically stronger root-finding method over a deterministic high-quality operator, should be evaluated before product expansion.

## Validation and release

Production build passed. All 118 tests passed. Checkpoint V2 continuous/resumed semantic hashes match (${artifact.fixedPoint.checkpointResume.uninterruptedSemanticHash}); only runtimeMs is excluded. Trust remains **Experimental**, Verified = 0, and no product surface was expanded.
`);

await save("PHASE6_6_SENSITIVITY.md", `# Phase 6.6 — Finite-solve and Range Sensitivity

## Fixed-iteration matrix

| iterations | ε | max derivative | mean derivative | RW derivative | utility L1 | utility L2 | max utility Δ | strategy RW Δ | exploitability | NashConv |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${matrixRows}

The ε=1e-3 trend is non-monotonic: weighted derivative 34.980215 → 22.120920 → 11.766131 → 10.092115 → 8.555679 → 12.994494 → 23.297251. H1 is therefore **partially supported**, not sufficient.

## Fixed-quality comparison

Targets 0.05 and 0.02 were reached by both baseline and perturbation at 1,000 and 5,000 iterations respectively. Targets 0.01 and 0.005 failed by 10,000 (baseline exploitability 0.011733; perturbed 0.011530). The sensitivity did not fall monotonically when quality tightened.

## Direction and posterior audit

| direction | normalization | compatible-joint amp | Bayes amp | max derivative | RW derivative | LocalResponseRatio |
|---|---:|---:|---:|---:|---:|---:|
${directionRows}

The normalization factor ~2 is the L1 movement induced by a mass-preserving directional step ε. Compatible-deal amplification stayed near 1. Conditional Bayes was direction-dependent and reached 1.739650. All nine LocalResponseRatios were far above 1 (min ${f(ratios.directions.min)}, median ${f(ratios.directions.median)}, max ${f(ratios.directions.max)}), so instability is not a one-coordinate exception.

Twenty-eight near-zero posterior deals were retained rather than dropped. Their presence matters, but the reach-weighted derivatives show the effect is not confined to irrelevant mass.
`);

await save("PHASE6_6_ABSTRACTION.md", `# Phase 6.6 — Board Abstraction Laboratory

## Scope

This is a controlled microgame, not the reference game: two private combos per player, flop/turn/river and physical card removal preserved, with strategic river decisions and a narrowed earlier-street betting tree. The official reference game was not changed.

| model | continuation model | nodes | infosets | 250-it exploitability | RW sensitivity |
|---|---|---:|---:|---:|---:|
| R | representative-bucket | ${artifact.abstractionLaboratory.models.R.tree.nodes} | ${artifact.abstractionLaboratory.models.R.tree.informationSets} | ${f(artifact.abstractionLaboratory.models.R.solve.convergence.exploitability)} | ${f(artifact.abstractionLaboratory.models.R.sensitivity.weightedDerivative)} |
| E | expected-bucket | ${artifact.abstractionLaboratory.models.E.tree.nodes} | ${artifact.abstractionLaboratory.models.E.tree.informationSets} | ${f(artifact.abstractionLaboratory.models.E.solve.convergence.exploitability)} | ${f(artifact.abstractionLaboratory.models.E.sensitivity.weightedDerivative)} |
| X | exact-future | ${artifact.abstractionLaboratory.models.X.tree.nodes} | ${artifact.abstractionLaboratory.models.X.tree.informationSets} | ${f(artifact.abstractionLaboratory.models.X.solve.convergence.exploitability)} | ${f(artifact.abstractionLaboratory.models.X.sensitivity.weightedDerivative)} |

E and X enumerate every legal physical future card with exact conditional probability. E exposes deterministic bucket observations; X exposes physical runouts. R materializes only a representative branch. Bucket membership is stable under permutation.

## Fixed-quality result

| model | provider | gate | iterations | exploitability | NashConv | RW movement |
|---|---|---|---:|---:|---:|---:|
${qualityRows}

R and X reached the common 0.02/0.02 gate at 500 iterations. E did not: exploitability was ${f(last(quality.E.innerQuality.points).exploitability)} at 5,000. Therefore **Expected≈Exact is not established** and H2 is unresolved. Equal-iteration E errors cannot be separated from finite-solve error.

Only identical infoset/action keys are used for per-action comparison. R↔X has ${quality.comparison.RVsX.commonActionEntries} common actions and reach-weighted EV error ${f(quality.comparison.RVsX.actionEvError.reachWeighted)}. E↔X has only ${quality.comparison.EVsX.commonActionEntries} common actions and reach-weighted EV error ${f(quality.comparison.EVsX.actionEvError.reachWeighted)}; this is insufficient for promotion.

## Full-tree cap

The frozen full Expected/Exact topology projects ${artifact.performance.fullExpectedEstimate.nodes.toLocaleString("en-US")} nodes, above the 2,000,000 cap. This is primarily a cost of eager materialization/topology. It is not proof that exact enumeration is mathematically impossible. Lazy/streaming traversal, shared topology and subtree reuse require profiling in a future research phase; no cap increase or Rust migration occurred.
`);

await save("PHASE6_6_FIXED_POINT.md", `# Phase 6.6 — Fixed-point Operator and Gate D v2

## Definition

For the valid vector components, \`R(S)=F(S)-S\`. Reported norms are L1, L2, L∞ and reach-weighted. The gate uses normalized utility residual \`||R||₂ / max(1, ||S||₂, ||F(S)||₂)\`. LocalResponseRatio is \`||F(S+δ)-F(S)||₂ / ||δ||₂\`; it is a finite diagnostic, not a contraction proof.

## Predeclared Gate D v2

Preflop RW ≤0.02; range L1 ≤0.02; normalized raw continuation residual ≤0.02; damped continuation delta ≤0.02; postflop RW ≤0.02; LocalResponseRatio ≤1; inner quality PASS; three consecutive passes.

## Damping screening

| α | iterations | stop | normalized raw residual | damped Δ | range Δ | ratio |
|---:|---:|---|---:|---:|---:|---:|
${dampingRows}

Alpha 0.15 had the lowest screened raw residual and advanced. At outer 25 it reached raw residual ${f(last(artifact.fixedPoint.confirmatory[0].metrics).rawContinuationResidual.normalizedL2)}, but range delta ${f(last(artifact.fixedPoint.confirmatory[0].metrics).conditionalRangeDelta)} and ratio ${f(last(artifact.fixedPoint.confirmatory[0].metrics).localResponseRatio)} still failed. Resume then hit inner-quality-failed at outer 32; 100 and 200 were skipped under the predeclared stop rule.

## False convergence, methods and initialization

At α=0.001, damped delta was ${f(tiny.dampedContinuationDelta)} while raw residual was ${f(tiny.rawContinuationResidual.normalizedL2)}. The raw gate prevented false convergence.

Plain damping ended at raw ${f(last(artifact.fixedPoint.methodComparison.find((item) => item.method === "plain-damping").metrics).rawContinuationResidual.normalizedL2)}. Adaptive damping shrank α to ${f(last(artifact.fixedPoint.methodComparison.find((item) => item.method === "adaptive-damping").metrics).alpha, 3)} but raw residual remained ${f(last(artifact.fixedPoint.methodComparison.find((item) => item.method === "adaptive-damping").metrics).rawContinuationResidual.normalizedL2)}. Corrected safeguarded Anderson rejected ${artifact.fixedPoint.andersonSafeguardRevalidated.rejectedSteps} steps, restored the damped fallback, and ended at ${f(artifact.fixedPoint.andersonSafeguardRevalidated.finalNormalizedRawResidual)}. It did not help.

| initialization | iterations | stop | raw residual | preflop RW | range L1 | ratio |
|---|---:|---|---:|---:|---:|---:|
${initRows}

Final points are path-dependent: continuation L2 pair distances are ${f(Math.min(...artifact.fixedPoint.basinDistances.map((item) => item.continuationL2)))}–${f(Math.max(...artifact.fixedPoint.basinDistances.map((item) => item.continuationL2)))}. Gate D v2 FAILS.

Checkpoint schema 2 preserves state, previous map/input, strategies, residual and quality history, acceleration state and rejected steps. Continuous and resumed semantic hashes are identical (${artifact.fixedPoint.checkpointResume.uninterruptedSemanticHash}); runtimeMs is explicitly excluded.
`);

await save("PHASE6_6_HYPOTHESES.md", `# Phase 6.6 — Hypothesis Verdicts

| hypothesis | verdict | evidence |
|---|---|---|
| H1 finite-solve error | **${hypotheses.H1.verdict}** | ε=1e-3 weighted derivative fell 34.980215→8.555679 by 1,000, then rose to 23.297251 at 5,000; matched-quality sensitivity remained large. |
| H2 representative card | **${hypotheses.H2.verdict}** | R differs from X, but E failed the 0.02 quality gate at 5,000, so Expected≈Exact cannot be evaluated fairly. |
| H3 normalization/posterior | **${hypotheses.H3.verdict}** | normalization L1 factor ~2 by construction; compatible deals ~0.985–1.051; conditional Bayes 0.148–1.740 and joint posterior correlations are now preserved. |
| H4 true strategic sensitivity | **${hypotheses.H4.verdict}** | substantial sensitivity remains after matched 0.05 and 0.02 quality, but it cannot yet be cleanly separated from abstraction effects. |
| H5 fixed-point pathology | **${hypotheses.H5.verdict}** | Gate D fails; confirmatory ratio 4.368; nine range directions have ratio 27.632–45.063; multiple initial states remain separated. |

## Architectural conclusion

Finite CFR error matters but is not the sole blocker. Representative-card error is real but not proven causal because Expected-bucket did not converge adequately. The strongest evidence supports an unstable/non-contractive outer operator in this reduced architecture. Future work should first make E computationally/convergently viable or adopt a unified coupled-game formulation; it must not force D through tiny damping.
`);

await save("PHASE6_6_PERFORMANCE.md", `# Phase 6.6 — Performance and Resource Safety

The full benchmark took ${f(artifact.performance.totalRuntimeMs / 60_000, 2)} minutes on ${artifact.environment.cpuCount} logical CPUs with ${f(artifact.environment.totalMemoryBytes / 2 ** 30, 2)} GiB reported memory. It covered 28 fixed-iteration sensitivity points, four fixed-quality targets, nine deterministic directions, R/E/X microgames, eight damping alphas, confirmatory coupling, three methods, four initializations, micro coupling, tiny-alpha and checkpoint resume.

The full future-card topology remains capped: ${artifact.performance.fullExpectedEstimate.nodes.toLocaleString("en-US")} projected nodes > 2,000,000. No silent cap increase occurred. The controlled E/X microgame used 71,833 nodes; R used 181.

The 5.5M projection is not a fundamental mathematical limit. It is evidence that eager materialization is unsuitable at this scale in the current TypeScript pipeline. Candidate investigations are streaming chance expansion, lazy nodes, shared compiled topology, dynamic programming and subtree reuse. A large refactor requires profiling first. Rust migration remains deferred.

Production build and 118 tests passed. The 13.5 MB primary artifact and golden file retain configurations, hashes, failures and trajectories. Verified remains 0.
`);

await update("SOLVER_ERROR_BUDGET.md", "Phase 6.6 — Error budget V3", `
- **Preflop sampling:** resolved for exact mode; Gate B seed distance is 0.
- **Postflop finite-solve:** unresolved/material. Sensitivity improved through 1,000 iterations but worsened again at 2,500/5,000; 0.01 and 0.005 quality targets failed by 10,000.
- **Representative-card abstraction:** material R↔X utility error, but causal attribution is unresolved because E failed its quality gate.
- **Conditional-range amplification:** joint compatibility stayed near one; conditional Bayes ranged 0.148–1.740. Coupling V2 now preserves the exact joint posterior rather than reconstructing product marginals.
- **Outer fixed-point residual:** dominant blocker. Best confirmatory normalized raw residual 0.103773 at outer 25, versus 0.02 gate; resumed run failed quality at outer 32.
- **Numerical error:** deterministic seed distance 0 and semantic checkpoint identity hold; no evidence this is the blocker.
- **External-validity error:** unchanged and dominant outside the laboratory. No external solve matched to the exact game; Verified = 0.
`);

await update("SOLVER_PROGRESS.md", "PHASE 6.6 COMPLETE — 2026-10-05", `
Implemented finite/fixed-quality sensitivity, joint-posterior audit, ExpectedBucketBoardProvider, exact-future microgame, residual norms, LocalResponseRatio, adaptive inner quality, Coupling V2, safeguarded Anderson, multiple initializations, checkpoint V2, artifact/goldens and 25 new tests (20 functional + 5 golden).

Result: A PASS / B PASS / C PASS / D FAIL. Best α=0.15; outer-25 raw residual 0.103773; LocalResponseRatio 4.368. Tiny α=0.001 was correctly rejected despite damped delta 0.004784. H1 partial, H2 unresolved, H3 supported, H4 partial, H5 supported. Build + 118/118 tests pass. Verified=0. Phase 7 is not recommended.
`);

await update("SOLVER_VALIDATION.md", "Phase 6.6 validation", `
Reference game remained frozen at ${artifact.referenceGame.id} (${artifact.referenceGame.hash}). A/B/C were executed again and passed. Gate D v2 adds normalized raw fixed-point residual, LocalResponseRatio, inner-solve quality and three-pass patience; it failed. Continuous/resumed semantic checkpoint hashes match after excluding runtimeMs only. The full regression is 118/118 with a successful production build. Artifacts are Experimental and no dataset is Verified.
`);

await update("SOLVER_MATH.md", "Phase 6.6 operator definitions", `
For state vector S and deterministic map F, residual is R(S)=F(S)-S. Metrics: L1, L2, L∞, reach-weighted L1, and normalized L2 = ||R||₂/max(1,||S||₂,||F(S)||₂). LocalResponseRatio = ||F(S+δ)-F(S)||₂/||δ||₂ is a finite local diagnostic, not a Lipschitz or contraction proof. Damping changes S(next)-S but cannot reduce the raw residual by definition. Mass-preserving perturbations are normalized, nonnegative and blocker-compatible.
`);

await update("CONTINUATION_VALUES.md", "Phase 6.6 continuation policy", `
Continuation utilities entering the outer loop must pass declared exploitability and reach-weighted movement thresholds or the iteration stops as inner-quality-failed. Every artifact declares boardContinuationModel: representative-bucket, expected-bucket or exact-future. Pair utilities are carried with exact joint posterior deal weights. No finite CFR utility is called exact or Verified.
`);

await update("PREFLOP_POSTFLOP_COUPLING.md", "Phase 6.6 Coupling V2", `
Coupling V2 uses exact preflop traversal, an explicit joint Bayesian posterior, adaptive inner postflop budget, raw/damped value separation, component residuals, LocalResponseRatio and schema-2 checkpoints. Plain, adaptive and safeguarded-Anderson methods were compared. The full C-R operator failed Gate D; C-E full was blocked by the node cap and micro C-E failed inner quality; micro C-X remained unstable. Outer coupling is retained only as an Experimental diagnostic baseline.
`);

await update("POSTFLOP_ABSTRACTION.md", "Phase 6.6 R/E/X ablation", `
R uses one representative card per deterministic bucket. E enumerates each legal physical card with exact chance probability but exposes only a deterministic bucket observation. X enumerates and exposes physical runouts. The controlled tree has 181 R nodes and 71,833 E/X nodes. R and X reached the fixed quality gate; E did not at 5,000 iterations, so Expected≈Exact remains unresolved. The full 5,533,605-node projection stays over the 2,000,000 cap.
`);

await update("PROGRESS.md", "Phase 6.6 solver status", `
Solver 0.6.0 completed the continuation-operator diagnosis without product expansion. Gates: A ✅, B ✅, C ✅, D ❌. Verified = 0. Main blocker: non-small raw fixed-point residual and response ratios above one, with path dependence and intermittent inner-quality failure. Phase 7 is not authorized/recommended; next research should stabilize E or evaluate unified solving.
`);

console.log("Phase 6.6 documentation rendered from", artifactPath);
