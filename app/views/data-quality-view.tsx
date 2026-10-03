"use client";

import { useMemo, useState } from "react";
import {
  ACTIONS,
  POSITIONS,
  SCENARIOS,
  type ActionKey,
  type DatasetWorkflowStatus,
  type Position,
  type ScenarioKey,
  type SerializedStrategyDataset,
  type StrategyAction,
  type StrategyQuery,
  type StrategyTrustLevel,
} from "../core/domain";
import { HAND_CLASSES, MATRIX_RANKS } from "../core/hands";
import {
  AUTO_DATASET_ID,
  COVERAGE_STACKS,
  MODELED_DATASET_ID,
  REFERENCE_DATASET_ID,
  createCuratedDataset,
  defaultQuery,
  dominantAction,
  parseDatasetJson,
  strategyRepository,
  validateDataset,
} from "../core/strategy-data";
import { StrategyLegend, StrategyMatrix } from "../components/strategy-matrix";
import { TrustBadge, TrustExplanation } from "../components/trust-badge";

const TRUST_ORDER: Array<StrategyTrustLevel | "unavailable"> = ["verified", "curated", "modeled", "experimental", "unavailable"];
const TRUST_LETTER: Record<StrategyTrustLevel | "unavailable", string> = { verified: "V", curated: "C", modeled: "M", experimental: "E", unavailable: "—" };

function metricsFor(entries: ReturnType<typeof strategyRepository.coverage>) {
  const count = (level: StrategyTrustLevel) => entries.filter((entry) => entry.trustLevel === level).length;
  const supported = entries.filter((entry) => entry.status === "available").length;
  return { total: entries.length, supported, verified: count("verified"), curated: count("curated"), modeled: count("modeled"), experimental: count("experimental"), unavailable: entries.length - supported };
}

function percent(value: number, total: number) {
  return total ? `${Math.round(value / total * 100)}%` : "0%";
}

export function CoveragePanel({ onInspect }: { onInspect: (query: StrategyQuery) => void }) {
  const [trustedOnly, setTrustedOnly] = useState(false);
  const [stack, setStack] = useState<number | "all">("all");
  const [hero, setHero] = useState<Position | "all">("all");
  const [scenario, setScenario] = useState<ScenarioKey | "all">("all");
  const [trust, setTrust] = useState<StrategyTrustLevel | "unavailable" | "all">("all");
  const allEntries = useMemo(() => strategyRepository.coverage({ allowModeledFallback: !trustedOnly, allowExperimental: false, trustedOnly }), [trustedOnly]);
  const entries = allEntries.filter((entry) => (stack === "all" || entry.query.stack === stack) && (hero === "all" || entry.query.hero === hero) && (scenario === "all" || entry.query.scenario === scenario) && (trust === "all" || entry.trustLevel === trust));
  const metrics = metricsFor(entries);
  const scenarios = (Object.keys(SCENARIOS) as ScenarioKey[]).filter((item) => scenario === "all" || item === scenario);
  const stacks = COVERAGE_STACKS.filter((item) => stack === "all" || item === stack);
  return <div className="quality-stack">
    <section className="coverage-summary">
      <div><span>DATASET COVERAGE</span><h2>Onde a estratégia é confiável — e onde ainda é aproximação</h2><p>Cada combinação conta um node de situação, posição e stack. Configurações inválidas ou sem dados ficam indisponíveis.</p></div>
      <label className="trusted-toggle"><input type="checkbox" checked={trustedOnly} onChange={(event) => setTrustedOnly(event.target.checked)} /><span>Professional Mode</span><small>Verified + Curated only</small></label>
    </section>
    <div className="coverage-filters">
      <label>Spot<select value={scenario} onChange={(event) => setScenario(event.target.value as ScenarioKey | "all")}><option value="all">Todos</option>{(Object.keys(SCENARIOS) as ScenarioKey[]).map((item) => <option key={item} value={item}>{SCENARIOS[item].short}</option>)}</select></label>
      <label>Stack<select value={stack} onChange={(event) => setStack(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">Todos</option>{COVERAGE_STACKS.map((item) => <option key={item} value={item}>{item}bb</option>)}</select></label>
      <label>Hero<select value={hero} onChange={(event) => setHero(event.target.value as Position | "all")}><option value="all">Todos</option>{POSITIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Confiança<select value={trust} onChange={(event) => setTrust(event.target.value as typeof trust)}><option value="all">Todas</option>{TRUST_ORDER.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    </div>
    <div className="coverage-metrics">
      {([['supported', 'Suportados'], ['verified', 'Verified'], ['curated', 'Curated'], ['modeled', 'Modeled'], ['experimental', 'Experimental'], ['unavailable', 'Indisponíveis']] as const).map(([key, label]) => <article key={key}><span>{label}</span><b>{metrics[key]}</b><small>{percent(metrics[key], metrics.total)}</small></article>)}
    </div>
    <div className="coverage-legend" aria-label="Legenda de cobertura">{TRUST_ORDER.map((level) => <span key={level}><i className={`coverage-${level}`}>{TRUST_LETTER[level]}</i>{level}</span>)}</div>
    <div className="coverage-table-wrap"><table className="coverage-table"><thead><tr><th>Spot</th>{stacks.map((item) => <th key={item}>{item}bb</th>)}</tr></thead><tbody>{scenarios.map((item) => <tr key={item}><th>{SCENARIOS[item].short}</th>{stacks.map((depth) => {
      const cell = entries.filter((entry) => entry.query.scenario === item && entry.query.stack === depth);
      const best = TRUST_ORDER.find((level) => cell.some((entry) => entry.trustLevel === level)) ?? "unavailable";
      const available = cell.filter((entry) => entry.status === "available");
      return <td key={depth}><button className={`coverage-cell coverage-${best}`} disabled={!cell.length} onClick={() => onInspect((available[0] ?? cell[0]).query)} title={`${available.length}/${cell.length} posições cobertas`}><b>{TRUST_LETTER[best]}</b><small>{available.length}/{cell.length || 0}</small></button></td>;
    })}</tr>)}</tbody></table></div>
    <p className="coverage-footnote">V = Verified · C = Curated · M = Modeled · E = Experimental · — = Unavailable. A letra mantém o significado sem depender de cor.</p>
  </div>;
}

function QueryMiniControls({ query, onChange }: { query: StrategyQuery; onChange: (query: StrategyQuery) => void }) {
  const set = (patch: Partial<StrategyQuery>) => onChange(defaultQuery({ ...query, ...patch, datasetId: AUTO_DATASET_ID, openSize: undefined, threeBetSize: undefined }));
  return <div className="inspector-controls"><label>Stack<select value={query.stack} onChange={(event) => set({ stack: Number(event.target.value) })}>{COVERAGE_STACKS.map((item) => <option key={item}>{item}</option>)}</select></label><label>Hero<select value={query.hero} onChange={(event) => set({ hero: event.target.value as Position })}>{POSITIONS.map((item) => <option key={item}>{item}</option>)}</select></label><label>Spot<select value={query.scenario} onChange={(event) => set({ scenario: event.target.value as ScenarioKey })}>{(Object.keys(SCENARIOS) as ScenarioKey[]).map((item) => <option key={item} value={item}>{SCENARIOS[item].short}</option>)}</select></label></div>;
}

export function DatasetInspector({ initialQuery }: { initialQuery?: StrategyQuery }) {
  const [query, setQuery] = useState(() => initialQuery ?? defaultQuery({ datasetId: AUTO_DATASET_ID, stack: 40, hero: "BTN", scenario: "rfi" }));
  const [trustedOnly, setTrustedOnly] = useState(false);
  const [hand, setHand] = useState("A5s");
  const inspected = strategyRepository.inspect(query, { allowModeledFallback: !trustedOnly, allowExperimental: false, trustedOnly });
  return <div className="quality-stack"><section className="inspector-head"><div><span>DATASET INSPECTOR</span><h2>Audite qualquer node até a mão</h2></div><label><input type="checkbox" checked={trustedOnly} onChange={(event) => setTrustedOnly(event.target.checked)} /> Somente dados confiáveis</label></section><QueryMiniControls query={query} onChange={setQuery} />
    {inspected.lookup.status === "unavailable" ? <div className="honest-empty"><span>STRATEGY UNAVAILABLE</span><h2>Sem node nos datasets permitidos</h2><p>{inspected.lookup.reason}</p></div> : (() => { const node = inspected.lookup.node; const metadata = inspected.metadata!; const strategy = node.strategyByHand[hand]; return <>
      <div className="inspector-grid"><article><span>NODE</span><code>{node.id}</code></article><article><span>DATASET</span><b>{metadata.name}</b><small>v{metadata.version}</small></article><article><span>TRUST</span><TrustBadge level={metadata.trustLevel} /></article><article><span>HANDS</span><b>{Object.keys(node.strategyByHand).length}</b><small>classes válidas</small></article><article><span>VALIDATION</span><b>{inspected.validation?.valid ? "PASS" : "FAIL"}</b><small>{inspected.validation?.issues.length ?? 0} issues</small></article><article><span>EV</span><b>{metadata.evAvailable ? "Disponível" : "Indisponível"}</b></article><article><span>LAST REVIEWED</span><b>{metadata.reviewedAt ? new Date(metadata.reviewedAt).toLocaleDateString("pt-BR") : "Não revisado"}</b></article></div>
      <TrustExplanation level={metadata.trustLevel} /><div className="method-card"><span>METODOLOGIA</span><p>{metadata.methodology}</p><small>Licença: {metadata.license}</small></div>
      <div className="range-layout"><section className="range-card"><div className="range-card-head"><div><small>169 HANDS</small><h2>{query.hero} · {SCENARIOS[query.scenario].short} · {query.stack}bb</h2></div><StrategyLegend actions={node.actionsAvailable} /></div><StrategyMatrix node={node} selectedHand={hand} onSelect={setHand} /></section><aside className="hand-detail"><span className="hand-chip large">{hand}</span><h3>Estratégia auditável</h3>{strategy.map((item) => <div className="inspector-action" key={item.action}><span>{ACTIONS[item.action].label}</span><b>{item.frequency}%</b><small>{item.ev === null ? "EV indisponível" : `${item.ev.toFixed(3)}bb`}</small></div>)}<code>{node.provenance.datasetId}@{node.provenance.datasetVersion}</code></aside></div>
    </>; })()}
  </div>;
}

function handAt(row: number, col: number) {
  const r = MATRIX_RANKS[row]; const c = MATRIX_RANKS[col];
  return row === col ? r + c : row < col ? r + c + "s" : c + r + "o";
}

function downloadDataset(dataset: SerializedStrategyDataset) {
  const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `${dataset.metadata.id}-${dataset.metadata.version}.json`; link.click(); URL.revokeObjectURL(url);
}

export function CuratedRangeEditor() {
  const [restored] = useState(() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("preflop-lab-curated-draft");
    if (!raw) return null;
    const parsed = parseDatasetJson(raw);
    if (!parsed.dataset || !parsed.report.valid || parsed.dataset.metadata.trustLevel !== "curated" || !parsed.dataset.nodes[0]) return null;
    strategyRepository.install(parsed.dataset);
    return parsed.dataset;
  });
  const [query, setQuery] = useState(() => restored?.nodes[0].query ?? defaultQuery({ datasetId: REFERENCE_DATASET_ID, stack: 40, hero: "BTN", scenario: "rfi" }));
  const [strategy, setStrategy] = useState<Record<string, StrategyAction[]> | null>(() => restored?.nodes[0].strategyByHand ?? null);
  const [selected, setSelected] = useState("A5s");
  const [version, setVersion] = useState(() => restored?.metadata.version ?? "0.1.0");
  const [notes, setNotes] = useState(() => restored?.metadata.notes ?? "Initial human review.");
  const [status, setStatus] = useState<DatasetWorkflowStatus>(() => restored?.metadata.status ?? "draft");
  const [message, setMessage] = useState(() => restored ? "Draft local restaurado com provenance e versão preservados." : "Nenhum modeled range foi promovido. Comece explicitamente ou importe dados licenciados.");
  const modeled = strategyRepository.lookup({ ...query, datasetId: MODELED_DATASET_ID });
  const dataset = strategy ? createCuratedDataset(query, strategy, { version, notes, status, reviewedAt: status === "reviewed" || status === "published" ? new Date().toISOString() : undefined }) : null;
  const report = dataset ? validateDataset(dataset) : null;
  const selectedActions = strategy?.[selected] ?? [];
  const selectedTotal = selectedActions.reduce((sum, item) => sum + item.frequency, 0);
  const diffCount = strategy && modeled.status === "available" ? HAND_CLASSES.filter((hand) => JSON.stringify(strategy[hand]) !== JSON.stringify(modeled.node.strategyByHand[hand])).length : 0;
  const explicitlyStart = (source: "modeled" | "nearby") => {
    if (modeled.status !== "available") return;
    setStrategy(structuredClone(modeled.node.strategyByHand)); setStatus("draft");
    setMessage(source === "nearby" ? "Stack próximo copiado para um DRAFT editável; revisão humana continua obrigatória." : "Modelo copiado como ponto de partida explícito. Continua DRAFT e não é Curated publicado.");
  };
  const persist = (nextStatus = status) => {
    if (!strategy) return false;
    const next = createCuratedDataset(query, strategy, { version, notes, status: nextStatus, reviewedAt: nextStatus === "reviewed" || nextStatus === "published" ? new Date().toISOString() : undefined });
    const validation = strategyRepository.install(next);
    if (!validation.valid) { setMessage(`Não salvo: ${validation.issues[0]?.message ?? "dataset inválido"}`); return false; }
    localStorage.setItem("preflop-lab-curated-draft", JSON.stringify(next)); setStatus(nextStatus); setMessage(`Salvo como ${nextStatus}. ${Object.keys(strategy).length} mãos; frequências validadas.`); return true;
  };
  const advance = (next: DatasetWorkflowStatus) => {
    if (!dataset || !report?.valid) { setMessage("Corrija a validação antes de avançar o workflow."); return; }
    if (!persist(status)) return;
    if (!strategyRepository.transition(REFERENCE_DATASET_ID, next)) { setMessage(`Transição ${status} → ${next} não permitida.`); return; }
    persist(next);
  };
  const updateFrequency = (action: ActionKey, frequency: number) => setStrategy((current) => current ? { ...current, [selected]: current[selected].map((item) => item.action === action ? { ...item, frequency } : item) } : current);
  return <div className="quality-stack"><section className="editor-head"><div><span>CURATED RANGE EDITOR · INTERNO</span><h2>Preflop Lab Reference Strategy</h2><p>Curated significa explicitamente revisado. O editor nunca publica nem promove a heurística sozinho.</p></div><div className={`workflow-status status-${status}`}><small>STATUS</small><b>{status}</b></div></section>
    <QueryMiniControls query={query} onChange={(next) => { setQuery({ ...next, datasetId: REFERENCE_DATASET_ID }); setStrategy(null); setStatus("draft"); }} />
    <div className="editor-actions"><button onClick={() => explicitlyStart("modeled")}>Usar modeled como rascunho explícito</button><button onClick={() => explicitlyStart("nearby")}>Copiar stack próximo</button><label>Versão<input value={version} onChange={(event) => setVersion(event.target.value)} /></label><label>Notas<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button onClick={() => dataset && downloadDataset(dataset)} disabled={!dataset}>Exportar JSON</button><label className="file-button">Importar JSON<input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((text) => { const parsed = parseDatasetJson(text); if (!parsed.dataset || !parsed.report.valid || parsed.dataset.metadata.trustLevel !== "curated") { setMessage("Importação rejeitada: dataset inválido ou não-curated."); return; } setStrategy(parsed.dataset.nodes[0].strategyByHand); setVersion(parsed.dataset.metadata.version); setNotes(parsed.dataset.metadata.notes); setStatus("draft"); setMessage("Importado como DRAFT; revisão explícita obrigatória."); }); }} /></label></div>
    {!strategy ? <div className="honest-empty"><span>ZERO CURATED NODES PUBLICADOS</span><h2>Comece sem fingir precisão</h2><p>Importe um range legalmente utilizável ou escolha conscientemente o modelo apenas como rascunho visual. Nada entra no treino até passar por revisão e publicação.</p></div> : <div className="editor-layout"><div className="editor-matrix" role="grid" aria-label="Editor de 169 mãos">{MATRIX_RANKS.flatMap((_, row) => MATRIX_RANKS.map((__, col) => { const hand = handAt(row, col); const primary = dominantAction(strategy[hand]); return <button role="gridcell" key={hand} className={selected === hand ? "selected" : ""} style={{ borderColor: ACTIONS[primary.action].color }} onClick={() => setSelected(hand)}><b>{hand}</b><small>{ACTIONS[primary.action].compact} {primary.frequency}%</small></button>; }))}</div><aside className="editor-hand"><span className="hand-chip large">{selected}</span><small>FREQUÊNCIAS · SOMA {selectedTotal}%</small>{selectedActions.map((item) => <label key={item.action}><span>{ACTIONS[item.action].label}</span><input type="number" min="0" max="100" step="1" value={item.frequency} onChange={(event) => updateFrequency(item.action, Number(event.target.value))} /><b>%</b></label>)}<div className={selectedTotal === 100 ? "validation-pass" : "validation-fail"}>{selectedTotal === 100 ? "PASS · soma 100%" : `FAIL · ajuste ${100 - selectedTotal}pp`}</div><p>{diffCount} mãos diferem do ponto de partida modelado.</p></aside></div>}
    <div className="workflow-bar"><button onClick={() => persist("draft")} disabled={!dataset}>Salvar draft</button><button onClick={() => advance("review_required")} disabled={status !== "draft"}>Solicitar revisão</button><button onClick={() => advance("reviewed")} disabled={status !== "review_required"}>Marcar revisado</button><button onClick={() => advance("published")} disabled={status !== "reviewed"}>Publicar versão</button></div>
    <div className={`editor-message ${report?.valid ? "good" : "warn"}`}><b>{report?.valid ? "VALIDATION PASS" : "EDITOR"}</b><span>{message}</span>{report && !report.valid && <small>{report.issues.slice(0, 3).map((issue) => issue.message).join(" · ")}</small>}</div>
  </div>;
}
