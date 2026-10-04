import { type HoleCombo, type SolverCard } from "../cards/cards";
import { EquityEngine, type EquityOptions } from "../cards/equity";
import { WeightedRange } from "../cards/range";
import { hashValue } from "../core/stable";

export type ContinuationStreet = "preflop" | "flop" | "turn" | "river";

export type ContinuationState = {
  street: ContinuationStreet;
  board: SolverCard[];
  pot: number;
  stacks: [number, number];
  contributions: [number, number];
  actingPlayer: 0 | 1;
  inPositionPlayer: 0 | 1 | null;
  actionHistory: string[];
};

export type ContinuationRanges = {
  playerZero: WeightedRange;
  playerOne: WeightedRange;
  fixedCombos?: [HoleCombo, HoleCombo];
};

export type ContinuationRequest = {
  state: ContinuationState;
  ranges: ContinuationRanges;
  context: {
    abstractionId: string;
    solverConfiguration?: unknown;
  };
};

export type ContinuationResult = {
  utilities: [number, number];
  model: string;
  confidence: "exact" | "sampled" | "modeled";
  metadata: Record<string, unknown>;
  computationId: string;
};

export interface StrategicContinuationProvider {
  readonly id: string;
  readonly level: 0 | 1 | 2;
  readonly eligibleForVerified: boolean;
  evaluate(request: ContinuationRequest): ContinuationResult;
}

const RANGE_QUANTIZATION = 1e-9;

export function rangeHash(range: WeightedRange) {
  return hashValue(range.entries()
    .filter((entry) => entry.weight > 0)
    .sort((left, right) => left.combo.id.localeCompare(right.combo.id))
    .map((entry) => [entry.combo.id, Math.round(entry.weight / RANGE_QUANTIZATION) * RANGE_QUANTIZATION]));
}

export function continuationRequestHash(request: ContinuationRequest) {
  return hashValue({
    state: request.state,
    ranges: [rangeHash(request.ranges.playerZero), rangeHash(request.ranges.playerOne)],
    fixedCombos: request.ranges.fixedCombos?.map((combo) => combo.id),
    context: request.context,
  });
}

function utilityFromEquity(equity: number, state: ContinuationState): [number, number] {
  const first = equity * state.pot - state.contributions[0];
  const second = (1 - equity) * state.pot - state.contributions[1];
  if (Math.abs(first + second) > 1e-8) throw new Error("Continuation state pot must equal total contributions.");
  return [first, second];
}

export class EquityProvider implements StrategicContinuationProvider {
  readonly id = "equity-provider-v1";
  readonly level = 1 as const;
  readonly eligibleForVerified = false;

  constructor(
    readonly engine = new EquityEngine(),
    readonly options: EquityOptions = {},
  ) {}

  evaluate(request: ContinuationRequest): ContinuationResult {
    const fixed = request.ranges.fixedCombos;
    const result = fixed
      ? this.engine.comboEquity(fixed[0], fixed[1], request.state.board, this.options)
      : this.engine.rangeEquity(request.ranges.playerZero, request.ranges.playerOne, request.state.board, this.options);
    const equity = result.equity;
    const computationId = hashValue({ provider: this.id, request: continuationRequestHash(request), result });
    return {
      utilities: utilityFromEquity(equity, request.state),
      model: this.id,
      confidence: "method" in result && result.method === "exact-enumeration" ? "exact" : "sampled",
      metadata: { ...result, warning: "Equity is not a GTO continuation value." },
      computationId,
    };
  }
}

export class RealizationModelProvider implements StrategicContinuationProvider {
  readonly id: string;
  readonly level = 1 as const;
  readonly eligibleForVerified = false;

  constructor(
    readonly equityProvider: EquityProvider,
    readonly factors: [number, number],
    readonly methodology: string,
  ) {
    if (factors.some((factor) => !Number.isFinite(factor) || factor < 0)) throw new Error("Realization factors must be non-negative finite values.");
    if (!methodology.trim()) throw new Error("A realization model requires documented methodology.");
    this.id = `realization-model-${hashValue({ factors, methodology })}`;
  }

  evaluate(request: ContinuationRequest): ContinuationResult {
    const baseline = this.equityProvider.evaluate(request);
    const raw = baseline.utilities[0] * this.factors[0];
    const utility = request.state.inPositionPlayer === 0 ? raw : -baseline.utilities[1] * this.factors[1];
    return {
      utilities: [utility, -utility],
      model: this.id,
      confidence: "modeled",
      metadata: { factors: this.factors, methodology: this.methodology, equityComputationId: baseline.computationId },
      computationId: hashValue({ provider: this.id, request: continuationRequestHash(request), baseline: baseline.computationId }),
    };
  }
}

export type SolvedContinuation = {
  utilities: [number, number];
  artifactId: string;
  exploitability: number;
  nashConv: number;
  iterations: number;
  metadata?: Record<string, unknown>;
};

export class SubgameSolverProvider implements StrategicContinuationProvider {
  readonly id = "solved-subgame-provider-v0";
  readonly level = 2 as const;
  readonly eligibleForVerified = false;

  constructor(readonly solve: (request: ContinuationRequest) => SolvedContinuation) {}

  evaluate(request: ContinuationRequest): ContinuationResult {
    const solved = this.solve(request);
    if (Math.abs(solved.utilities[0] + solved.utilities[1]) > 1e-8) throw new Error("Solved continuation must be zero-sum.");
    return {
      utilities: solved.utilities,
      model: this.id,
      confidence: "exact",
      metadata: {
        artifactId: solved.artifactId,
        exploitability: solved.exploitability,
        nashConv: solved.nashConv,
        iterations: solved.iterations,
        ...solved.metadata,
      },
      computationId: hashValue({ provider: this.id, request: continuationRequestHash(request), solved }),
    };
  }
}

export class CachedSolvedContinuationProvider implements StrategicContinuationProvider {
  readonly id: string;
  readonly level: 2;
  readonly eligibleForVerified: boolean;
  private readonly cache = new Map<string, ContinuationResult>();

  constructor(readonly inner: StrategicContinuationProvider) {
    if (inner.level !== 2) throw new Error("Solved continuation cache only accepts a Level 2 provider.");
    this.id = `cached:${inner.id}`;
    this.level = inner.level;
    this.eligibleForVerified = inner.eligibleForVerified;
  }

  evaluate(request: ContinuationRequest) {
    const key = continuationRequestHash(request);
    const existing = this.cache.get(key);
    if (existing) return { ...existing, metadata: { ...existing.metadata, cacheHit: true } };
    const result = this.inner.evaluate(request);
    this.cache.set(key, result);
    return { ...result, metadata: { ...result.metadata, cacheHit: false } };
  }

  get size() {
    return this.cache.size;
  }
}
