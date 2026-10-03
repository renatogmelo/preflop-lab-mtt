import type { SerializedStrategyDataset, StrategyAction } from "./domain";

export type GoldenHand = { hand: string; actions: Array<{ action: string; frequency: number; ev: number | null }> };
export type GoldenNode = { nodeId: string; datasetId: string; datasetVersion: string; hands: GoldenHand[] };

function canonicalActions(actions: StrategyAction[]) {
  return [...actions].sort((a, b) => a.action.localeCompare(b.action)).map((item) => ({ action: item.action, frequency: item.frequency, ev: item.ev }));
}

export function createGoldenNode(dataset: SerializedStrategyDataset, nodeId: string, hands: string[]): GoldenNode {
  const node = dataset.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Golden node not found: ${nodeId}`);
  return {
    nodeId,
    datasetId: dataset.metadata.id,
    datasetVersion: dataset.metadata.version,
    hands: [...hands].sort().map((hand) => {
      const actions = node.strategyByHand[hand];
      if (!actions) throw new Error(`Golden hand not found: ${hand}`);
      return { hand, actions: canonicalActions(actions) };
    }),
  };
}

export function compareGolden(dataset: SerializedStrategyDataset, golden: GoldenNode) {
  const actual = createGoldenNode(dataset, golden.nodeId, golden.hands.map((item) => item.hand));
  return { pass: JSON.stringify(actual) === JSON.stringify(golden), actual, expected: golden };
}

export function verifiedDatasetsRequireGolden(datasets: SerializedStrategyDataset[], goldenDatasetIds: Set<string>) {
  return datasets.filter((dataset) => dataset.metadata.trustLevel === "verified" && !goldenDatasetIds.has(dataset.metadata.id)).map((dataset) => dataset.metadata.id);
}
