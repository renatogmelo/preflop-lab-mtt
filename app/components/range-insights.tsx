import { ACTIONS, type Position, type StrategyNode } from "../core/domain";
import { handFeatures } from "../core/hands";
import { AUTO_DATASET_ID, COVERAGE_STACKS, defaultQuery, dominantAction, isMixedStrategy, scenarioIsCompatible, strategyRepository } from "../core/strategy-data";

export function RangeStructure({ node }: { node: StrategyNode }) {
  const entries = Object.entries(node.strategyByHand);
  const pure = entries.filter(([, actions]) => dominantAction(actions).frequency >= 95);
  const mixed = entries.filter(([, actions]) => isMixedStrategy(actions));
  const folds = entries.filter(([, actions]) => dominantAction(actions).action === "fold");
  const calls = entries.filter(([, actions]) => dominantAction(actions).action === "call");
  const aggressive = entries.filter(([, actions]) => ["raise", "threebet", "fourbet", "jam"].includes(dominantAction(actions).action));
  const boundary = entries.filter(([, actions]) => dominantAction(actions).frequency < 80 || isMixedStrategy(actions));
  const families = new Map<string, number>();
  entries.filter(([, actions]) => dominantAction(actions).action !== "fold").forEach(([hand]) => families.set(handFeatures(hand).family, (families.get(handFeatures(hand).family) ?? 0) + 1));
  return <section className="range-structure"><header><span>RANGE STRUCTURE</span><h3>Como este range é construído</h3></header><div className="structure-metrics"><div><b>{pure.length}</b><small>ações puras</small></div><div><b>{mixed.length}</b><small>misturas</small></div><div><b>{aggressive.length}</b><small>agressivas</small></div><div><b>{calls.length}</b><small>calls</small></div><div><b>{folds.length}</b><small>folds</small></div><div><b>{boundary.length}</b><small>fronteiras</small></div></div><div className="family-chips">{[...families.entries()].sort((a, b) => b[1] - a[1]).map(([family, count]) => <span key={family}>{family} <b>{count}</b></span>)}</div></section>;
}

function EvolutionRow({ label, node, hand }: { label: string; node: StrategyNode | null; hand: string }) {
  if (!node) return <div className="evolution-row unavailable"><b>{label}</b><span>—</span><small>indisponível</small></div>;
  const primary = dominantAction(node.strategyByHand[hand]);
  return <div className="evolution-row"><b>{label}</b><span style={{ color: ACTIONS[primary.action].color }}>{ACTIONS[primary.action].label}</span><small>{node.provenance.frequencyPrecision === "estimated" ? "~" : ""}{primary.frequency}% · {node.provenance.trustLevel}</small></div>;
}

export function HandEvolution({ node, hand }: { node: StrategyNode; hand: string }) {
  const stackNodes = COVERAGE_STACKS.map((stack) => {
    const result = strategyRepository.lookup(defaultQuery({ ...node.query, datasetId: AUTO_DATASET_ID, stack, openSize: undefined, threeBetSize: undefined }));
    return { stack, node: result.status === "available" ? result.node : null };
  });
  const positions = (["UTG", "HJ", "CO", "BTN", "SB", "BB"] as Position[]).filter((hero) => scenarioIsCompatible(node.query.scenario, hero, node.effectiveStack));
  const positionNodes = positions.map((hero) => {
    const result = strategyRepository.lookup(defaultQuery({ ...node.query, datasetId: AUTO_DATASET_ID, hero, openSize: undefined, threeBetSize: undefined }));
    return { hero, node: result.status === "available" ? result.node : null };
  });
  return <div className="evolution-grid"><section><span>STACK EVOLUTION · {hand}</span>{stackNodes.map((item) => <EvolutionRow key={item.stack} label={`${item.stack}bb`} node={item.node} hand={hand} />)}</section><section><span>POSITION EVOLUTION · {hand}</span>{positionNodes.map((item) => <EvolutionRow key={item.hero} label={item.hero} node={item.node} hand={hand} />)}</section></div>;
}
