"use client";

import { useMemo, useState } from "react";
import { ACTIONS, SCENARIOS, type HandRecord, type InterfaceLevel, type ScenarioKey } from "../core/domain";
import { MATRIX_RANKS } from "../core/hands";
import {
  buildMasteryTree,
  buildReviewQueue,
  createSessionReport,
  detectLeaks,
  updateLearningState,
  type LearningState,
  type MasteryNode,
} from "../core/learning";

type AnalyzeTab = "history" | "review" | "marked" | "leaks" | "misconceptions" | "heatmaps";
type HeatMetric = "accuracy" | "frequency" | "confidence" | "attempts" | "mastery";

function learningStatesFrom(records: HandRecord[]) {
  const states = new Map<string, LearningState>();
  [...records].sort((a, b) => a.timestamp - b.timestamp).forEach((record) => {
    const key = record.nodeId + "::" + record.notation;
    states.set(key, updateLearningState(states.get(key), {
      nodeId: record.nodeId,
      hand: record.notation,
      correct: record.correct,
      confidence: record.confidence,
      frequencyError: record.frequencyError,
      evLoss: record.loss,
      difficulty: "advanced",
      timestamp: record.timestamp,
    }));
  });
  return [...states.values()];
}

function handAt(rowIndex: number, colIndex: number) {
  const row = MATRIX_RANKS[rowIndex];
  const col = MATRIX_RANKS[colIndex];
  return rowIndex === colIndex ? row + col : rowIndex < colIndex ? row + col + "s" : col + row + "o";
}

function metricValue(records: HandRecord[], states: LearningState[], hand: string, metric: HeatMetric) {
  const items = records.filter((record) => record.notation === hand);
  if (!items.length) return null;
  if (metric === "accuracy") return items.filter((item) => item.correct).length / items.length * 100;
  if (metric === "frequency") return Math.max(0, 100 - items.reduce((sum, item) => sum + item.frequencyError, 0) / items.length);
  if (metric === "confidence") return items.reduce((sum, item) => sum + item.confidence, 0) / items.length * 20;
  if (metric === "attempts") return Math.min(100, items.length / 10 * 100);
  const matches = states.filter((state) => state.hand === hand);
  return matches.reduce((sum, item) => sum + item.mastery, 0) / matches.length;
}

function Heatmap({ history, states, metric }: { history: HandRecord[]; states: LearningState[]; metric: HeatMetric }) {
  return <div className="learning-heatmap" role="grid" aria-label={`Heatmap de ${metric}`}>{MATRIX_RANKS.flatMap((_, row) => MATRIX_RANKS.map((__, col) => {
    const hand = handAt(row, col);
    const value = metricValue(history, states, hand, metric);
    const hue = value === null ? "#17201c" : `hsl(${Math.round(value * 1.05)},55%,${22 + value * .12}%)`;
    return <div role="gridcell" key={hand} style={{ background: hue }} title={`${hand}: ${value === null ? "sem amostra" : value.toFixed(0)}`}><span>{hand}</span><small>{value === null ? "—" : Math.round(value)}</small></div>;
  }))}</div>;
}

function HistoryTable({ records, onToggleMark }: { records: HandRecord[]; onToggleMark: (id: string) => void }) {
  return records.length ? <div className="analysis-table"><div className="analysis-head"><span>MÃO</span><span>NODE</span><span>DECISÃO</span><span>FREQ. REF.</span><span>CONFIANÇA</span><span>ESTADO</span><span /></div>{records.slice(0, 150).map((record) => {
    const selected = record.strategy.find((item) => item.action === record.selected);
    return <div className="analysis-row" key={record.id}><span className="hand-chip">{record.notation}</span><span><b>{record.hero} · {SCENARIOS[record.scenario].short}</b><small>{record.stack}bb · {record.villain ?? "first-in"}</small></span><span className={record.correct ? "good" : "bad"}>{ACTIONS[record.selected].label}</span><span>{selected?.frequency ?? 0}%</span><span>{record.confidence}/5</span><span className={record.knowledgeState === "misconception" ? "bad" : ""}>{record.knowledgeState}</span><button aria-label={record.marked ? "Desmarcar mão" : "Marcar mão"} onClick={() => onToggleMark(record.id)}>{record.marked ? "★" : "☆"}</button></div>;
  })}</div> : <div className="honest-empty"><span>SEM DECISÕES</span><h2>Nada corresponde ao filtro</h2><p>Treine algumas mãos para criar evidência real nesta área.</p></div>;
}

export function AnalyzeView({ history, onHistoryChange, onTrainLeak }: { history: HandRecord[]; onHistoryChange: (history: HandRecord[]) => void; onTrainLeak: (scenario: ScenarioKey, hero: string, stack: number) => void }) {
  const [tab, setTab] = useState<AnalyzeTab>("history");
  const [metric, setMetric] = useState<HeatMetric>("accuracy");
  const [scenario, setScenario] = useState<ScenarioKey | "all">("all");
  const [now] = useState(() => Date.now());
  const states = useMemo(() => learningStatesFrom(history), [history]);
  const dueKeys = new Set(buildReviewQueue(states, now, 100).map((state) => state.key));
  const leaks = useMemo(() => detectLeaks(history), [history]);
  const filtered = history.filter((record) => {
    if (scenario !== "all" && record.scenario !== scenario) return false;
    if (tab === "review") return !record.correct || dueKeys.has(record.nodeId + "::" + record.notation);
    if (tab === "marked") return record.marked;
    if (tab === "misconceptions") return record.knowledgeState === "misconception";
    return true;
  });
  const report = createSessionReport(history.slice(0, 50));
  return <section className="page-view analyze-page">
    <div className="page-title"><div><span>APRENDA COM SEUS DADOS</span><h1>Analyze</h1><p>Decisões, revisões, misconceptions, leaks e heatmaps ligados ao contexto completo.</p></div><button className="secondary-button" onClick={() => onHistoryChange([])}>Limpar histórico</button></div>
    <div className="subnav analysis-tabs">{([["history", "Histórico"], ["review", "Revisar"], ["marked", "Marcadas"], ["leaks", "Leaks"], ["misconceptions", "Misconceptions"], ["heatmaps", "Heatmaps"]] as Array<[AnalyzeTab, string]>).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
    {tab !== "leaks" && tab !== "heatmaps" && <div className="analysis-filter"><label>Spot<select value={scenario} onChange={(event) => setScenario(event.target.value as ScenarioKey | "all")}><option value="all">Todos</option>{(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => <option value={key} key={key}>{SCENARIOS[key].label}</option>)}</select></label><span>{filtered.length} decisões</span></div>}
    {tab === "leaks" ? <div className="analytics-leaks">{leaks.length ? leaks.map((leak) => <article key={leak.id}><span>{leak.severity.toUpperCase()}</span><h2>{leak.title}</h2><p>{leak.description}</p><div><b>{leak.accuracy}% accuracy</b><b>{leak.frequencyError}pp freq. error</b><b>{leak.evLoss === null ? "EV indisponível" : `${leak.evLoss.toFixed(2)}bb EV loss`}</b></div><button onClick={() => onTrainLeak(leak.scenario, leak.hero, leak.stackBand.startsWith("8") ? 12 : leak.stackBand.startsWith("17") ? 20 : leak.stackBand.startsWith("30") ? 40 : 80)}>Treinar este leak</button></article>) : <div className="honest-empty"><span>DIAGNÓSTICO HONESTO</span><h2>Amostra insuficiente</h2><p>São necessárias decisões repetidas numa mesma região antes de afirmar que existe um leak.</p></div>}</div>
      : tab === "heatmaps" ? <div className="heatmap-card"><div className="heatmap-head"><div><span>RANGE HEATMAP</span><h2>Onde seu conhecimento concentra e falha</h2></div><select value={metric} onChange={(event) => setMetric(event.target.value as HeatMetric)}><option value="accuracy">Accuracy</option><option value="frequency">Frequency accuracy</option><option value="confidence">Confidence</option><option value="attempts">Attempts</option><option value="mastery">Mastery</option></select></div><Heatmap history={history} states={states} metric={metric} /><p>Células sem amostra permanecem neutras. A cor nunca cria dados ausentes.</p></div>
      : <HistoryTable records={filtered} onToggleMark={(id) => onHistoryChange(history.map((record) => record.id === id ? { ...record, marked: !record.marked } : record))} />}
    <div className="session-report"><div><span>ÚLTIMAS 50 DECISÕES</span><h2>Relatório da sessão</h2></div><section><b>{report.accuracy}%</b><small>Accuracy</small></section><section><b>{report.frequencyMae}pp</b><small>Frequency MAE</small></section><section><b>{report.evLoss === null ? "—" : report.evLoss.toFixed(2)}</b><small>{report.evLoss === null ? "EV indisponível" : "EV loss bb"}</small></section><section><b>{report.misconceptions}</b><small>Misconceptions</small></section><p><strong>Recomendado:</strong> {report.recommendation}</p></div>
  </section>;
}

function MasteryBranch({ node, depth = 0 }: { node: MasteryNode; depth?: number }) {
  const [open, setOpen] = useState(depth === 0);
  return <div className={`mastery-branch depth-${depth}`}><button onClick={() => setOpen((value) => !value)} disabled={!node.children?.length}><span>{node.label}</span><i><em style={{ width: `${node.mastery}%` }} /></i><b>{node.mastery}%</b><small>{node.attempts} tentativas</small></button>{open && node.children?.map((child) => <MasteryBranch key={child.key} node={child} depth={depth + 1} />)}</div>;
}

function historyBuckets(history: HandRecord[]) {
  if (!history.length) return [];
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const min = sorted[0].timestamp;
  const max = sorted.at(-1)?.timestamp ?? min;
  const width = Math.max(1, (max - min + 1) / 8);
  return Array.from({ length: 8 }, (_, index) => {
    const items = sorted.filter((record) => record.timestamp >= min + index * width && record.timestamp < min + (index + 1) * width);
    return { label: index + 1, accuracy: items.length ? items.filter((item) => item.correct).length / items.length * 100 : 0, count: items.length };
  });
}

export function ProgressView({ history, onToday }: { history: HandRecord[]; onToday: () => void }) {
  const [level, setLevel] = useState<InterfaceLevel>("beginner");
  const states = useMemo(() => learningStatesFrom(history), [history]);
  const mastery = useMemo(() => buildMasteryTree(history), [history]);
  const due = buildReviewQueue(states);
  const leaks = detectLeaks(history);
  const buckets = historyBuckets(history);
  const misconceptions = states.filter((state) => state.knowledgeState === "misconception");
  const mastered = states.filter((state) => state.mastery >= 80);
  const frequencyAccuracy = history.length ? Math.max(0, 100 - history.reduce((sum, record) => sum + record.frequencyError, 0) / history.length) : 0;
  return <section className="page-view progress-page">
    <div className="page-title"><div><span>APRENDIZADO REAL</span><h1>Progress</h1><p>Evidência, estabilidade e recência — não uma porcentagem inflada por uma única resposta.</p></div><label className="interface-level">Interface<select value={level} onChange={(event) => { const next = event.target.value as InterfaceLevel; setLevel(next); localStorage.setItem("preflop-lab-interface-level", next); }}><option value="beginner">Beginner</option><option value="advanced">Advanced</option><option value="professional">Professional</option></select></label></div>
    <div className="progress-metrics"><article className="overall-mastery"><span>OVERALL MASTERY</span><b>{mastery.mastery}%</b><i><em style={{ width: `${mastery.mastery}%` }} /></i><p>{history.length ? "Mastery limitada por amostra, recência, precisão e estabilidade." : "Complete decisões para iniciar sua linha de base."}</p></article><article><span>DECISÕES</span><b>{history.length}</b><small>{states.length} combinações node+mão</small></article><article><span>FREQ. ACCURACY</span><b>{frequencyAccuracy.toFixed(0)}%</b><small>baseada no erro médio</small></article><article><span>NODES DOMINADOS</span><b>{mastered.length}</b><small>de {states.length} estudados</small></article><article><span>MISCONCEPTIONS</span><b className={misconceptions.length ? "bad" : ""}>{misconceptions.length}</b><small>erros com confiança alta</small></article></div>
    <div className="progress-layout"><section className="mastery-card"><header><span>MASTERY HIERÁRQUICA</span><h2>O que você ainda não sabe?</h2></header><MasteryBranch node={mastery} /></section>
      <aside className="today-card"><span>TODAY&apos;S TRAINING</span><h2>{Math.min(35, due.length + misconceptions.length + leaks.length * 3 + 10)} decisões</h2><p>~{Math.ceil(Math.min(35, due.length + misconceptions.length + leaks.length * 3 + 10) * .35)} minutos</p><div><b>{due.length}</b><span>reviews vencidas</span></div><div><b>{leaks.length}</b><span>leaks detectados</span></div><div><b>{misconceptions.length}</b><span>misconceptions</span></div><div><b>10</b><span>fronteiras e reforço</span></div><button onClick={onToday}>Começar treino de hoje</button></aside>
    </div>
    <section className="learning-history"><header><span>LEARNING HISTORY</span><h2>Precisão ao longo das suas decisões</h2></header><div>{buckets.map((bucket) => <span key={bucket.label} title={`${bucket.count} decisões · ${bucket.accuracy.toFixed(0)}%`}><i style={{ height: `${Math.max(3, bucket.accuracy)}%` }} /><small>{bucket.count}</small></span>)}</div></section>
  </section>;
}
