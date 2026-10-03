"use client";

import { type CSSProperties, useMemo, useState } from "react";
import {
  ACTIONS,
  POSITIONS,
  SCENARIOS,
  STACKS,
  type ActionKey,
  type Position,
  type ScenarioKey,
  type StrategyAction,
  type StrategyNode,
  type StrategyQuery,
} from "../core/domain";
import { handFeatures, nearbyHands } from "../core/hands";
import {
  AUTO_DATASET_ID,
  defaultQuery,
  dominantAction,
  isMixedStrategy,
  scenarioIsCompatible,
  strategyRepository,
} from "../core/strategy-data";
import { StrategyLegend, StrategyMatrix } from "../components/strategy-matrix";
import { TrustBadge } from "../components/trust-badge";
import { HandEvolution, RangeStructure } from "../components/range-insights";
import { CoveragePanel, CuratedRangeEditor, DatasetInspector } from "./data-quality-view";

export type ExploreMode = "range" | "tree" | "compare" | "diff" | "coverage" | "inspector" | "editor";
export type ExploreSearchRequest = { id: number; text: string; mode?: ExploreMode; hand?: string };

function StrategySource({ node }: { node: StrategyNode }) {
  return <div className={`source-banner source-${node.provenance.trustLevel}`}>
    <div><TrustBadge level={node.provenance.trustLevel} /><strong>{node.provenance.sourceLabel} · v{node.provenance.datasetVersion}</strong></div>
    <p>{node.provenance.trustLevel === "verified" ? "Dataset validado; consulte a metodologia e licença no Inspector." : node.provenance.trustLevel === "curated" ? "Referência revisada para estudo; não é apresentada como equilibrium solve." : "Aproximação educacional para estudo estrutural. Não é um solve verificado; EV indisponível."}</p>
  </div>;
}

function conceptsFor(hand: string, actions: StrategyAction[]) {
  const feature = handFeatures(hand);
  const concepts = [feature.family];
  if (feature.ace || feature.king) concepts.push("Blocker de carta alta");
  if (feature.suited) concepts.push("Possibilidade de flush");
  if (feature.connector || feature.gapper) concepts.push("Possibilidade de sequência");
  if (isMixedStrategy(actions)) concepts.push("Estratégia mista");
  if (dominantAction(actions).frequency < 80) concepts.push("Região de fronteira");
  return concepts;
}

function HandDetail({ node, hand }: { node: StrategyNode; hand: string }) {
  const actions = node.strategyByHand[hand] ?? [];
  const features = handFeatures(hand);
  const nearby = nearbyHands(hand);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<"idle" | "note" | "bookmark">("idle");
  const persist = (operation: "note" | "bookmark") => {
    const data = operation === "note"
      ? { body: note, nodeId: node.id, hand }
      : { kind: "hand", targetId: node.id + "::" + hand, metadata: { nodeId: node.id, hand } };
    void fetch("/api/user-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, data }) }).then((response) => {
      if (response.ok) setSaved(operation);
    });
  };
  return <aside className="hand-detail">
    <div className="hand-detail-title"><span className="hand-chip large">{hand}</span><div><small>CLASSIFICAÇÃO</small><strong>{features.family}</strong><p>{isMixedStrategy(actions) ? "Estratégia mista" : "Estratégia predominantemente pura"} · {dominantAction(actions).frequency < 80 ? "fronteira" : "região central"}</p></div></div>
    <div className="detail-actions">{actions.map((item) => <div key={item.action}>
      <div><span><i style={{ background: ACTIONS[item.action].color }} />{ACTIONS[item.action].label}</span><b>{node.provenance.frequencyPrecision === "estimated" ? "~" : ""}{item.frequency}%</b></div>
      <span><i style={{ width: `${item.frequency}%`, background: ACTIONS[item.action].color }} /></span>
      <small>EV: {item.ev === null ? "indisponível" : `${item.ev >= 0 ? "+" : ""}${item.ev.toFixed(3)}bb`}</small>
    </div>)}</div>
    <div className="concept-list"><small>CONCEITOS DESTA MÃO</small><div>{conceptsFor(hand, actions).map((concept) => <span key={concept}>{concept}</span>)}</div></div>
    <div className="nearby-list"><small>COMPARE MÃOS PRÓXIMAS</small>{nearby.map((neighbor) => {
      const strategy = node.strategyByHand[neighbor];
      if (!strategy) return null;
      const primary = dominantAction(strategy);
      return <div key={neighbor}><b>{neighbor}</b><span>{ACTIONS[primary.action].label}</span><em>{primary.frequency}%</em></div>;
    })}</div>
    <HandEvolution node={node} hand={hand} />
    <div className="study-tools"><small>ESTUDO PESSOAL</small><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: revisar esta fronteira em 20bb." aria-label="Nota de estudo" /><div><button disabled={!note.trim()} onClick={() => persist("note")}>{saved === "note" ? "✓ Nota salva" : "Salvar nota"}</button><button onClick={() => persist("bookmark")}>{saved === "bookmark" ? "★ Salvo" : "☆ Bookmark"}</button></div></div>
  </aside>;
}

function QueryControls({
  query,
  onChange,
}: {
  query: StrategyQuery;
  onChange: (query: StrategyQuery) => void;
}) {
  const set = (patch: Partial<StrategyQuery>) => onChange(defaultQuery({ ...query, ...patch, openSize: undefined, threeBetSize: undefined }));
  return <div className="explore-controls">
    <label>Stack<select value={query.stack} onChange={(event) => set({ stack: Number(event.target.value) })}>{STACKS.map((stack) => <option key={stack} value={stack}>{stack}bb</option>)}</select></label>
    <label>Hero<select value={query.hero} onChange={(event) => {
      const hero = event.target.value as Position;
      const scenario = scenarioIsCompatible(query.scenario, hero, query.stack) ? query.scenario : "rfi";
      set({ hero, scenario });
    }}>{POSITIONS.map((position) => <option key={position}>{position}</option>)}</select></label>
    <label>Situação<select value={query.scenario} onChange={(event) => set({ scenario: event.target.value as ScenarioKey })}>
      {(Object.keys(SCENARIOS) as ScenarioKey[]).map((scenario) => <option key={scenario} value={scenario} disabled={!scenarioIsCompatible(scenario, query.hero, query.stack)}>{SCENARIOS[scenario].label}</option>)}
    </select></label>
    {query.scenario !== "rfi" && query.scenario !== "bvb" && <label>Vilão<select value={query.villain ?? ""} onChange={(event) => set({ villain: event.target.value as Position })}>{POSITIONS.filter((position) => position !== query.hero).map((position) => <option key={position}>{position}</option>)}</select></label>}
    <label>Open size<select value={query.openSize ?? ""} onChange={(event) => onChange({ ...query, openSize: Number(event.target.value) })}>
      {[2, 2.1, 2.2, 2.3, 2.5].map((size) => <option key={size} value={size}>{size}bb{size === (query.stack <= 25 ? 2 : query.stack <= 40 ? 2.1 : 2.2) ? " · disponível" : ""}</option>)}
    </select></label>
  </div>;
}

function RangeExplorer({ query, setQuery, initialHand = "A5s" }: { query: StrategyQuery; setQuery: (query: StrategyQuery) => void; initialHand?: string }) {
  const [hand, setHand] = useState(initialHand);
  const lookup = useMemo(() => strategyRepository.lookup(query), [query]);
  return <div className="explorer-body">
    <QueryControls query={query} onChange={setQuery} />
    {lookup.status === "unavailable" ? <Unavailable result={lookup} onChoose={setQuery} /> : <>
      <StrategySource node={lookup.node} />
      <RangeStructure node={lookup.node} />
      <div className="range-layout">
        <section className="range-card">
          <div className="range-card-head"><div><small>RANGE EXPLORER</small><h2>{query.hero} · {SCENARIOS[query.scenario].label} · {query.stack}bb</h2></div><StrategyLegend actions={lookup.node.actionsAvailable} /></div>
          <StrategyMatrix node={lookup.node} selectedHand={hand} onSelect={setHand} />
        </section>
        <HandDetail key={hand} node={lookup.node} hand={hand} />
      </div>
    </>}
  </div>;
}

function Unavailable({ result, onChoose }: { result: Extract<ReturnType<typeof strategyRepository.lookup>, { status: "unavailable" }>; onChoose: (query: StrategyQuery) => void }) {
  return <div className="strategy-unavailable"><span>!</span><h2>Estratégia indisponível</h2><p>{result.reason}</p><code>{result.query.hero} · {result.query.stack}bb · {SCENARIOS[result.query.scenario].label} · open {result.query.openSize}bb</code>
    {result.alternatives.length > 0 && <div><small>CONFIGURAÇÕES DISPONÍVEIS</small>{result.alternatives.map((query) => <button key={query.stack + "-" + query.openSize} onClick={() => onChoose(query)}>{query.stack}bb · {query.openSize}x</button>)}</div>}
  </div>;
}

function nextTreeQuery(query: StrategyQuery, action: ActionKey): StrategyQuery | null {
  const actorIndex = POSITIONS.indexOf(query.hero);
  const next = POSITIONS[actorIndex + 1];
  if (query.scenario === "rfi") {
    if (action === "fold") return next ? defaultQuery({ ...query, hero: next, scenario: "rfi", villain: undefined, caller: undefined }) : null;
    if ((action === "raise" || action === "jam") && next) return defaultQuery({ ...query, hero: next, scenario: action === "jam" ? "vs-jam" : next === "BB" ? "bb-defense" : "vs-open", villain: query.hero });
    if (action === "limp" && next) return defaultQuery({ ...query, hero: next, scenario: next === "BB" ? "bb-defense" : "vs-open", villain: query.hero });
  }
  if (query.scenario === "vs-open" || query.scenario === "bb-defense") {
    const opener = query.villain;
    if (action === "fold" && next) return defaultQuery({ ...query, hero: next, scenario: next === "BB" ? "bb-defense" : "vs-open", villain: opener });
    if (action === "call" && next && opener) return defaultQuery({ ...query, hero: next, scenario: "squeeze", villain: opener, caller: query.hero });
    if ((action === "threebet" || action === "jam") && opener) return defaultQuery({ ...query, hero: opener, scenario: action === "jam" ? "vs-jam" : "vs-3bet", villain: query.hero, caller: undefined });
  }
  if (query.scenario === "squeeze" && query.villain && (action === "threebet" || action === "jam")) {
    return defaultQuery({ ...query, hero: query.villain, scenario: action === "jam" ? "vs-jam" : "vs-3bet", villain: query.hero, caller: undefined });
  }
  return null;
}

function TreeExplorer({ baseQuery }: { baseQuery: StrategyQuery }) {
  const root = defaultQuery({ ...baseQuery, scenario: "rfi", villain: undefined, caller: undefined });
  const [trail, setTrail] = useState<Array<{ label: string; query: StrategyQuery }>>([{ label: `${root.hero} RFI`, query: root }]);
  const current = trail[trail.length - 1];
  const lookup = strategyRepository.lookup(current.query);
  const choose = (action: ActionKey) => {
    const next = nextTreeQuery(current.query, action);
    if (!next) return;
    setTrail((items) => [...items, { label: `${ACTIONS[action].label} → ${next.hero} ${SCENARIOS[next.scenario].short}`, query: next }]);
  };
  return <div className="tree-explorer">
    <div className="node-breadcrumb">{trail.map((item, index) => <button key={index} onClick={() => setTrail((items) => items.slice(0, index + 1))}>{index ? "› " : ""}{item.label}</button>)}</div>
    {lookup.status === "unavailable" ? <Unavailable result={lookup} onChoose={(query) => setTrail([{ label: `${query.hero} ${SCENARIOS[query.scenario].short}`, query }])} /> : <div className="tree-node">
      <StrategySource node={lookup.node} />
      <div className="tree-node-head"><div><small>NODE ATUAL</small><h2>{lookup.node.actingPosition} decide</h2><p>Pote {lookup.node.pot}bb · Stack {lookup.node.effectiveStack}bb</p></div><button onClick={() => setTrail([{ label: `${root.hero} RFI`, query: root }])}>Reiniciar árvore</button></div>
      <div className="node-history">{lookup.node.actionHistory.map((event, index) => <span key={index}>{event.text}</span>)}</div>
      <div className="tree-actions">{lookup.node.actionsAvailable.map((action) => <button key={action} style={{ "--action": ACTIONS[action].color } as CSSProperties} onClick={() => choose(action)}><b>{ACTIONS[action].label}</b><small>{nextTreeQuery(current.query, action) ? "Abrir próximo node" : "Encerrar linha"}</small></button>)}</div>
      <StrategyMatrix node={lookup.node} compact />
    </div>}
  </div>;
}

function CompareExplorer({ query }: { query: StrategyQuery }) {
  const comparisons = [20, 40, 100].map((stack) => ({ stack, lookup: strategyRepository.lookup(defaultQuery({ ...query, stack, openSize: undefined, threeBetSize: undefined })) }));
  return <div className="compare-grid">{comparisons.map(({ stack, lookup }) => <section className="compare-card" key={stack}>
    <div><small>{query.hero} · {SCENARIOS[query.scenario].short}</small><h2>{stack}bb</h2></div>
    {lookup.status === "available" ? <StrategyMatrix node={lookup.node} compact /> : <p className="mini-unavailable">Indisponível para este node.</p>}
  </section>)}</div>;
}

function actionFrequency(actions: StrategyAction[], action: ActionKey) {
  return actions.find((item) => item.action === action)?.frequency ?? 0;
}

function DiffExplorer({ query }: { query: StrategyQuery }) {
  const [fromStack, setFromStack] = useState(20);
  const [toStack, setToStack] = useState(40);
  const [threshold, setThreshold] = useState(5);
  const [hand, setHand] = useState("A5s");
  const from = strategyRepository.lookup(defaultQuery({ ...query, stack: fromStack, openSize: undefined, threeBetSize: undefined }));
  const to = strategyRepository.lookup(defaultQuery({ ...query, stack: toStack, openSize: undefined, threeBetSize: undefined }));
  if (from.status === "unavailable") return <Unavailable result={from} onChoose={() => undefined} />;
  if (to.status === "unavailable") return <Unavailable result={to} onChoose={() => undefined} />;
  const difference = (target: string) => {
    const left = from.node.strategyByHand[target];
    const right = to.node.strategyByHand[target];
    const actions = [...new Set([...left, ...right].map((item) => item.action))];
    return actions.reduce((sum, action) => sum + Math.abs(actionFrequency(left, action) - actionFrequency(right, action)), 0) / 2;
  };
  const changed = Object.keys(from.node.strategyByHand).filter((target) => difference(target) >= threshold);
  return <div className="diff-view">
    <div className="diff-controls">
      <label>De<select value={fromStack} onChange={(event) => setFromStack(Number(event.target.value))}>{STACKS.map((stack) => <option key={stack}>{stack}</option>)}</select></label>
      <label>Para<select value={toStack} onChange={(event) => setToStack(Number(event.target.value))}>{STACKS.map((stack) => <option key={stack}>{stack}</option>)}</select></label>
      <label>Mudança mínima<select value={threshold} onChange={(event) => setThreshold(Number(event.target.value))}><option value={0}>Qualquer mudança</option><option value={5}>5 pontos percentuais</option><option value={10}>10 pontos percentuais</option></select></label>
      <strong>{changed.length} mãos alteradas</strong>
    </div>
    <div className="range-layout">
      <section className="range-card"><div className="range-card-head"><div><small>DIFF MODE</small><h2>{fromStack}bb → {toStack}bb</h2></div><div className="diff-legend"><span className="diff-same">Sem mudança relevante</span><span className="diff-changed">Mudou</span></div></div>
        <StrategyMatrix node={to.node} selectedHand={hand} onSelect={setHand} cellClass={(target) => difference(target) >= threshold ? "diff-hit" : "diff-muted"} />
      </section>
      <aside className="hand-detail"><div className="hand-detail-title"><span className="hand-chip large">{hand}</span><div><small>MUDANÇA TOTAL</small><strong>{difference(hand)}pp</strong><p>{dominantAction(from.node.strategyByHand[hand]).action === dominantAction(to.node.strategyByHand[hand]).action ? "Mesma ação dominante" : "A ação dominante mudou"}</p></div></div>
        {[fromStack, toStack].map((stack, index) => {
          const node = index ? to.node : from.node;
          return <div className="diff-hand-row" key={stack}><b>{stack}bb</b>{node.strategyByHand[hand].map((item) => <span key={item.action}><i style={{ background: ACTIONS[item.action].color }} />{ACTIONS[item.action].label} {item.frequency}%</span>)}</div>;
        })}
      </aside>
    </div>
  </div>;
}

function queryFromSearch(search?: string) {
  if (!search) return defaultQuery({ datasetId: AUTO_DATASET_ID, stack: 40, hero: "BTN", scenario: "rfi" });
  const text = search.toUpperCase().replaceAll("-", "");
  const stack = Number(text.match(/(8|10|12|14|15|17|20|25|30|35|40|50|60|80|100)\s*BB/)?.[1] ?? 40);
  const hero = [...POSITIONS].sort((left, right) => right.length - left.length).find((position) => text.includes(position.replace("-", ""))) ?? "BTN";
  let scenario: ScenarioKey = text.includes("SQUEEZE") ? "squeeze"
    : text.includes("3BET") ? "vs-3bet"
    : text.includes("JAM") || text.includes("ALL IN") ? "vs-jam"
    : text.includes("BB DEF") ? "bb-defense"
    : text.includes("VS") ? "vs-open"
    : "rfi";
  if (!scenarioIsCompatible(scenario, hero, stack)) scenario = hero === "BB" ? "bb-defense" : "rfi";
  return defaultQuery({ datasetId: AUTO_DATASET_ID, stack, hero, scenario });
}

function queryKeyForRender(query: StrategyQuery) { return [query.stack, query.hero, query.scenario, query.villain ?? "-"].join("|"); }

export function ExploreView({ searchRequest }: { searchRequest?: ExploreSearchRequest }) {
  const [mode, setMode] = useState<ExploreMode>(searchRequest?.mode ?? "range");
  const [query, setQuery] = useState<StrategyQuery>(() => queryFromSearch(searchRequest?.text));
  return <section className="page-view explore-page">
    <div className="page-title"><div><span>ENTENDA RANGES</span><h1>Explore</h1><p>Veja a construção do range, percorra a árvore e compare mudanças sem decorar charts.</p></div></div>
    <div className="subnav" role="tablist" aria-label="Ferramentas de exploração">
      {([["range", "Range Explorer"], ["tree", "Tree Explorer"], ["compare", "Compare"], ["diff", "Diff"], ["coverage", "Coverage"], ["inspector", "Inspector"], ["editor", "Curated Editor"]] as Array<[ExploreMode, string]>).map(([key, label]) => <button role="tab" aria-selected={mode === key} className={mode === key ? "active" : ""} key={key} onClick={() => setMode(key)}>{label}</button>)}
    </div>
    {mode === "range" && <RangeExplorer query={query} setQuery={setQuery} initialHand={searchRequest?.hand} />}
    {mode === "tree" && <><QueryControls query={query} onChange={setQuery} /><TreeExplorer baseQuery={query} /></>}
    {mode === "compare" && <><QueryControls query={query} onChange={setQuery} /><CompareExplorer query={query} /></>}
    {mode === "diff" && <><QueryControls query={query} onChange={setQuery} /><DiffExplorer query={query} /></>}
    {mode === "coverage" && <CoveragePanel onInspect={(next) => { setQuery(next); setMode("inspector"); }} />}
    {mode === "inspector" && <DatasetInspector key={queryKeyForRender(query)} initialQuery={query} />}
    {mode === "editor" && <CuratedRangeEditor />}
  </section>;
}

