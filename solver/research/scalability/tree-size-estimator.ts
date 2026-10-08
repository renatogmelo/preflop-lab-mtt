export type SyntheticGameConfiguration = {
  id: string;
  players: 2;
  privateStates: number;
  publicSignals: number;
  stages: number;
  actionsPerDecision: number;
  seed: number;
  zeroSum: true;
  perfectRecall: true;
  dependencyComplexity: "independent" | "stage-coupled" | "history-coupled";
};

export type TreeSizeEstimate = {
  nodes: number;
  edges: number;
  terminals: number;
  chanceNodes: number;
  decisionNodes: number;
  informationSets: number;
  maximumDepth: number;
  estimatedDefinitionBytes: number;
  estimatedCompiledBytes: number;
  estimatedIndexedBytes: number;
  traversalNodesPerIteration: number;
};

function geometricSum(base: number, terms: number) {
  if (base === 1) return terms;
  return (base ** terms - 1) / (base - 1);
}

export function validateSyntheticConfiguration(configuration: SyntheticGameConfiguration) {
  const integers = [configuration.privateStates, configuration.publicSignals, configuration.stages, configuration.actionsPerDecision, configuration.seed];
  if (!integers.every(Number.isInteger)) throw new Error("Synthetic game parameters must be integers.");
  if (configuration.players !== 2 || !configuration.zeroSum || !configuration.perfectRecall) throw new Error("Phase 6.8 supports only two-player zero-sum perfect-recall games.");
  if (configuration.privateStates < 1 || configuration.publicSignals < 1 || configuration.stages < 1 || configuration.actionsPerDecision < 2) throw new Error("Synthetic game dimensions are outside the supported range.");
}

export function estimateSyntheticGame(configuration: SyntheticGameConfiguration): TreeSizeEstimate {
  validateSyntheticConfiguration(configuration);
  const privateDeals = configuration.privateStates ** 2;
  const publicBranching = configuration.actionsPerDecision * configuration.publicSignals;
  const histories = geometricSum(publicBranching, configuration.stages);
  const decisionNodes = privateDeals * histories;
  const chanceNodesAfterActions = decisionNodes * configuration.actionsPerDecision;
  const terminals = privateDeals * publicBranching ** configuration.stages;
  const chanceNodes = 1 + chanceNodesAfterActions;
  const nodes = decisionNodes + chanceNodes + terminals;
  const edges = nodes - 1;
  const informationSets = configuration.privateStates * histories;
  const indexedTopologyBytes = nodes * (1 + 1 + 4 + 2 + 4 + 8 + 8) + edges * (4 + 8);
  const indexedStrategyBytes = informationSets * configuration.actionsPerDecision * 16;
  return {
    nodes,
    edges,
    terminals,
    chanceNodes,
    decisionNodes,
    informationSets,
    maximumDepth: 1 + configuration.stages * 2,
    estimatedDefinitionBytes: Math.ceil(nodes * 310 + edges * 42),
    estimatedCompiledBytes: Math.ceil(nodes * 176 + edges * 72),
    estimatedIndexedBytes: Math.ceil(indexedTopologyBytes + indexedStrategyBytes),
    traversalNodesPerIteration: nodes * 2,
  };
}
