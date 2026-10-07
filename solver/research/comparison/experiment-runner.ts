import { hashValue } from "../../core/stable";
import { DecomposedSolver, type DecomposedConfiguration } from "../decomposition/decomposed-solver";
import { operatorSensitivity } from "../decomposition/fixed-point-evaluator";
import { UnifiedResearchGame } from "../unified/game-tree";
import { solveNormalFormGroundTruth } from "../unified/ground-truth";
import { referenceGameDefinitions } from "../unified/reference-games";
import { solveUnifiedGame, verifyUnifiedCheckpointResume } from "../unified/unified-solver";
import { validateResearchGame } from "../unified/validation";
import { compareSolveToGroundTruth } from "./convergence-comparison";

export const PHASE6_7_BUDGETS = [100, 500, 1000, 2500, 5000, 10000] as const;

function decomposedConfiguration(method: DecomposedConfiguration["method"], initialization: DecomposedConfiguration["initialization"] = "uniform"): DecomposedConfiguration {
  return { innerIterations: 250, outerIterations: 20, damping: method === "undamped" ? 1 : 0.5, method, initialization };
}

function checkpointResume(game: UnifiedResearchGame) {
  const configuration = { ...decomposedConfiguration("damped"), outerIterations: 12 };
  const continuous = new DecomposedSolver(game, configuration).solve(12);
  const interrupted = new DecomposedSolver(game, configuration);
  interrupted.solve(6);
  const checkpoint = interrupted.checkpoint();
  const resumed = new DecomposedSolver(game, configuration);
  resumed.restore(checkpoint);
  const resumedResult = resumed.solve(12);
  return {
    identical: continuous.strategyHash === resumedResult.strategyHash && hashValue(continuous.metrics) === hashValue(resumedResult.metrics),
    continuousStrategyHash: continuous.strategyHash,
    resumedStrategyHash: resumedResult.strategyHash,
    checkpointHash: hashValue(checkpoint),
  };
}

export function runPhase67Research() {
  const gameResults = referenceGameDefinitions().map((definition) => {
    const game = new UnifiedResearchGame(definition);
    const validation = validateResearchGame(game);
    const groundTruth = solveNormalFormGroundTruth(game);
    const convergence = PHASE6_7_BUDGETS.map((iterations) => {
      const solve = solveUnifiedGame(game, { iterations, metricInterval: iterations, seed: 67 });
      return { iterations, ...compareSolveToGroundTruth(solve, groundTruth), averagePositiveRegret: solve.metrics.averagePositiveRegret, millisecondsPerIteration: solve.performance.millisecondsPerIteration, evaluationRuntimeMs: solve.performance.evaluationRuntimeMs };
    });
    const finalUnified = solveUnifiedGame(game, { iterations: 10000, metricInterval: 1000, seed: 67 });
    const repeatedUnified = solveUnifiedGame(game, { iterations: 10000, metricInterval: 1000, seed: 999 });
    const decomposed = (["undamped", "damped", "anderson"] as const).map((method) => {
      const solve = new DecomposedSolver(game, decomposedConfiguration(method)).solve();
      return { method, ...compareSolveToGroundTruth(solve, groundTruth), final: solve.final, performance: solve.performance, strategyHash: solve.strategyHash, experimentId: solve.experimentId, configurationHash: solve.configurationHash, checkpointHash: solve.checkpointHash };
    });
    const initializations = (["uniform", "first-action", "second-action"] as const).map((initialization) => {
      const solve = new DecomposedSolver(game, decomposedConfiguration("damped", initialization)).solve();
      return { initialization, strategyHash: solve.strategyHash, finalResidual: solve.final.residual.normalizedL2, exploitability: solve.final.exploitability, stoppedAt: solve.final.iteration };
    });
    const uniformSolve = new DecomposedSolver(game, decomposedConfiguration("damped")).solve();
    return {
      game: { id: definition.id, name: definition.name, hash: hashValue(definition), description: definition.description },
      validation,
      groundTruth,
      unified: {
        final: compareSolveToGroundTruth(finalUnified, groundTruth),
        strategyHash: finalUnified.strategyHash,
        configurationHash: finalUnified.configurationHash,
        experimentId: finalUnified.experimentId,
        checkpointHash: finalUnified.checkpointHash,
        convergence,
        reproducibility: { identicalAcrossDeclaredSeeds: finalUnified.strategyHash === repeatedUnified.strategyHash, first: finalUnified.strategyHash, second: repeatedUnified.strategyHash },
        checkpointResume: verifyUnifiedCheckpointResume(game),
        performance: finalUnified.performance,
      },
      decomposed,
      multipleInitializations: initializations,
      operatorSensitivity: operatorSensitivity(game, uniformSolve.checkpoint.strategy, 250),
      checkpointResume: checkpointResume(game),
    };
  });
  const gates = {
    U1: gameResults.every((result) => result.validation.valid),
    U2: gameResults.every((result) => result.groundTruth.evaluation.exploitability < 1e-8 && result.unified.final.exploitability < 0.01),
    U3: gameResults.every((result) => result.unified.reproducibility.identicalAcrossDeclaredSeeds && result.unified.convergence.at(-1)!.exploitability <= result.unified.convergence[0].exploitability),
    U4: gameResults.every((result) => result.decomposed.every((solve) => Number.isFinite(solve.exploitability) && Number.isFinite(solve.fixedPointResidual ?? Number.NaN))),
    U5: gameResults.every((result) => result.unified.checkpointResume.identical && result.checkpointResume.identical),
  };
  return {
    schemaVersion: 1,
    researchVersion: "0.7.0",
    trust: "Experimental",
    verifiedDatasets: 0,
    baseline: "842263ea678d0c64f15df0bd638dc9ccc5ae4080",
    algorithmVersion: { unified: "unified-cfr-dcfr-v0.7.0", decomposed: "decomposed-fixed-point-v0.7.0", groundTruth: "normal-form-support-enumeration-v1" },
    configuration: { budgets: PHASE6_7_BUDGETS, decomposed: decomposedConfiguration("damped") },
    historicalGates: { A: true, B: true, C: true, D: false },
    gates,
    games: gameResults,
    failures: Object.entries(gates).filter(([, passed]) => !passed).map(([gate]) => `${gate} failed its predeclared Phase 6.7 criterion.`),
    limitations: [
      "Synthetic two-player zero-sum games only; no poker ranges or betting recommendations are produced.",
      "Normal-form support enumeration is intentionally limited to small games.",
      "Decomposition uses finite inner solves, so its operator includes finite-solve error.",
      "Passing U gates does not change historical Gate D and does not promote any dataset to Verified.",
    ],
    artifactHashBasis: hashValue(gameResults.map((result) => ({ game: result.game, unified: { strategyHash: result.unified.strategyHash, configurationHash: result.unified.configurationHash, checkpointHash: result.unified.checkpointHash, strategyEv: result.unified.final.strategyEv, bestResponseEv: result.unified.final.bestResponseEv, exploitability: result.unified.final.exploitability, nashConv: result.unified.final.nashConv, strategyDistance: result.unified.final.strategyDistance }, decomposed: result.decomposed.map(({ method, strategyHash, fixedPointResidual, exploitability, nashConv, configurationHash, checkpointHash }) => ({ method, strategyHash, fixedPointResidual, exploitability, nashConv, configurationHash, checkpointHash })), groundTruth: result.groundTruth.strategyHash }))),
  };
}
