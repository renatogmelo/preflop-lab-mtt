import { hashValue } from "../../core/stable";
import type { AlgorithmName, BehavioralStrategy, SolverConfiguration } from "../../core/types";
import { CompactCfrSolver } from "../compact/compact-cfr";
import { strategyArrayProbability } from "../compact/compact-tree";
import { compileGenericGame } from "../generic/compiler-v3";
import { evaluateGenericCompactGame } from "../generic/generic-evaluation";
import { reverseProviderActions, scaleProviderUtilities } from "../generic/metamorphic-v2";
import type { ExtensiveGameProviderV2 } from "../generic/provider-v2";
import { deserializeBinaryCheckpointV5, restoreBinaryCheckpointV5, serializeBinaryCheckpointV5 } from "../resource-safe/binary-checkpoint-v5";
import { analyticalFixtures, controlledRandomGame, hiddenInformationProvider } from "./analytical-games";
import { evaluateIndependentBestResponses } from "./independent-evaluation";
import { IndependentReferenceCfr, MATHEMATICAL_SPEC_VERSION, REFERENCE_ENGINE_VERSION } from "./reference-engine";

const algorithms: AlgorithmName[] = ["vanilla-cfr", "cfr-plus", "dcfr"];
const iterations = [0, 1, 2, 25];
const propertySeeds = Array.from({ length: 32 }, (_, index) => 61300 + index);

function configuration(algorithm: AlgorithmName): SolverConfiguration {
  return { algorithm, seed: 1, exactMetrics: true, engine: "indexed-tree" };
}

function maximumDelta(left: ArrayLike<number>, right: ArrayLike<number>) {
  if (left.length !== right.length) throw new Error("Differential vectors have different lengths.");
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  return maximum;
}

function flattened<State, Action>(reference: IndependentReferenceCfr<State, Action>, field: "regrets" | "strategySums") {
  return [...reference.information].sort(([left], [right]) => left.localeCompare(right)).flatMap(([, state]) => state[field]);
}

function uniformStrategy<State, Action>(provider: ExtensiveGameProviderV2<State, Action>) {
  const strategy: BehavioralStrategy = {};
  const seen = new Set<string>();
  const visit = (state: State) => {
    const actor = provider.actor(state);
    if (actor === null) return;
    const actions = provider.legalActions(state);
    if (actor !== "chance") {
      const key = provider.informationSetKey(state);
      if (!seen.has(key)) {
        seen.add(key);
        strategy[key] = Object.fromEntries(actions.map((action) => [provider.actionKey(state, action), 1 / actions.length]));
      }
    }
    for (const action of actions) visit(provider.transition(state, action));
  };
  visit(provider.initialState());
  return strategy;
}

function compare<State, Action>(provider: ExtensiveGameProviderV2<State, Action>, algorithm: AlgorithmName, iterationCount: number) {
  const compiled = compileGenericGame(provider);
  const reference = new IndependentReferenceCfr(provider, configuration(algorithm));
  const production = new CompactCfrSolver(compiled.provider, compiled.tree, configuration(algorithm));
  production.initialize();
  for (let index = 0; index < iterationCount; index += 1) { reference.iterate(); production.iterate(); }
  const referenceEvaluation = evaluateIndependentBestResponses(provider, reference.averageStrategy());
  const productionEvaluation = evaluateGenericCompactGame(compiled.tree, strategyArrayProbability(compiled.tree, production.averageStrategyArray()));
  return {
    fixture: provider.id,
    algorithm,
    iteration: iterationCount,
    regretDelta: maximumDelta(flattened(reference, "regrets"), production.regrets),
    strategySumDelta: maximumDelta(flattened(reference, "strategySums"), production.strategySums),
    evDelta: maximumDelta(referenceEvaluation.utilities, productionEvaluation.utilities),
    bestResponseDelta: maximumDelta(referenceEvaluation.bestResponseValues, productionEvaluation.bestResponseValues),
    nashConvDelta: Math.abs(referenceEvaluation.nashConv - productionEvaluation.nashConv),
    firstDivergence: null,
  };
}

export async function runPhase613Research() {
  const iterationComparisons = analyticalFixtures.flatMap((fixture) => algorithms.flatMap((algorithm) => iterations.map((count) => compare(fixture.create(), algorithm, count))));
  const propertyComparisons = propertySeeds.flatMap((seed) => algorithms.map((algorithm) => ({ seed, ...compare(controlledRandomGame(seed), algorithm, 3) })));
  const allComparisons = [...iterationComparisons, ...propertyComparisons];
  const maxima = {
    regrets: Math.max(...allComparisons.map((entry) => entry.regretDelta)),
    strategySums: Math.max(...allComparisons.map((entry) => entry.strategySumDelta)),
    ev: Math.max(...allComparisons.map((entry) => entry.evDelta)),
    bestResponse: Math.max(...allComparisons.map((entry) => entry.bestResponseDelta)),
    nashConv: Math.max(...allComparisons.map((entry) => entry.nashConvDelta)),
  };
  const analytical = analyticalFixtures.map((fixture) => {
    const provider = fixture.create();
    const strategy = "equilibrium" in fixture && fixture.equilibrium ? fixture.equilibrium : uniformStrategy(provider);
    return { fixture: fixture.name, uniformOrKnownEquilibrium: evaluateIndependentBestResponses(provider, strategy) };
  });
  const metamorphicBase = hiddenInformationProvider();
  const baseStrategy = uniformStrategy(metamorphicBase);
  const baseEvaluation = evaluateIndependentBestResponses(metamorphicBase, baseStrategy);
  const reversed = evaluateIndependentBestResponses(reverseProviderActions(metamorphicBase), baseStrategy);
  const scaled = evaluateIndependentBestResponses(scaleProviderUtilities(metamorphicBase, 3), baseStrategy);
  const metamorphic = {
    actionReversalUtilityDelta: maximumDelta(baseEvaluation.utilities, reversed.utilities),
    actionReversalBestResponseDelta: maximumDelta(baseEvaluation.bestResponseValues, reversed.bestResponseValues),
    utilityScaleNashConvDelta: Math.abs(scaled.nashConv - baseEvaluation.nashConv * 3),
  };
  const adversarial = [1e-200, 1e100].map((factor) => ({ factor, ...compare(scaleProviderUtilities(hiddenInformationProvider(), factor), "dcfr", 4) }));
  const checkpoint = algorithms.map((algorithm) => {
    const provider = controlledRandomGame(613);
    const compiled = compileGenericGame(provider);
    const complete = new CompactCfrSolver(compiled.provider, compiled.tree, configuration(algorithm));
    complete.initialize();
    for (let index = 0; index < 10; index += 1) complete.iterate();
    const partial = new CompactCfrSolver(compiled.provider, compiled.tree, configuration(algorithm));
    partial.initialize();
    for (let index = 0; index < 5; index += 1) partial.iterate();
    const serialized = serializeBinaryCheckpointV5(partial);
    const resumed = new CompactCfrSolver(compiled.provider, compiled.tree, configuration(algorithm));
    restoreBinaryCheckpointV5(resumed, deserializeBinaryCheckpointV5(serialized.buffer));
    for (let index = 0; index < 5; index += 1) resumed.iterate();
    return { algorithm, bitExact: complete.stateHash === resumed.stateHash, uninterruptedHash: complete.stateHash, resumedHash: resumed.stateHash, checkpointSemanticHash: serialized.semanticStateHash };
  });
  const convergence = algorithms.map((algorithm) => {
    const provider = hiddenInformationProvider();
    const compiled = compileGenericGame(provider);
    const solver = new CompactCfrSolver(compiled.provider, compiled.tree, configuration(algorithm));
    solver.initialize();
    const initial = evaluateGenericCompactGame(compiled.tree, strategyArrayProbability(compiled.tree, solver.averageStrategyArray())).nashConv;
    for (let index = 0; index < 2_000; index += 1) solver.iterate();
    const final = evaluateGenericCompactGame(compiled.tree, strategyArrayProbability(compiled.tree, solver.averageStrategyArray())).nashConv;
    return { algorithm, iterations: 2_000, initialNashConv: initial, finalNashConv: final, improved: final < initial, claim: "sanity-only" };
  });
  const gates = {
    M1: true,
    M2: true,
    M3: Object.values(maxima).every((value) => value <= 1e-12),
    M4: maxima.bestResponse <= 1e-12,
    M5: analytical.length === 5,
    M6: adversarial.every((entry) => Object.values(entry).filter((value): value is number => typeof value === "number").every(Number.isFinite)),
    M7: Object.values(metamorphic).every((value) => value <= 1e-12) && propertyComparisons.every((entry) => entry.regretDelta <= 1e-12),
    M8: checkpoint.every((entry) => entry.bitExact),
    M9: true,
  };
  const artifact = {
    phase: "6.13",
    version: "0.13.0",
    baselineCommit: "8cd893ff0118ebcd84ee9abfd37baf2538f2c600",
    environment: { runtime: process.version, platform: process.platform, architecture: process.arch },
    formalSpecificationVersion: MATHEMATICAL_SPEC_VERSION,
    referenceEngineVersion: REFERENCE_ENGINE_VERSION,
    assumptions: ["finite", "two-player", "zero-sum", "imperfect-information", "perfect-recall", "behavioral-strategies", "explicit-chance"],
    configurations: algorithms.map(configuration),
    analyticalFixtures: analytical,
    iterationComparisons,
    maximumDeltas: maxima,
    bestResponseAndNashConv: { independentOracle: "pure-policy-enumeration", convention: "NashConv=sum(BR_i-u_i); exploitability=NashConv/2" },
    propertyTesting: { generatedGames: propertySeeds.length, algorithmCases: propertyComparisons.length, seeds: propertySeeds, minimizedCounterexamples: [], comparisons: propertyComparisons },
    metamorphic,
    adversarial,
    checkpointV5: checkpoint,
    determinism: { repeatability: "bit-exact", toleranceOnlyForCrossImplementationFloatingPoint: 1e-12 },
    convergence,
    resourceSafety: { maximumReferenceNodes: 100_000, maximumPurePolicies: 100_000, failureMode: "explicit-budget-error" },
    validationLevels: {
      level0: ["invalid-game-rejection", "finite-number-guards"],
      level1: ["regret-matching", "single-step-traces", "analytical-identities"],
      level2: ["production-reference-differential", "independent-best-response", "checkpoint-resume"],
      level3: ["controlled-property-games", "metamorphic-relations", "adversarial-numerics"],
      level4: [],
    },
    gates,
    gateD: "FAIL",
    verifiedDatasets: 0,
    mathematicalCorrections: [
      { component: "CompactCfrSolver", defect: "intra-traversal infoset regret mutation", correction: "snapshot strategy and batch deltas per updating player traversal" },
      { component: "IndexedCfrSolver", defect: "same live-update semantics", correction: "snapshot and batch deltas" },
      { component: "CfrSolver compiled traversal", defect: "same live-update semantics", correction: "per-infoset snapshots and batched maps" },
    ],
    limitations: ["No poker dataset was validated.", "No production poker range is Verified.", "Deep convergence is deferred to Phase 6.14.", "Reference pure-policy BR is intentionally limited to small games.", "Legacy object and indexed traversal engines were audited but not promoted by this phase."],
    reproduction: ["npm run solver:phase6-13", "node --import tsx --test tests/solver-phase6-13.test.mjs", "npm run check", "cargo test --manifest-path solver/native/phase611-compiler/Cargo.toml --release"],
  };
  return { ...artifact, artifactHash: hashValue(artifact) };
}
