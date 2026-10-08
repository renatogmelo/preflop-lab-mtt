import { hashValue } from "../../core/stable";
import type { SyntheticGameConfiguration } from "../scalability/tree-size-estimator";
import { estimateSyntheticGame, validateSyntheticConfiguration } from "../scalability/tree-size-estimator";
import { assertCompactState, type CompactActor, type CompactGameProvider, type CompactLevel } from "./provider";

export const COMPACT_SYNTHETIC_PROVIDER_VERSION = "synthetic-compact-provider-v0.9.0";

function seededUnit(seed: number, label: string) {
  let state = seed >>> 0;
  for (let index = 0; index < label.length; index += 1) {
    state ^= label.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x1_0000_0000;
}

function geometricSum(base: number, terms: number) {
  if (base === 1) return terms;
  return (base ** terms - 1) / (base - 1);
}

export class SyntheticCompactProvider implements CompactGameProvider<number> {
  readonly validationClaims = { noInformationLeakage: true, perfectRecall: true } as const;
  readonly estimate;
  readonly levels: readonly CompactLevel[];
  readonly nodeCount: number;
  readonly informationSetCount: number;
  readonly maximumDepth: number;
  readonly logicalGameHash: string;
  readonly id: string;
  private readonly privateDeals: number;
  private readonly publicBranching: number;
  private readonly actionLists = new Map<number, readonly number[]>();
  private lastChanceState = -1;
  private lastChanceWeights: number[] = [];

  constructor(readonly configuration: SyntheticGameConfiguration) {
    validateSyntheticConfiguration(configuration);
    this.estimate = estimateSyntheticGame(configuration);
    this.nodeCount = this.estimate.nodes;
    this.informationSetCount = this.estimate.informationSets;
    this.maximumDepth = this.estimate.maximumDepth;
    this.privateDeals = configuration.privateStates ** 2;
    this.publicBranching = configuration.actionsPerDecision * configuration.publicSignals;
    this.id = configuration.id;
    this.logicalGameHash = hashValue({ configuration, provider: COMPACT_SYNTHETIC_PROVIDER_VERSION });
    const levels: CompactLevel[] = [{ kind: "root-chance", stage: -1, offset: 0, count: 1 }];
    let offset = 1;
    for (let stage = 0; stage < configuration.stages; stage += 1) {
      const decisions = this.privateDeals * this.publicBranching ** stage;
      levels.push({ kind: "decision", stage, offset, count: decisions });
      offset += decisions;
      const chances = decisions * configuration.actionsPerDecision;
      levels.push({ kind: "public-chance", stage, offset, count: chances });
      offset += chances;
    }
    const terminals = this.privateDeals * this.publicBranching ** configuration.stages;
    levels.push({ kind: "terminal", stage: configuration.stages, offset, count: terminals });
    offset += terminals;
    if (offset !== this.nodeCount) throw new Error("Compact level layout differs from the Phase 6.8 size estimator.");
    this.levels = levels;
  }

  initialState() { return 0; }

  stateAt(ordinal: number) {
    assertCompactState(this, ordinal);
    return ordinal;
  }

  private level(state: number) {
    assertCompactState(this, state);
    for (const level of this.levels) {
      if (state >= level.offset && state < level.offset + level.count) return level;
    }
    throw new Error(`State ${state} has no compact level.`);
  }

  actor(state: number): CompactActor {
    const level = this.level(state);
    if (level.kind === "terminal") return null;
    if (level.kind !== "decision") return "chance";
    return (level.stage % 2) as 0 | 1;
  }

  legalActions(state: number) {
    const level = this.level(state);
    const count = level.kind === "root-chance"
      ? this.privateDeals
      : level.kind === "decision"
        ? this.configuration.actionsPerDecision
        : level.kind === "public-chance"
          ? this.configuration.publicSignals
          : 0;
    const cached = this.actionLists.get(count);
    if (cached) return cached;
    const actions = Object.freeze(Array.from({ length: count }, (_, index) => index));
    this.actionLists.set(count, actions);
    return actions;
  }

  transition(state: number, action: number) {
    const level = this.level(state);
    const actions = this.legalActions(state);
    if (!Number.isInteger(action) || action < 0 || action >= actions.length) throw new Error(`Illegal compact action ${action} at state ${state}.`);
    const ordinal = state - level.offset;
    if (level.kind === "root-chance") return this.levels[1].offset + action;
    const levelIndex = this.levels.indexOf(level);
    const next = this.levels[levelIndex + 1];
    if (!next) throw new Error("Terminal states do not have transitions.");
    if (level.kind === "decision") return next.offset + ordinal * this.configuration.actionsPerDecision + action;
    if (level.kind === "public-chance") return next.offset + ordinal * this.configuration.publicSignals + action;
    throw new Error("Terminal states do not have transitions.");
  }

  private decisionCoordinates(state: number) {
    const level = this.level(state);
    if (level.kind !== "decision") throw new Error("Information sets exist only at decision states.");
    const histories = this.publicBranching ** level.stage;
    const ordinal = state - level.offset;
    const deal = Math.floor(ordinal / histories);
    return { stage: level.stage, deal, history: ordinal % histories };
  }

  informationSet(state: number) {
    const { stage, deal, history } = this.decisionCoordinates(state);
    const actor = stage % 2;
    const own = actor === 0 ? Math.floor(deal / this.configuration.privateStates) : deal % this.configuration.privateStates;
    return this.configuration.privateStates * geometricSum(this.publicBranching, stage)
      + own * this.publicBranching ** stage
      + history;
  }

  private informationSetCoordinates(informationSet: number) {
    if (!Number.isInteger(informationSet) || informationSet < 0 || informationSet >= this.informationSetCount) {
      throw new Error(`Invalid information-set id ${informationSet}.`);
    }
    for (let stage = 0; stage < this.configuration.stages; stage += 1) {
      const offset = this.configuration.privateStates * geometricSum(this.publicBranching, stage);
      const count = this.configuration.privateStates * this.publicBranching ** stage;
      if (informationSet >= offset && informationSet < offset + count) {
        const local = informationSet - offset;
        const histories = this.publicBranching ** stage;
        return { stage, own: Math.floor(local / histories), history: local % histories };
      }
    }
    throw new Error(`Information-set id ${informationSet} has no stage.`);
  }

  private historyTokens(history: number, stages: number) {
    const digits = new Uint16Array(stages);
    let remaining = history;
    for (let index = stages - 1; index >= 0; index -= 1) {
      digits[index] = remaining % this.publicBranching;
      remaining = Math.floor(remaining / this.publicBranching);
    }
    const tokens: string[] = [];
    for (let stage = 0; stage < stages; stage += 1) {
      const action = Math.floor(digits[stage] / this.configuration.publicSignals);
      const signal = digits[stage] % this.configuration.publicSignals;
      tokens.push(`a${stage}:${action}`, `s${stage}:${signal}`);
    }
    return tokens;
  }

  informationSetKey(informationSet: number) {
    const { stage, own, history } = this.informationSetCoordinates(informationSet);
    return `G|p${stage % 2}|own${own}|stage${stage}|${this.historyTokens(history, stage).join(".")}`;
  }

  informationSetActionCount(informationSet: number) {
    this.informationSetCoordinates(informationSet);
    return this.configuration.actionsPerDecision;
  }

  actionLabel(informationSet: number, action: number) {
    const count = this.informationSetActionCount(informationSet);
    if (!Number.isInteger(action) || action < 0 || action >= count) throw new Error(`Invalid action ${action} for information set ${informationSet}.`);
    return `a${action}`;
  }

  private chanceCoordinates(state: number) {
    const level = this.level(state);
    if (level.kind === "root-chance") return { root: true as const, stage: -1, deal: -1, history: 0, action: 0 };
    if (level.kind !== "public-chance") throw new Error("Chance probability requested from a non-chance state.");
    const decisionOrdinal = Math.floor((state - level.offset) / this.configuration.actionsPerDecision);
    const action = (state - level.offset) % this.configuration.actionsPerDecision;
    const histories = this.publicBranching ** level.stage;
    return { root: false as const, stage: level.stage, deal: Math.floor(decisionOrdinal / histories), history: decisionOrdinal % histories, action };
  }

  chanceProbability(state: number, action: number) {
    const coordinates = this.chanceCoordinates(state);
    if (coordinates.root) {
      if (action < 0 || action >= this.privateDeals) throw new Error("Invalid private-deal chance action.");
      return 1 / this.privateDeals;
    }
    if (action < 0 || action >= this.configuration.publicSignals) throw new Error("Invalid public-signal chance action.");
    if (this.lastChanceState !== state) {
      const first = Math.floor(coordinates.deal / this.configuration.privateStates);
      const second = coordinates.deal % this.configuration.privateStates;
      const history = this.historyTokens(coordinates.history, coordinates.stage);
      history.push(`a${coordinates.stage}:${coordinates.action}`);
      const label = `${first}|${second}|${history.join("|")}`;
      const weights = Array.from({ length: this.configuration.publicSignals }, (_, signal) => 1 + Math.floor(seededUnit(this.configuration.seed, `${label}|${signal}`) * 9));
      const total = weights.reduce((sum, value) => sum + value, 0);
      this.lastChanceWeights = weights.map((value) => value / total);
      this.lastChanceState = state;
    }
    return this.lastChanceWeights[action];
  }

  terminalUtilityP0(state: number) {
    const level = this.level(state);
    if (level.kind !== "terminal") return null;
    const histories = this.publicBranching ** this.configuration.stages;
    const ordinal = state - level.offset;
    const deal = Math.floor(ordinal / histories);
    const historyCode = ordinal % histories;
    const first = Math.floor(deal / this.configuration.privateStates);
    const second = deal % this.configuration.privateStates;
    const history = this.historyTokens(historyCode, this.configuration.stages);
    const denominator = Math.max(1, this.configuration.privateStates - 1);
    let value = (first - second) / denominator;
    if (this.configuration.dependencyComplexity !== "independent") {
      for (let stage = 0; stage < this.configuration.stages; stage += 1) {
        const action = Number(history[stage * 2].split(":")[1]);
        const actor = stage % 2;
        const privateState = actor === 0 ? first : second;
        const aligned = action === privateState % this.configuration.actionsPerDecision;
        value += (actor === 0 ? 1 : -1) * (aligned ? 0.45 : -0.12);
      }
    }
    if (this.configuration.dependencyComplexity === "history-coupled") {
      for (let stage = 0; stage < this.configuration.stages; stage += 1) {
        const signal = Number(history[stage * 2 + 1].split(":")[1]);
        const direction = stage % 2 === 0 ? 1 : -1;
        value += direction * (signal - (this.configuration.publicSignals - 1) / 2) * 0.08;
      }
    }
    value += (seededUnit(this.configuration.seed, `utility|${first}|${second}|${history.join("|")}`) - 0.5) * 0.02;
    return Math.tanh(value);
  }

  terminalUtility(state: number): readonly [number, number] | null {
    const value = this.terminalUtilityP0(state);
    return value === null ? null : [value, -value];
  }
}

