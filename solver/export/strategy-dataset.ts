import type {
  ActionKey,
  DatasetMetadata,
  SerializedStrategyDataset,
  StrategyAction,
  StrategyNode,
} from "../../app/core/domain";
import { HAND_CLASSES } from "../../app/core/hands";
import { nodeId } from "../../app/core/strategy-data";
import type { HoldemPocArtifact } from "../game/holdem-poc";
import type { SolverValidationReport } from "../validation/report";

type SolverMetadataExtension = {
  solver: {
    solverName: string;
    solverVersion: string;
    algorithm: string;
    algorithmParameters: Record<string, unknown>;
    gameDefinitionHash: string;
    solveId: string;
    iterations: number;
    runtimeMs: number;
    convergenceMetrics: Record<string, number | null>;
    continuationModel: string;
    abstraction: Record<string, unknown>;
    validationReportId: string;
  };
};

function aggregate(strategies: HoldemPocArtifact["rawStrategy"]["sb"], actions: [ActionKey, ActionKey]) {
  const grouped = new Map<string, { first: number; second: number; count: number }>();
  strategies.forEach((combo) => {
    const current = grouped.get(combo.canonical) ?? { first: 0, second: 0, count: 0 };
    current.first += combo.actions[actions[0]] ?? 0;
    current.second += combo.actions[actions[1]] ?? 0;
    current.count += 1;
    grouped.set(combo.canonical, current);
  });
  return Object.fromEntries(HAND_CLASSES.map((hand) => {
    const value = grouped.get(hand);
    if (!value || value.count === 0) throw new Error(`Missing combo strategies for ${hand}.`);
    const first = Number((value.first / value.count * 100).toFixed(6));
    const second = Number((100 - first).toFixed(6));
    const strategy: StrategyAction[] = [
      { action: actions[0], frequency: first, ev: null },
      { action: actions[1], frequency: second, ev: null },
    ];
    return [hand, strategy];
  }));
}

export function exportHoldemPocDataset(
  artifact: HoldemPocArtifact,
  validation: SolverValidationReport,
  generatedAt = new Date().toISOString(),
): SerializedStrategyDataset {
  if (!validation.valid || validation.solveId !== artifact.solveId) throw new Error("A matching valid structural report is required before export.");
  const datasetId = `solver-experimental-${artifact.solveId}`;
  const query = {
    datasetId,
    gameType: "MTT" as const,
    model: "ChipEV" as const,
    format: "heads-up-preflop-poc",
    players: 2,
    stack: artifact.configuration.stack,
    hero: "SB" as const,
    scenario: "bvb" as const,
    villain: "BB" as const,
    openSize: artifact.configuration.stack,
  };
  const strategyByHand = aggregate(artifact.rawStrategy.sb, ["fold", "jam"]);
  const metadata: DatasetMetadata & SolverMetadataExtension = {
    id: datasetId,
    name: "Preflop Lab Solver — Hold'em POC Experimental",
    version: "0.1.0",
    createdAt: generatedAt,
    updatedAt: generatedAt,
    generatedAt,
    sourceType: "internal-solve",
    trustLevel: "experimental",
    status: "published",
    gameType: "MTT",
    model: "ChipEV",
    format: "heads-up-preflop-poc",
    players: 2,
    anteStructure: `No ante; SB ${artifact.configuration.smallBlind}bb; BB ${artifact.configuration.bigBlind}bb`,
    availableStacks: [artifact.configuration.stack],
    availableOpenSizes: [artifact.configuration.stack],
    available3betSizes: [],
    supportedNodes: ["bvb"],
    methodology: "Chance-sampled CFR structural proof at combo level with explicit card removal and a Level 0 equity approximation continuation provider.",
    frequencyPrecision: "estimated",
    evAvailable: false,
    isExact: false,
    license: "Preflop Lab original solver output; no third-party strategy data.",
    changeLog: [{ version: "0.1.0", date: generatedAt.slice(0, 10), changes: ["First reproducible Hold'em structural POC export."] }],
    notes: "Experimental only. This is not an 8-max solve, not a postflop-coupled solution and not GTO/Verified.",
    enabled: true,
    solver: {
      solverName: artifact.solverName,
      solverVersion: artifact.solverVersion,
      algorithm: artifact.algorithm,
      algorithmParameters: { seed: artifact.configuration.seed, metricInterval: artifact.configuration.metricInterval },
      gameDefinitionHash: artifact.gameDefinitionHash,
      solveId: artifact.solveId,
      iterations: artifact.iterations,
      runtimeMs: artifact.runtimeMs,
      convergenceMetrics: {
        exploitability: artifact.exploitability,
        nashConv: artifact.nashConv,
        strategyDelta: artifact.convergenceHistory.at(-1)?.strategyDelta ?? null,
        averagePositiveRegret: artifact.convergenceHistory.at(-1)?.averagePositiveRegret ?? null,
      },
      continuationModel: artifact.continuationModel.id,
      abstraction: artifact.gameDefinition.actions,
      validationReportId: validation.id,
    },
  };
  const node: StrategyNode = {
    id: nodeId(query),
    parentNodeId: null,
    datasetId,
    actingPosition: "SB",
    effectiveStack: artifact.configuration.stack,
    pot: artifact.configuration.smallBlind + artifact.configuration.bigBlind,
    openSize: artifact.configuration.stack,
    actionsAvailable: ["fold", "jam"],
    actionHistory: [{ position: "SB", text: "SB acts first in the heads-up structural POC" }],
    strategyByHand,
    childNodeIds: [],
    query,
    provenance: {
      datasetId,
      datasetVersion: metadata.version,
      sourceType: "internal-solve",
      trustLevel: "experimental",
      sourceLabel: metadata.name,
      isExact: false,
      frequencyPrecision: "estimated",
      evAvailable: false,
      methodology: metadata.methodology,
      license: metadata.license,
      status: metadata.status,
      notes: metadata.notes,
    },
  };
  return { metadata, nodes: [node] };
}
