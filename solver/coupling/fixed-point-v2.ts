import type { SolverCard } from "../cards/cards";
import { privateDealDistribution } from "../cards/private-chance";
import { WeightedRange } from "../cards/range";
import type { ContinuationRequest, ContinuationResult, StrategicContinuationProvider } from "../continuation/engine";
import { hashValue } from "../core/stable";
import type { BehavioralStrategy } from "../core/types";
import { residualNorms, SafeguardedAnderson, vectorNorms } from "../analysis/phase6-6";
import { compiledInformationSetReach, strategyStability } from "../evaluation/compiled-analysis";
import { HoldemPreflopEvaluationGame, HoldemPreflopStrategyEvaluator } from "../evaluation/holdem-preflop";
import { ExactHoldemPreflopSolver, type ExactPreflopSolveConfiguration } from "../game/holdem-preflop-exact";
import { applyBettingAction, createPreflopBettingState } from "../game/betting";
import {
  createHoldemPreflopV2Definition,
  holdemPreflopActionId,
  holdemPreflopLegalActions,
  type HoldemPreflopV2Configuration,
} from "../game/holdem-preflop-v2";
import {
  RangePostflopHoldemSubgame,
  solveRangePostflopToQuality,
  type FutureBoardProvider,
  type InnerQualityGateConfiguration,
  type QualityGatedRangePostflopArtifact,
  type RangePostflopAbstraction,
  type RangePostflopSolveConfiguration,
} from "../game/range-postflop-subgame";
import {
  conditionalRangeL1,
  deriveConditionalJointDealSnapshot,
  deriveConditionalRangeSnapshots,
  weightedRangeFromSnapshot,
  type ConditionalRangeSnapshot,
} from "../ranges/conditional";
import { compileGameTree } from "../tree/compiled";

type UtilityEntry = [string, [number, number]];

export type FixedPointMethod = "plain-damping" | "adaptive-damping" | "safeguarded-anderson";

export type GateDV2Thresholds = {
  preflopReachWeightedDelta: number;
  conditionalRangeL1: number;
  normalizedRawContinuationResidual: number;
  dampedContinuationDelta: number;
  postflopReachWeightedDelta: number;
  localResponseRatio: number;
  patience: 3;
};

export type CouplingV2Configuration = {
  preflop: HoldemPreflopV2Configuration;
  exactPreflop: ExactPreflopSolveConfiguration;
  ranges: [WeightedRange, WeightedRange];
  actionHistory: string[];
  flop: [SolverCard, SolverCard, SolverCard];
  postflopAbstraction: RangePostflopAbstraction;
  boardProvider: FutureBoardProvider;
  postflopSolve: RangePostflopSolveConfiguration;
  innerQuality: InnerQualityGateConfiguration;
  outerIterations: number;
  dampingAlpha: number;
  method: FixedPointMethod;
  adaptiveDamping?: { minimum: number; maximum: number; shrink: number; grow: number };
  anderson?: { history: 2 | 3 | 5; regularization: number; safeguardFactor: number };
  gateD: GateDV2Thresholds;
};

export type CouplingV2Metric = {
  outerIteration: number;
  method: FixedPointMethod;
  alpha: number;
  preflopReachWeightedDelta: number | null;
  conditionalRangeDelta: number | null;
  rawContinuationResidual: ReturnType<typeof residualNorms>;
  dampedContinuationDelta: number;
  postflopReachWeightedDelta: number | null;
  localResponseRatio: number | null;
  innerQualityPassed: boolean;
  innerQualityStatus: "passed" | "inner-quality-failed";
  convergencePass: boolean;
  consecutivePasses: number;
  acceleratedStep: boolean;
  acceleratedStepAccepted: boolean | null;
  rejectedAccelerationSteps: number;
  runtimeMs: number;
};

export type CouplingV2Checkpoint = {
  schemaVersion: 2;
  configurationHash: string;
  completedIterations: number;
  stateValues: UtilityEntry[];
  previousMappedValues: UtilityEntry[] | null;
  previousInputValues: UtilityEntry[] | null;
  previousPreflop: BehavioralStrategy | null;
  previousSnapshots: [ConditionalRangeSnapshot, ConditionalRangeSnapshot] | null;
  previousPostflop: BehavioralStrategy | null;
  metrics: CouplingV2Metric[];
  residualHistory: Array<{ outerIteration: number; l1: number; l2: number; lInfinity: number; reachWeighted: number; normalizedL2: number }>;
  innerQualityHistory: Array<{ outerIteration: number; passed: boolean; status: string; points: QualityGatedRangePostflopArtifact["innerQuality"]["points"] }>;
  convergencePasses: boolean[];
  accelerationState: ReturnType<SafeguardedAnderson["checkpoint"]> | null;
  pendingAcceleration: { accelerated: boolean; referenceResidual: number } | null;
  currentAlpha: number;
};

function pairKey(first: string, second: string) {
  return first + "|" + second;
}

export class FixedPointPairContinuationProvider implements StrategicContinuationProvider {
  readonly level = 2 as const;
  readonly eligibleForVerified = false;
  readonly id: string;

  constructor(
    readonly values: ReadonlyMap<string, [number, number]>,
    readonly boardModel: string,
  ) {
    this.id = "fixed-point-pair-provider:" + hashValue({
      boardModel,
      values: [...values].sort(([left], [right]) => left.localeCompare(right)),
    });
  }

  evaluate(request: ContinuationRequest): ContinuationResult {
    const fixed = request.ranges.fixedCombos;
    if (!fixed) throw new Error("Fixed-point pair provider requires concrete private cards.");
    const utilities = this.values.get(pairKey(fixed[0].id, fixed[1].id));
    if (!utilities) throw new Error("Fixed-point state is missing pair " + pairKey(fixed[0].id, fixed[1].id) + ".");
    return {
      utilities,
      model: this.id,
      chanceResolution: { method: "abstracted", description: "Values belong to the declared Phase 6.6 board continuation model." },
      strategicSolution: { status: "unvalidated" },
      metadata: { boardContinuationModel: this.boardModel, trust: "Experimental" },
      computationId: hashValue({ provider: this.id, pair: fixed.map((combo) => combo.id), utilities }),
    };
  }
}

function terminalState(configuration: HoldemPreflopV2Configuration, history: string[]) {
  let state = createPreflopBettingState(createHoldemPreflopV2Definition(configuration));
  history.forEach((selected) => {
    const action = holdemPreflopLegalActions(configuration, state).find((candidate) => holdemPreflopActionId(candidate) === selected);
    if (!action) throw new Error("Illegal Coupling V2 path action " + selected + ".");
    state = applyBettingAction(state, action);
  });
  if (!state.complete) throw new Error("Coupling V2 path must end at a continuation terminal.");
  return state;
}

function sortedEntries(values: ReadonlyMap<string, [number, number]>) {
  return [...values].sort(([left], [right]) => left.localeCompare(right));
}

function vector(keys: readonly string[], values: ReadonlyMap<string, [number, number]>) {
  return keys.map((key) => {
    const value = values.get(key);
    if (!value) throw new Error("Fixed-point vector is missing key " + key + ".");
    return value[0];
  });
}

function utilityMap(keys: readonly string[], values: readonly number[]) {
  return new Map(keys.map((key, index) => [key, [values[index], -values[index]]] as UtilityEntry));
}

function artifactValues(artifact: QualityGatedRangePostflopArtifact) {
  return new Map(artifact.pairUtilities.map((entry) => [entry.pairKey, entry.utilities] as UtilityEntry));
}

function trailingPasses(passes: readonly boolean[]) {
  let count = 0;
  for (let index = passes.length - 1; index >= 0 && passes[index]; index -= 1) count += 1;
  return count;
}

export class CoupledFixedPointSolverV2 {
  readonly configurationHash: string;
  readonly keys: string[];

  constructor(
    readonly configuration: CouplingV2Configuration,
    readonly initialValues: ReadonlyMap<string, [number, number]>,
    readonly initializationId: string,
  ) {
    if (!(configuration.dampingAlpha > 0 && configuration.dampingAlpha <= 1)) throw new Error("Damping alpha must be in (0, 1].");
    if (configuration.gateD.patience !== 3) throw new Error("Gate D v2 requires exactly three consecutive passes.");
    this.keys = privateDealDistribution(configuration.ranges[0], configuration.ranges[1], configuration.flop)
      .map((deal) => pairKey(deal.playerZero.id, deal.playerOne.id)).sort();
    this.keys.forEach((key) => {
      if (!initialValues.has(key)) throw new Error("Initial fixed-point state is missing " + key + ".");
    });
    this.configurationHash = hashValue({
      ...configuration,
      ranges: configuration.ranges.map((range) => range.entries().map(({ combo, weight }) => [combo.id, weight])),
      boardProvider: configuration.boardProvider.metadata(),
      initializationId,
    });
  }

  private exactPreflop(values: ReadonlyMap<string, [number, number]>) {
    return new ExactHoldemPreflopSolver(
      this.configuration.preflop,
      this.configuration.ranges,
      new FixedPointPairContinuationProvider(values, this.configuration.boardProvider.boardContinuationModel),
      this.configuration.exactPreflop,
      this.configuration.flop,
    ).solve();
  }

  solve(resume?: CouplingV2Checkpoint, stopAfter = this.configuration.outerIterations) {
    if (resume && resume.configurationHash !== this.configurationHash) throw new Error("Coupling V2 checkpoint configuration mismatch.");
    if (!Number.isInteger(stopAfter) || stopAfter <= 0 || stopAfter > this.configuration.outerIterations) throw new Error("Invalid Coupling V2 stop iteration.");
    const terminal = terminalState(this.configuration.preflop, this.configuration.actionHistory);
    const pot = terminal.pot;
    const stacks = terminal.players.map((player) => player.stack) as [number, number];
    let stateValues = resume ? new Map(resume.stateValues) : new Map(this.initialValues);
    let previousMappedValues = resume?.previousMappedValues ? new Map(resume.previousMappedValues) : null;
    let previousInputValues = resume?.previousInputValues ? new Map(resume.previousInputValues) : null;
    let previousPreflop = resume?.previousPreflop ?? null;
    let previousSnapshots = resume?.previousSnapshots ?? null;
    let previousPostflop = resume?.previousPostflop ?? null;
    const metrics = resume ? [...resume.metrics] : [];
    const residualHistory = resume ? [...resume.residualHistory] : [];
    const innerQualityHistory = resume ? [...resume.innerQualityHistory] : [];
    const convergencePasses = resume ? [...resume.convergencePasses] : [];
    let currentAlpha = resume?.currentAlpha ?? this.configuration.dampingAlpha;
    const andersonConfig = this.configuration.anderson ?? { history: 3 as const, regularization: 1e-8, safeguardFactor: 1.25 };
    const anderson = this.configuration.method === "safeguarded-anderson"
      ? new SafeguardedAnderson(andersonConfig.history, andersonConfig.regularization, andersonConfig.safeguardFactor)
      : null;
    if (anderson && resume?.accelerationState) anderson.restore(resume.accelerationState);
    let pendingAcceleration = resume?.pendingAcceleration ?? null;
    const artifacts: QualityGatedRangePostflopArtifact[] = [];
    let finalPreflop: ReturnType<ExactHoldemPreflopSolver["solve"]> | null = null;
    let finalSnapshots: [ConditionalRangeSnapshot, ConditionalRangeSnapshot] | null = previousSnapshots;
    let stopReason: "iterations" | "converged" | "inner-quality-failed" = "iterations";
    const firstIteration = (resume?.completedIterations ?? 0) + 1;

    for (let outerIteration = firstIteration; outerIteration <= stopAfter; outerIteration += 1) {
      const started = performance.now();
      const preflop = this.exactPreflop(stateValues);
      const input = {
        configuration: this.configuration.preflop,
        ranges: this.configuration.ranges,
        strategy: preflop.strategy,
        actionHistory: this.configuration.actionHistory,
        board: this.configuration.flop,
        sourceSolveId: preflop.id,
      };
      const snapshots = deriveConditionalRangeSnapshots(input);
      const joint = deriveConditionalJointDealSnapshot(input);
      const conditioned: [WeightedRange, WeightedRange] = [
        weightedRangeFromSnapshot(snapshots[0], this.configuration.ranges[0]),
        weightedRangeFromSnapshot(snapshots[1], this.configuration.ranges[1]),
      ];
      const definition = {
        id: "phase6-6-coupled:" + this.configuration.boardProvider.boardContinuationModel + ":" + outerIteration,
        ranges: conditioned,
        privateDeals: joint.deals.map((deal) => ({ ...deal })),
        flop: this.configuration.flop,
        pot,
        stacks,
        firstPlayer: 1 as const,
        abstraction: this.configuration.postflopAbstraction,
        boardProvider: this.configuration.boardProvider,
        rangeSource: {
          playerZeroSnapshotId: snapshots[0].id,
          playerOneSnapshotId: snapshots[1].id,
          description: "Exact joint Bayesian posterior; product-of-marginals reconstruction is not used.",
        },
      };
      const postflop = solveRangePostflopToQuality(definition, this.configuration.postflopSolve, this.configuration.innerQuality);
      artifacts.push(postflop);
      innerQualityHistory.push({
        outerIteration,
        passed: postflop.innerQuality.passed,
        status: postflop.innerQuality.status,
        points: postflop.innerQuality.points,
      });
      const mappedValues = artifactValues(postflop);
      const stateVector = vector(this.keys, stateValues);
      const mappedVector = vector(this.keys, mappedValues);
      const reachWeights = this.keys.map((key) => joint.deals.find((deal) => pairKey(deal.playerZero.id, deal.playerOne.id) === key)?.probability ?? 0);
      const residual = residualNorms(stateVector, mappedVector, reachWeights);
      let acceleratedStep = false;
      let acceleratedStepAccepted: boolean | null = null;
      if (anderson && pendingAcceleration?.accelerated) {
        acceleratedStepAccepted = anderson.safeguard(residual.l2, pendingAcceleration.referenceResidual);
      }
      if (this.configuration.method === "adaptive-damping" && residualHistory.length) {
        const previousResidual = residualHistory.at(-1)!.l2;
        const adaptive = this.configuration.adaptiveDamping ?? { minimum: 0.01, maximum: 0.25, shrink: 0.5, grow: 1.2 };
        currentAlpha = residual.l2 > previousResidual
          ? Math.max(adaptive.minimum, currentAlpha * adaptive.shrink)
          : Math.min(adaptive.maximum, currentAlpha * adaptive.grow);
      }
      let nextVector = stateVector.map((value, index) => value + currentAlpha * residual.residual[index]);
      if (anderson) {
        const proposal = anderson.propose(stateVector, mappedVector, nextVector);
        nextVector = proposal.candidate;
        acceleratedStep = proposal.accelerated;
        pendingAcceleration = { accelerated: proposal.accelerated, referenceResidual: residual.l2 };
      } else {
        pendingAcceleration = null;
      }
      const dampedDelta = vectorNorms(nextVector.map((value, index) => value - stateVector[index]), reachWeights).lInfinity;

      let preflopDelta: number | null = null;
      if (previousPreflop) {
        const game = new HoldemPreflopEvaluationGame(
          this.configuration.preflop,
          this.configuration.ranges,
          new FixedPointPairContinuationProvider(stateValues, this.configuration.boardProvider.boardContinuationModel),
          this.configuration.flop,
        );
        const evaluator = new HoldemPreflopStrategyEvaluator(game);
        const reach = compiledInformationSetReach(evaluator.compiled.root, preflop.strategy);
        preflopDelta = strategyStability(previousPreflop, preflop.strategy, reach, 1e-10).reachWeightedStrategyDelta;
      }
      const rangeDelta = previousSnapshots
        ? Math.max(conditionalRangeL1(previousSnapshots[0], snapshots[0]), conditionalRangeL1(previousSnapshots[1], snapshots[1]))
        : null;
      let postflopDelta: number | null = null;
      if (previousPostflop) {
        const compiled = compileGameTree(new RangePostflopHoldemSubgame(definition));
        const reach = compiledInformationSetReach(compiled.root, postflop.strategy);
        postflopDelta = strategyStability(previousPostflop, postflop.strategy, reach, 1e-10).reachWeightedStrategyDelta;
      }
      let responseRatio: number | null = null;
      if (previousMappedValues && previousInputValues) {
        const priorMapped = vector(this.keys, previousMappedValues);
        const priorState = vector(this.keys, previousInputValues);
        const inputMovement = vectorNorms(stateVector.map((value, index) => value - priorState[index])).l2;
        const outputMovement = vectorNorms(mappedVector.map((value, index) => value - priorMapped[index])).l2;
        responseRatio = inputMovement > 1e-15 ? outputMovement / inputMovement : outputMovement === 0 ? 0 : null;
      }
      const thresholds = this.configuration.gateD;
      const pass = postflop.innerQuality.passed
        && preflopDelta !== null && preflopDelta <= thresholds.preflopReachWeightedDelta
        && rangeDelta !== null && rangeDelta <= thresholds.conditionalRangeL1
        && residual.normalizedL2 <= thresholds.normalizedRawContinuationResidual
        && dampedDelta <= thresholds.dampedContinuationDelta
        && postflopDelta !== null && postflopDelta <= thresholds.postflopReachWeightedDelta
        && responseRatio !== null && responseRatio <= thresholds.localResponseRatio;
      convergencePasses.push(pass);
      const metric: CouplingV2Metric = {
        outerIteration,
        method: this.configuration.method,
        alpha: currentAlpha,
        preflopReachWeightedDelta: preflopDelta,
        conditionalRangeDelta: rangeDelta,
        rawContinuationResidual: residual,
        dampedContinuationDelta: dampedDelta,
        postflopReachWeightedDelta: postflopDelta,
        localResponseRatio: responseRatio,
        innerQualityPassed: postflop.innerQuality.passed,
        innerQualityStatus: postflop.innerQuality.status,
        convergencePass: pass,
        consecutivePasses: trailingPasses(convergencePasses),
        acceleratedStep,
        acceleratedStepAccepted,
        rejectedAccelerationSteps: anderson?.rejectedSteps ?? 0,
        runtimeMs: performance.now() - started,
      };
      metrics.push(metric);
      residualHistory.push({
        outerIteration,
        l1: residual.l1,
        l2: residual.l2,
        lInfinity: residual.lInfinity,
        reachWeighted: residual.reachWeighted,
        normalizedL2: residual.normalizedL2,
      });
      finalPreflop = preflop;
      finalSnapshots = snapshots;
      previousPreflop = preflop.strategy;
      previousSnapshots = snapshots;
      previousPostflop = postflop.strategy;
      previousMappedValues = mappedValues;
      previousInputValues = new Map(stateValues);
      stateValues = utilityMap(this.keys, nextVector);
      if (!postflop.innerQuality.passed) {
        stopReason = "inner-quality-failed";
        break;
      }
      if (trailingPasses(convergencePasses) >= thresholds.patience) {
        stopReason = "converged";
        break;
      }
    }

    const checkpoint: CouplingV2Checkpoint = {
      schemaVersion: 2,
      configurationHash: this.configurationHash,
      completedIterations: metrics.at(-1)?.outerIteration ?? 0,
      stateValues: sortedEntries(stateValues),
      previousMappedValues: previousMappedValues ? sortedEntries(previousMappedValues) : null,
      previousInputValues: previousInputValues ? sortedEntries(previousInputValues) : null,
      previousPreflop,
      previousSnapshots,
      previousPostflop,
      metrics,
      residualHistory,
      innerQualityHistory,
      convergencePasses,
      accelerationState: anderson?.checkpoint() ?? null,
      pendingAcceleration,
      currentAlpha,
    };
    return {
      id: hashValue({ configurationHash: this.configurationHash, checkpoint }),
      trust: "Experimental" as const,
      verifiedDatasets: 0,
      boardContinuationModel: this.configuration.boardProvider.boardContinuationModel,
      initializationId: this.initializationId,
      method: this.configuration.method,
      converged: stopReason === "converged",
      stopReason,
      gateD: { version: 2, passed: stopReason === "converged", thresholds: this.configuration.gateD, rawResidualRequired: true },
      finalPreflop,
      finalConditionalRanges: finalSnapshots,
      postflopArtifacts: artifacts,
      metrics,
      checkpoint,
      limitation: "Fixed-point diagnostic in the declared reduced game; LocalResponseRatio is not a proof of contraction.",
    };
  }
}


