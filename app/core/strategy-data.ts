import {
  ACTIONS,
  POSITIONS,
  STACKS,
  type ActionKey,
  type CoverageEntry,
  type CoverageMetrics,
  type DatasetMetadata,
  type DatasetWorkflowStatus,
  type NodeAction,
  type Position,
  type ScenarioKey,
  type SerializedStrategyDataset,
  type StrategyAction,
  type StrategyLookup,
  type StrategyNode,
  type StrategyProvenance,
  type ResolutionPolicy,
  type StrategyTrustLevel,
  type StrategyQuery,
  type ValidationIssue,
  type ValidationReport,
} from "./domain";
import { HAND_CLASSES, HAND_CLASS_SET } from "./hands";
import { modeledStrategy } from "./modeled-provider";
import solverExperimentalDatasetJson from "../../datasets/solver-experimental/holdem-poc-v0.1.0.json";

export const AUTO_DATASET_ID = "auto";
export const MODELED_DATASET_ID = "mtt-8max-chipev-educational-model";
export const REFERENCE_DATASET_ID = "preflop-lab-reference";
export const SOLVER_EXPERIMENTAL_DATASET = solverExperimentalDatasetJson as unknown as SerializedStrategyDataset;
export const SOLVER_EXPERIMENTAL_DATASET_ID = SOLVER_EXPERIMENTAL_DATASET.metadata.id;
export const COVERAGE_STACKS = [10, 15, 20, 30, 40, 60, 100];

export const MODELED_METADATA: DatasetMetadata = {
  id: MODELED_DATASET_ID,
  name: "MTT 8-max ChipEV — modelo educacional",
  version: "1.0.0",
  createdAt: "2026-10-03T00:00:00.000Z",
  updatedAt: "2026-10-03T00:00:00.000Z",
  generatedAt: "2026-10-03T00:00:00.000Z",
  sourceType: "modeled",
  trustLevel: "modeled",
  status: "published",
  gameType: "MTT",
  model: "ChipEV",
  format: "8-max",
  players: 8,
  anteStructure: "BB ante 1bb; SB 0.5bb; BB 1bb",
  availableStacks: [...STACKS],
  availableOpenSizes: [2, 2.1, 2.2],
  available3betSizes: [5.2, 6, 6.8, 8],
  supportedNodes: ["rfi", "vs-open", "vs-3bet", "bb-defense", "bvb", "squeeze", "vs-jam"],
  methodology: "Modelo heurístico auditável baseado em força relativa, posição, stack e funções estruturais das mãos; não executa solving de equilibrium.",
  frequencyPrecision: "estimated",
  evAvailable: false,
  isExact: false,
  license: "Proprietary Preflop Lab educational model; no third-party ranges included.",
  changeLog: [{ version: "1.0.0", date: "2026-10-03", changes: ["Provider heurístico isolado e rotulado como fallback educacional."] }],
  notes: "Frequências aproximadas geradas pelo modelo educacional legado. Não são um solve verificado. EV indisponível.",
  enabled: true,
};

const modeledProvenance: StrategyProvenance = {
  datasetId: MODELED_DATASET_ID,
  datasetVersion: MODELED_METADATA.version,
  sourceType: "modeled",
  trustLevel: "modeled",
  sourceLabel: "Modelo educacional",
  isExact: false,
  frequencyPrecision: "estimated",
  evAvailable: false,
  methodology: MODELED_METADATA.methodology,
  license: MODELED_METADATA.license,
  status: MODELED_METADATA.status,
  reviewedAt: MODELED_METADATA.reviewedAt,
  notes: MODELED_METADATA.notes,
};

export const REFERENCE_METADATA: DatasetMetadata = {
  id: REFERENCE_DATASET_ID,
  name: "Preflop Lab Reference Strategy",
  version: "0.1.0",
  createdAt: "2026-10-03T00:00:00.000Z",
  updatedAt: "2026-10-03T00:00:00.000Z",
  generatedAt: "2026-10-03T00:00:00.000Z",
  trustLevel: "curated",
  sourceType: "reviewed",
  status: "draft",
  gameType: "MTT",
  model: "ChipEV",
  format: "8-max",
  players: 8,
  anteStructure: "BB ante 1bb; SB 0.5bb; BB 1bb",
  availableStacks: [...COVERAGE_STACKS],
  availableOpenSizes: [2, 2.1, 2.2],
  available3betSizes: [5.2, 6, 6.8, 8],
  supportedNodes: ["rfi", "vs-open", "vs-3bet", "bb-defense", "bvb", "squeeze", "vs-jam"],
  methodology: "Ranges explicitamente definidos e revisados por humanos. Nenhum node é publicado sem revisão explícita.",
  frequencyPrecision: "rounded",
  evAvailable: false,
  isExact: false,
  license: "Preflop Lab original curated data; third-party proprietary ranges prohibited.",
  changeLog: [{ version: "0.1.0", date: "2026-10-03", changes: ["Infraestrutura editorial criada; nenhum range publicado."] }],
  notes: "Dataset parcial. Ausência de node é preservada; o modelo nunca é promovido automaticamente.",
  enabled: true,
};

export function defaultOpenSize(stack: number) {
  return stack <= 25 ? 2 : stack <= 40 ? 2.1 : 2.2;
}

export function defaultThreeBetSize(stack: number, aggressor?: Position) {
  const outOfPosition = aggressor === "SB" || aggressor === "BB";
  return stack <= 25 ? (outOfPosition ? 6 : 5.2) : (outOfPosition ? 8 : 6.8);
}

function postedBlind(position?: Position) {
  return position === "SB" ? .5 : position === "BB" ? 1 : 0;
}

function previousPosition(hero: Position) {
  const index = POSITIONS.indexOf(hero);
  return POSITIONS[Math.max(0, index - 1)];
}

function nextPosition(hero: Position) {
  const index = POSITIONS.indexOf(hero);
  return POSITIONS[Math.min(POSITIONS.length - 1, index + 1)];
}

export function normalizeQuery(input: StrategyQuery): StrategyQuery {
  const query = { ...input };
  if ((query.scenario === "vs-open" || query.scenario === "vs-jam") && !query.villain) query.villain = previousPosition(query.hero);
  if (query.scenario === "bb-defense") {
    query.hero = "BB";
    query.villain ??= "BTN";
  }
  if (query.scenario === "bvb") {
    query.hero = "SB";
    query.villain = "BB";
  }
  if (query.scenario === "vs-3bet") query.villain ??= nextPosition(query.hero);
  if (query.scenario === "squeeze") {
    const heroIndex = POSITIONS.indexOf(query.hero);
    const validVillain = query.villain && POSITIONS.indexOf(query.villain) < heroIndex;
    const validCaller = query.caller && POSITIONS.indexOf(query.caller) < heroIndex && query.caller !== query.villain;
    if (!validVillain) query.villain = POSITIONS[Math.max(0, heroIndex - 2)];
    if (!validCaller) query.caller = POSITIONS[Math.max(1, heroIndex - 1)];
  }
  query.openSize ??= defaultOpenSize(query.stack);
  if (query.scenario === "vs-3bet") query.threeBetSize ??= defaultThreeBetSize(query.stack, query.villain);
  return query;
}

export function queryKey(input: StrategyQuery) {
  const query = normalizeQuery(input);
  return [
    query.datasetId,
    query.gameType,
    query.model,
    query.format,
    query.players,
    query.stack,
    query.hero,
    query.scenario,
    query.villain ?? "-",
    query.caller ?? "-",
    query.openSize ?? "-",
    query.threeBetSize ?? "-",
  ].join("|");
}

export function nodeId(input: StrategyQuery) {
  return "node:" + queryKey(input).replace(/[^a-zA-Z0-9.|-]/g, "_");
}

export function scenarioIsCompatible(scenario: ScenarioKey, hero: Position | "Todos", stack?: number) {
  if (scenario === "vs-jam" && stack !== undefined && stack > 25) return false;
  if (scenario === "vs-3bet" && stack !== undefined && stack <= 12) return false;
  if (hero === "Todos") return true;
  const index = POSITIONS.indexOf(hero);
  if (scenario === "rfi") return hero !== "BB";
  if (scenario === "vs-open" || scenario === "vs-jam") return index >= 1;
  if (scenario === "vs-3bet") return hero !== "BB";
  if (scenario === "bb-defense") return hero === "BB";
  if (scenario === "bvb") return hero === "SB";
  return index >= 2;
}

function firstAction(position: Position) {
  return position === "UTG"
    ? ({ position, text: "UTG é o primeiro a agir" } as NodeAction)
    : ({ position, text: "Fold até " + position } as NodeAction);
}

function nodeHistory(query: StrategyQuery) {
  const history: NodeAction[] = [];
  const openSize = query.openSize ?? defaultOpenSize(query.stack);
  const threeBetSize = query.threeBetSize ?? defaultThreeBetSize(query.stack, query.villain);
  let pot = 2.5;
  if (query.scenario === "rfi" || query.scenario === "bvb") history.push(firstAction(query.hero));
  if ((query.scenario === "vs-open" || query.scenario === "bb-defense") && query.villain) {
    history.push(firstAction(query.villain));
    history.push({ position: query.villain, action: "raise", sizeBb: openSize, text: query.villain + " raise " + openSize + "bb" });
    pot += openSize - postedBlind(query.villain);
  }
  if (query.scenario === "vs-3bet" && query.villain) {
    history.push(firstAction(query.hero));
    history.push({ position: query.hero, action: "raise", sizeBb: openSize, text: query.hero + " raise " + openSize + "bb" });
    history.push({ position: query.villain, action: "threebet", sizeBb: threeBetSize, text: query.villain + " 3-bet " + threeBetSize + "bb" });
    pot += openSize - postedBlind(query.hero) + threeBetSize - postedBlind(query.villain);
  }
  if (query.scenario === "squeeze" && query.villain && query.caller) {
    history.push(firstAction(query.villain));
    history.push({ position: query.villain, action: "raise", sizeBb: openSize, text: query.villain + " raise " + openSize + "bb" });
    history.push({ position: query.caller, action: "call", sizeBb: openSize, text: query.caller + " call " + openSize + "bb" });
    pot += openSize - postedBlind(query.villain) + openSize - postedBlind(query.caller);
  }
  if (query.scenario === "vs-jam" && query.villain) {
    history.push(firstAction(query.villain));
    history.push({ position: query.villain, action: "jam", sizeBb: query.stack, text: query.villain + " all-in " + query.stack + "bb" });
    pot += query.stack - postedBlind(query.villain);
  }
  return { history, pot: Number(pot.toFixed(1)) };
}

function modeledSupportIssue(query: StrategyQuery) {
  if (!MODELED_METADATA.availableStacks.includes(query.stack)) return "Stack não disponível neste dataset.";
  if (!MODELED_METADATA.supportedNodes.includes(query.scenario)) return "Família de node não disponível neste dataset.";
  if (query.gameType !== "MTT" || query.model !== "ChipEV" || query.format !== "8-max" || query.players !== 8) return "Formato não disponível neste dataset.";
  if (!scenarioIsCompatible(query.scenario, query.hero, query.stack)) return "A posição e o stack não formam um node válido.";
  const expectedOpen = defaultOpenSize(query.stack);
  if (query.openSize !== undefined && Math.abs(query.openSize - expectedOpen) > .001) return "Este sizing não existe no modelo educacional.";
  if (query.scenario === "vs-3bet") {
    const expectedThreeBet = defaultThreeBetSize(query.stack, query.villain);
    if (query.threeBetSize !== undefined && Math.abs(query.threeBetSize - expectedThreeBet) > .001) return "Este sizing de 3-bet não existe no modelo educacional.";
  }
  return null;
}

function buildModeledNode(input: StrategyQuery): StrategyNode {
  const query = normalizeQuery(input);
  const strategyByHand = Object.fromEntries(HAND_CLASSES.map((hand) => [hand, modeledStrategy(hand, query)]));
  const actionsAvailable = [...new Set(Object.values(strategyByHand).flatMap((items) => items.map((item) => item.action)))] as ActionKey[];
  const { history, pot } = nodeHistory(query);
  return {
    id: nodeId(query),
    parentNodeId: query.scenario === "rfi" ? null : nodeId({ ...query, scenario: "rfi", hero: query.villain ?? query.hero, villain: undefined, caller: undefined, threeBetSize: undefined }),
    datasetId: query.datasetId,
    actingPosition: query.hero,
    effectiveStack: query.stack,
    pot,
    openSize: query.openSize,
    threeBetSize: query.threeBetSize,
    actionsAvailable,
    actionHistory: history,
    strategyByHand,
    childNodeIds: [],
    query,
    provenance: modeledProvenance,
  };
}

type Provider = {
  metadata: DatasetMetadata;
  lookup(query: StrategyQuery): StrategyLookup;
};

function alternativesFor(query: StrategyQuery, metadata: DatasetMetadata) {
  return metadata.availableStacks
    .map((stack) => ({ ...query, stack, openSize: defaultOpenSize(stack), threeBetSize: query.scenario === "vs-3bet" ? defaultThreeBetSize(stack, query.villain) : undefined }))
    .sort((a, b) => Math.abs(a.stack - query.stack) - Math.abs(b.stack - query.stack))
    .slice(0, 3);
}

function createModeledProvider(): Provider {
  const cache = new Map<string, StrategyNode>();
  return {
    metadata: MODELED_METADATA,
    lookup(input) {
      const query = normalizeQuery(input);
      const issue = modeledSupportIssue(query);
      if (issue) return { status: "unavailable", query, reason: issue, alternatives: alternativesFor(query, MODELED_METADATA) };
      const key = queryKey(query);
      let node = cache.get(key);
      if (!node) {
        node = buildModeledNode(query);
        cache.set(key, node);
      }
      return { status: "available", node };
    },
  };
}

function createStaticProvider(dataset: SerializedStrategyDataset): Provider {
  const nodes = new Map(dataset.nodes.map((node) => [queryKey(node.query), node]));
  return {
    metadata: dataset.metadata,
    lookup(input) {
      const query = normalizeQuery(input);
      const node = nodes.get(queryKey(query));
      if (node) return { status: "available", node };
      return {
        status: "unavailable",
        query,
        reason: "Strategy unavailable for this exact node and sizing.",
        alternatives: dataset.nodes
          .filter((item) => item.query.scenario === query.scenario && item.query.hero === query.hero)
          .sort((a, b) => Math.abs(a.effectiveStack - query.stack) - Math.abs(b.effectiveStack - query.stack))
          .slice(0, 3)
          .map((item) => item.query),
      };
    },
  };
}

export const DEFAULT_RESOLUTION_POLICY: ResolutionPolicy = {
  allowModeledFallback: true,
  allowExperimental: false,
};

const TRUST_PRIORITY: Record<StrategyTrustLevel, number> = {
  verified: 4,
  curated: 3,
  modeled: 2,
  experimental: 1,
};

const WORKFLOW_TRANSITIONS: Record<DatasetWorkflowStatus, DatasetWorkflowStatus[]> = {
  draft: ["review_required", "deprecated"],
  review_required: ["draft", "reviewed", "deprecated"],
  reviewed: ["draft", "published", "deprecated"],
  published: ["deprecated"],
  deprecated: ["draft"],
};

export class StrategyRepository {
  private providers = new Map<string, Provider>();

  constructor() {
    this.installProvider(createModeledProvider());
    this.installProvider(createStaticProvider({ metadata: { ...REFERENCE_METADATA }, nodes: [] }));
    const experimentalReport = validateDataset(SOLVER_EXPERIMENTAL_DATASET);
    if (!experimentalReport.valid) {
      throw new Error("Bundled solver Experimental dataset failed validation.");
    }
    this.installProvider(createStaticProvider(SOLVER_EXPERIMENTAL_DATASET));
  }

  private installProvider(provider: Provider) {
    this.providers.set(provider.metadata.id, provider);
  }

  install(dataset: SerializedStrategyDataset) {
    const report = validateDataset(dataset);
    if (!report.valid) return report;
    const existing = this.providers.get(dataset.metadata.id);
    if (dataset.metadata.trustLevel === "curated" && dataset.metadata.status === "published" && !["reviewed", "published"].includes(existing?.metadata.status ?? "")) {
      return {
        valid: false,
        issues: [{ path: "metadata.status", code: "workflow_bypass", message: "Curated data must pass explicit review before publication.", severity: "error" }],
      };
    }
    this.installProvider(createStaticProvider(dataset));
    return report;
  }

  enable(datasetId: string, enabled: boolean) {
    const provider = this.providers.get(datasetId);
    if (!provider) return false;
    provider.metadata.enabled = enabled;
    return true;
  }

  transition(datasetId: string, next: DatasetWorkflowStatus) {
    const provider = this.providers.get(datasetId);
    if (!provider || !WORKFLOW_TRANSITIONS[provider.metadata.status].includes(next)) return false;
    if (next === "published") {
      const exported = providerExport(provider);
      const report = validateDataset(exported);
      if (!report.valid || !exported.nodes.length) return false;
    }
    provider.metadata.status = next;
    provider.metadata.updatedAt = new Date().toISOString();
    if (next === "reviewed") provider.metadata.reviewedAt = provider.metadata.updatedAt;
    const updated = providerExport(provider);
    updated.nodes = updated.nodes.map((node) => ({
      ...node,
      provenance: {
        ...node.provenance,
        status: next,
        reviewedAt: provider.metadata.reviewedAt,
      },
    }));
    this.installProvider(createStaticProvider(updated));
    return true;
  }

  listDatasets() {
    return [...this.providers.values()].map((provider) => ({ ...provider.metadata, changeLog: [...provider.metadata.changeLog] }));
  }

  metadata(datasetId: string) {
    const metadata = this.providers.get(datasetId)?.metadata;
    return metadata ? { ...metadata, changeLog: [...metadata.changeLog] } : null;
  }

  lookup(query: StrategyQuery): StrategyLookup {
    if (query.datasetId === AUTO_DATASET_ID) return this.resolve(query);
    const provider = this.providers.get(query.datasetId);
    if (!provider || !provider.metadata.enabled) {
      return { status: "unavailable", query, reason: "Dataset ausente ou desativado.", alternatives: [] };
    }
    return provider.lookup(query);
  }

  resolve(input: StrategyQuery, policy: ResolutionPolicy = DEFAULT_RESOLUTION_POLICY): StrategyLookup {
    const query = normalizeQuery({ ...input, datasetId: AUTO_DATASET_ID });
    const candidates = [...this.providers.values()]
      .filter((provider) => provider.metadata.enabled && provider.metadata.status === "published")
      .filter((provider) => policy.allowExperimental || provider.metadata.trustLevel !== "experimental")
      .filter((provider) => policy.allowModeledFallback && !policy.trustedOnly || provider.metadata.trustLevel !== "modeled")
      .sort((left, right) => TRUST_PRIORITY[right.metadata.trustLevel] - TRUST_PRIORITY[left.metadata.trustLevel]);
    const alternatives: StrategyQuery[] = [];
    const reasons: string[] = [];
    for (const provider of candidates) {
      const result = provider.lookup({ ...query, datasetId: provider.metadata.id });
      if (result.status === "available") return result;
      reasons.push(result.reason);
      alternatives.push(...result.alternatives);
    }
    return {
      status: "unavailable",
      query,
      reason: policy.allowModeledFallback && !policy.trustedOnly
        ? reasons[0] ?? "Strategy unavailable for all eligible datasets."
        : "Strategy unavailable for trusted datasets.",
      alternatives: alternatives.slice(0, 3),
    };
  }

  hand(query: StrategyQuery, hand: string, policy: ResolutionPolicy = DEFAULT_RESOLUTION_POLICY) {
    const result = query.datasetId === AUTO_DATASET_ID ? this.resolve(query, policy) : this.lookup(query);
    if (result.status === "unavailable") return result;
    const strategy = result.node.strategyByHand[hand];
    if (!strategy) return { status: "unavailable" as const, query, reason: "Mão ausente neste node.", alternatives: [] };
    return { status: "available" as const, node: result.node, strategy };
  }

  inspect(query: StrategyQuery, policy: ResolutionPolicy = DEFAULT_RESOLUTION_POLICY) {
    const lookup = query.datasetId === AUTO_DATASET_ID ? this.resolve(query, policy) : this.lookup(query);
    if (lookup.status === "unavailable") return { lookup, metadata: null, validation: null };
    const metadata = this.metadata(lookup.node.datasetId);
    const validation = metadata ? validateDataset({ metadata, nodes: [lookup.node] }) : null;
    return { lookup, metadata, validation };
  }

  coverage(policy: ResolutionPolicy = DEFAULT_RESOLUTION_POLICY): CoverageEntry[] {
    const scenarios = Object.keys(SCENARIOS_FOR_COVERAGE) as ScenarioKey[];
    return scenarios.flatMap((scenario) => {
      const heroes = POSITIONS.filter((hero) => scenarioIsCompatible(scenario, hero));
      return heroes.flatMap((hero) => COVERAGE_STACKS.map((stack) => {
        const query = defaultQuery({ datasetId: AUTO_DATASET_ID, scenario, hero, stack, openSize: undefined, threeBetSize: undefined });
        const result = this.resolve(query, policy);
        return result.status === "available" ? {
          query,
          status: "available" as const,
          trustLevel: result.node.provenance.trustLevel,
          datasetId: result.node.datasetId,
          datasetVersion: result.node.provenance.datasetVersion,
          nodeId: result.node.id,
        } : {
          query,
          status: "unavailable" as const,
          trustLevel: "unavailable" as const,
          datasetId: null,
          datasetVersion: null,
          nodeId: null,
          reason: result.reason,
        };
      }));
    });
  }

  coverageMetrics(policy: ResolutionPolicy = DEFAULT_RESOLUTION_POLICY): CoverageMetrics {
    const entries = this.coverage(policy);
    const count = (trustLevel: StrategyTrustLevel) => entries.filter((entry) => entry.trustLevel === trustLevel).length;
    const supportedNodes = entries.filter((entry) => entry.status === "available").length;
    return {
      totalCombinations: entries.length,
      supportedNodes,
      verifiedNodes: count("verified"),
      curatedNodes: count("curated"),
      modeledNodes: count("modeled"),
      experimentalNodes: count("experimental"),
      unavailableCombinations: entries.length - supportedNodes,
    };
  }
}

const SCENARIOS_FOR_COVERAGE: Record<ScenarioKey, true> = {
  rfi: true,
  "vs-open": true,
  "vs-3bet": true,
  "bb-defense": true,
  bvb: true,
  squeeze: true,
  "vs-jam": true,
};

function providerExport(provider: Provider): SerializedStrategyDataset {
  const queries = provider.metadata.availableStacks.flatMap((stack) =>
    provider.metadata.supportedNodes.flatMap((scenario) =>
      POSITIONS.filter((hero) => scenarioIsCompatible(scenario, hero, stack))
        .map((hero) => defaultQuery({ datasetId: provider.metadata.id, stack, scenario, hero, openSize: undefined, threeBetSize: undefined }))));
  const nodes = queries.flatMap((query) => {
    const result = provider.lookup(query);
    return result.status === "available" ? [result.node] : [];
  });
  return { metadata: { ...provider.metadata }, nodes };
}

export const strategyRepository = new StrategyRepository();

export function defaultQuery(overrides: Partial<StrategyQuery> = {}): StrategyQuery {
  return normalizeQuery({
    datasetId: AUTO_DATASET_ID,
    gameType: "MTT",
    model: "ChipEV",
    format: "8-max",
    players: 8,
    stack: 40,
    hero: "BTN",
    scenario: "rfi",
    ...overrides,
  });
}

export function createCuratedDataset(
  input: StrategyQuery,
  strategyByHand: Record<string, StrategyAction[]>,
  options: { version: string; notes: string; status?: DatasetWorkflowStatus; reviewedAt?: string },
): SerializedStrategyDataset {
  const query = normalizeQuery({ ...input, datasetId: REFERENCE_DATASET_ID });
  const metadata: DatasetMetadata = {
    ...REFERENCE_METADATA,
    version: options.version,
    status: options.status ?? "draft",
    updatedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    reviewedAt: options.reviewedAt,
    availableStacks: [query.stack],
    availableOpenSizes: query.openSize === undefined ? [] : [query.openSize],
    available3betSizes: query.threeBetSize === undefined ? [] : [query.threeBetSize],
    supportedNodes: [query.scenario],
    notes: options.notes,
    changeLog: [{ version: options.version, date: new Date().toISOString().slice(0, 10), changes: [options.notes || "Curated node edited."] }],
  };
  const shell = buildModeledNode({ ...query, datasetId: MODELED_DATASET_ID });
  const node: StrategyNode = {
    ...shell,
    id: nodeId(query),
    parentNodeId: null,
    datasetId: REFERENCE_DATASET_ID,
    query,
    actionsAvailable: [...new Set(Object.values(strategyByHand).flatMap((items) => items.map((item) => item.action)))] as ActionKey[],
    strategyByHand,
    provenance: {
      datasetId: REFERENCE_DATASET_ID,
      datasetVersion: options.version,
      sourceType: "reviewed",
      trustLevel: "curated",
      sourceLabel: REFERENCE_METADATA.name,
      isExact: false,
      frequencyPrecision: "rounded",
      evAvailable: false,
      methodology: REFERENCE_METADATA.methodology,
      license: REFERENCE_METADATA.license,
      status: options.status ?? "draft",
      reviewedAt: options.reviewedAt,
      notes: options.notes,
    },
  };
  return { metadata, nodes: [node] };
}

export function dominantAction(items: StrategyAction[]) {
  return [...items].sort((a, b) => b.frequency - a.frequency)[0];
}

export function isMixedStrategy(items: StrategyAction[], minimum = 5) {
  return items.filter((item) => item.frequency >= minimum).length > 1;
}

export function validateDataset(dataset: SerializedStrategyDataset): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (path: string, code: string, message: string, severity: "error" | "warning" = "error") => issues.push({ path, code, message, severity });
  if (!dataset?.metadata?.id) add("metadata.id", "required", "Dataset precisa de id.");
  if (!dataset?.metadata?.version) add("metadata.version", "required", "Dataset precisa de versão.");
  if (dataset?.metadata?.version && !/^\d+\.\d+\.\d+$/.test(dataset.metadata.version)) add("metadata.version", "semver", "Versão precisa usar SemVer (x.y.z).");
  if (!["licensed", "internal-solve", "reviewed", "imported", "modeled", "estimated"].includes(dataset?.metadata?.sourceType)) add("metadata.sourceType", "source_type", "Procedência inválida.");
  if (!["verified", "curated", "modeled", "experimental"].includes(dataset?.metadata?.trustLevel)) add("metadata.trustLevel", "trust_level", "Trust level inválido.");
  if (!["draft", "review_required", "reviewed", "published", "deprecated"].includes(dataset?.metadata?.status)) add("metadata.status", "workflow_status", "Status editorial inválido.");
  if (!dataset?.metadata?.methodology) add("metadata.methodology", "required", "Metodologia é obrigatória.");
  if (!dataset?.metadata?.license) add("metadata.license", "required", "Licença é obrigatória.");
  if (!Array.isArray(dataset?.metadata?.changeLog)) add("metadata.changeLog", "required", "Change log é obrigatório.");
  if (!Array.isArray(dataset?.nodes) || (!dataset.nodes.length && !["draft", "review_required"].includes(dataset?.metadata?.status))) add("nodes", "required", "Dataset revisado/publicado precisa conter nodes.");
  const ids = new Set<string>();
  dataset?.nodes?.forEach((node, nodeIndex) => {
    const path = "nodes[" + nodeIndex + "]";
    if (ids.has(node.id)) add(path + ".id", "duplicate_node", "Node id duplicado.");
    ids.add(node.id);
    if (node.datasetId !== dataset.metadata.id || node.query.datasetId !== dataset.metadata.id) add(path + ".datasetId", "dataset_mismatch", "Node e query precisam pertencer ao dataset.");
    if (node.provenance.datasetId !== dataset.metadata.id || node.provenance.datasetVersion !== dataset.metadata.version) add(path + ".provenance", "provenance_mismatch", "Provenance precisa corresponder ao dataset e versão.");
    if (node.provenance.trustLevel !== dataset.metadata.trustLevel) add(path + ".provenance.trustLevel", "trust_mismatch", "Trust do node diverge do dataset.");
    if (!POSITIONS.includes(node.actingPosition)) add(path + ".actingPosition", "position", "Posição inválida.");
    if (!Number.isFinite(node.effectiveStack) || node.effectiveStack <= 0) add(path + ".effectiveStack", "stack", "Stack inválido.");
    if (!dataset.metadata.availableStacks.includes(node.effectiveStack)) add(path + ".effectiveStack", "unsupported_stack", "Stack não declarado na metadata.");
    if (!Number.isFinite(node.pot) || node.pot < 0) add(path + ".pot", "pot", "Pote inválido.");
    if (!scenarioIsCompatible(node.query.scenario, node.query.hero, node.query.stack)) add(path + ".query", "impossible_query", "Configuração hero/scenario/stack impossível.");
    if (node.query.villain && node.query.villain === node.query.hero) add(path + ".query.villain", "position_collision", "Hero e vilão não podem ocupar a mesma posição.");
    if (node.query.caller && (node.query.caller === node.query.hero || node.query.caller === node.query.villain)) add(path + ".query.caller", "position_collision", "Caller precisa ocupar posição distinta.");
    if (!node.actionHistory.every((event) => POSITIONS.includes(event.position))) add(path + ".actionHistory", "history", "Histórico contém posição inválida.");
    const hands = Object.keys(node.strategyByHand);
    if (hands.length !== 169) add(path + ".strategyByHand", "hand_count", "Node precisa conter as 169 classes de mãos.");
    hands.forEach((hand) => {
      if (!HAND_CLASS_SET.has(hand)) add(path + ".strategyByHand." + hand, "hand", "Classe de mão inválida.");
      const actions = node.strategyByHand[hand];
      if (!Array.isArray(actions) || !actions.length) { add(path + ".strategyByHand." + hand, "actions", "Mão precisa possuir ao menos uma ação."); return; }
      const total = actions.reduce((sum, action) => sum + action.frequency, 0);
      if (new Set(actions.map((action) => action.action)).size !== actions.length) add(path + ".strategyByHand." + hand, "duplicate_action", "Ação duplicada na mesma mão.");
      if (actions.some((action) => !Object.prototype.hasOwnProperty.call(ACTIONS, action.action))) add(path + ".strategyByHand." + hand, "action", "Ação inválida.");
      if (actions.some((action) => !Number.isFinite(action.frequency) || action.frequency < 0 || action.frequency > 100)) add(path + ".strategyByHand." + hand, "frequency", "Frequência fora de 0–100.");
      if (Math.abs(total - 100) > .01) add(path + ".strategyByHand." + hand, "frequency_sum", "Frequências precisam somar 100%.");
      if (actions.some((action) => action.ev !== null && !Number.isFinite(action.ev))) add(path + ".strategyByHand." + hand, "ev", "EV precisa ser número finito ou null.");
    });
  });
  return { valid: !issues.some((issue) => issue.severity === "error"), issues };
}

export function parseDatasetJson(input: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { dataset: null, report: { valid: false, issues: [{ path: "$", code: "json", message: "JSON inválido.", severity: "error" as const }] } };
  }
  const dataset = parsed as SerializedStrategyDataset;
  return { dataset, report: validateDataset(dataset) };
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

export function parseDatasetCsv(input: string, metadata: DatasetMetadata) {
  const lines = input.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines.shift() ?? "");
  const required = ["stack", "hero", "scenario", "hand", "action", "frequency"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) {
    return { dataset: null, report: { valid: false, issues: missing.map((header) => ({ path: "headers", code: "required", message: "Coluna ausente: " + header, severity: "error" as const })) } };
  }
  const groups = new Map<string, { query: StrategyQuery; rows: Array<{ hand: string; action: ActionKey; frequency: number; ev: number | null }> }>();
  lines.forEach((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const query = defaultQuery({
      datasetId: metadata.id,
      stack: Number(row.stack),
      hero: row.hero as Position,
      scenario: row.scenario as ScenarioKey,
      villain: row.villain ? row.villain as Position : undefined,
      caller: row.caller ? row.caller as Position : undefined,
      openSize: row.openSize ? Number(row.openSize) : undefined,
      threeBetSize: row.threeBetSize ? Number(row.threeBetSize) : undefined,
    });
    const key = queryKey(query);
    const group = groups.get(key) ?? { query, rows: [] };
    group.rows.push({ hand: row.hand, action: row.action as ActionKey, frequency: Number(row.frequency), ev: row.ev ? Number(row.ev) : null });
    groups.set(key, group);
  });
  const nodes = [...groups.values()].map((group) => {
    const shell = buildModeledNode({ ...group.query, datasetId: MODELED_DATASET_ID });
    const strategyByHand: Record<string, StrategyAction[]> = {};
    group.rows.forEach((row) => { (strategyByHand[row.hand] ??= []).push({ action: row.action, frequency: row.frequency, ev: row.ev }); });
    return {
      ...shell,
      id: nodeId(group.query),
      datasetId: metadata.id,
      query: group.query,
      strategyByHand,
      provenance: {
        datasetId: metadata.id,
        datasetVersion: metadata.version,
        sourceType: metadata.sourceType,
        trustLevel: metadata.trustLevel,
        sourceLabel: metadata.name,
        isExact: metadata.trustLevel === "verified",
        frequencyPrecision: metadata.trustLevel === "verified" ? "exact" as const : metadata.frequencyPrecision,
        evAvailable: group.rows.some((row) => row.ev !== null),
        methodology: metadata.methodology,
        license: metadata.license,
        status: metadata.status,
        reviewedAt: metadata.reviewedAt,
        notes: metadata.notes,
      },
    };
  });
  const dataset = { metadata, nodes };
  return { dataset, report: validateDataset(dataset) };
}
