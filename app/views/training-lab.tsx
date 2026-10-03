"use client";

import { useState } from "react";
import {
  ACTIONS,
  POSITIONS,
  SCENARIOS,
  STACKS,
  type ActionKey,
  type Difficulty,
  type HandRecord,
  type Position,
  type ScenarioKey,
  type StrategyNode,
} from "../core/domain";
import { MATRIX_RANKS, handFeatures } from "../core/hands";
import { boundaryCandidates, detectLeaks } from "../core/learning";
import { defaultQuery, dominantAction, isMixedStrategy, strategyRepository } from "../core/strategy-data";
import { StrategyLegend } from "../components/strategy-matrix";

export type TrainingMode = "decision" | "frequency" | "range" | "boundary" | "leak" | "mixed" | "custom";

export function TrainingModeNav({ mode, onChange }: { mode: TrainingMode; onChange: (mode: TrainingMode) => void }) {
  const modes: Array<[TrainingMode, string]> = [
    ["decision", "Decisão"],
    ["frequency", "Frequências"],
    ["range", "Construir range"],
    ["boundary", "Fronteiras"],
    ["leak", "Leaks"],
    ["mixed", "Mixed"],
    ["custom", "Sessão custom"],
  ];
  return <div className="training-mode-nav" role="tablist" aria-label="Modos de treino">
    {modes.map(([key, label]) => <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? "active" : ""} onClick={() => onChange(key)}>{label}</button>)}
  </div>;
}

function queryFor(stack = 40, hero: Position = "BTN", scenario: ScenarioKey = "rfi") {
  return defaultQuery({ stack, hero, scenario });
}

function SourceNote({ node }: { node: StrategyNode }) {
  return <div className="training-source"><b>{node.provenance.sourceType === "modeled" ? "MODELO EDUCACIONAL" : "DATASET VERIFICADO"}</b><span>{node.provenance.isExact ? "Frequências do dataset." : "Frequências aproximadas; EV indisponível."}</span></div>;
}

function TrainerHeader({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return <div className="trainer-lab-head"><div><span>{kicker}</span><h1>{title}</h1><p>{copy}</p></div></div>;
}

function FrequencyTrainer({ mixedOnly = false }: { mixedOnly?: boolean }) {
  const [index, setIndex] = useState(0);
  const [estimate, setEstimate] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState(false);
  const lookup = strategyRepository.lookup(queryFor());
  if (lookup.status === "unavailable") return <div className="strategy-unavailable"><h2>Estratégia indisponível</h2><p>{lookup.reason}</p></div>;
  const pool = boundaryCandidates(lookup.node, 169).filter((item) => !mixedOnly || isMixedStrategy(item.strategy));
  const current = pool[index % pool.length];
  const total = current.strategy.reduce((sum, item) => sum + (estimate[item.action] ?? 0), 0);
  const mae = current.strategy.reduce((sum, item) => sum + Math.abs((estimate[item.action] ?? 0) - item.frequency), 0) / current.strategy.length;
  const next = () => { setIndex((value) => value + 1); setEstimate({}); setChecked(false); };
  return <section className="training-lab">
    <TrainerHeader kicker={mixedOnly ? "MIXED STRATEGY TRAINER" : "FREQUENCY TRAINER"} title={mixedOnly ? "Domine as misturas" : "Calibre suas frequências"} copy="Estime a distribuição completa. O objetivo é compreender a região do range, não decorar uma porcentagem isolada." />
    <SourceNote node={lookup.node} />
    <div className="frequency-stage">
      <div className="frequency-question">
        <small>BTN · RFI · 40bb</small><span className="hero-hand">{current.hand}</span><p>{current.reason}</p>
      </div>
      <div className="frequency-form">
        {current.strategy.map((item) => <label key={item.action}><span><i style={{ background: ACTIONS[item.action].color }} />{ACTIONS[item.action].label}<b>{estimate[item.action] ?? 0}%</b></span>
          <input aria-label={`Frequência estimada de ${ACTIONS[item.action].label}`} type="range" min="0" max="100" step="5" value={estimate[item.action] ?? 0} disabled={checked} onChange={(event) => setEstimate((values) => ({ ...values, [item.action]: Number(event.target.value) }))} />
        </label>)}
        <div className={`frequency-total ${total === 100 ? "valid" : ""}`}><span>Total</span><b>{total}%</b></div>
        {!checked ? <button className="primary-lab-button" disabled={total !== 100} onClick={() => setChecked(true)}>Comparar com a referência</button> : <button className="primary-lab-button" onClick={next}>Próxima mão</button>}
      </div>
      {checked && <div className="frequency-result"><span>ERRO MÉDIO ABSOLUTO</span><strong>{mae.toFixed(1)}pp</strong><p>{mae <= 5 ? "Boa calibração. Agora compare as mãos vizinhas para entender a fronteira." : "Revise como esta mão se encaixa na construção do range."}</p>
        {current.strategy.map((item) => <div key={item.action}><span>{ACTIONS[item.action].label}</span><b>Você {estimate[item.action] ?? 0}%</b><em>Referência {item.frequency}%</em></div>)}
      </div>}
    </div>
  </section>;
}

function handAt(rowIndex: number, colIndex: number) {
  const row = MATRIX_RANKS[rowIndex];
  const col = MATRIX_RANKS[colIndex];
  return rowIndex === colIndex ? row + col : rowIndex < colIndex ? row + col + "s" : col + row + "o";
}

function RangeBuilderMatrix({ assignments, tool, onAssign, reference }: { assignments: Record<string, ActionKey>; tool: ActionKey | "erase"; onAssign: (hand: string, action: ActionKey | "erase") => void; reference?: StrategyNode }) {
  return <div className="range-builder-matrix" role="grid" aria-label="Construtor de range">
    {MATRIX_RANKS.flatMap((_, row) => MATRIX_RANKS.map((__, col) => {
      const hand = handAt(row, col);
      const action = assignments[hand];
      const expected = reference?.strategyByHand[hand];
      const error = expected && action ? (expected.find((item) => item.action === action)?.frequency ?? 0) < 50 : false;
      return <button key={hand} role="gridcell" className={error ? "range-error" : ""} style={{ background: action ? ACTIONS[action].color : "#17201c" }} onClick={() => onAssign(hand, tool)} aria-label={`${hand}, ${action ? ACTIONS[action].label : "sem ação"}`}><span>{hand}</span></button>;
    }))}
  </div>;
}

function rangeComposition(node: StrategyNode, action?: ActionKey) {
  const weighted = Object.entries(node.strategyByHand).reduce((sum, [hand, strategy]) => {
    const combos = handFeatures(hand).combos;
    const frequency = action
      ? strategy.find((item) => item.action === action)?.frequency ?? 0
      : strategy.filter((item) => item.action !== "fold").reduce((total, item) => total + item.frequency, 0);
    return sum + combos * frequency / 100;
  }, 0);
  return weighted / 1326 * 100;
}

function RangeTrainer() {
  const lookup = strategyRepository.lookup(queryFor());
  const [tool, setTool] = useState<ActionKey | "erase">("raise");
  const [assignments, setAssignments] = useState<Record<string, ActionKey>>({});
  const [compared, setCompared] = useState(false);
  if (lookup.status === "unavailable") return null;
  const node = lookup.node;
  const allowed = [...node.actionsAvailable, "erase" as const];
  const missing = Object.entries(node.strategyByHand).filter(([hand, strategy]) => dominantAction(strategy).action !== "fold" && (!assignments[hand] || assignments[hand] === "fold"));
  const excess = Object.entries(assignments).filter(([hand, action]) => action !== "fold" && dominantAction(node.strategyByHand[hand]).action === "fold");
  const wrong = Object.entries(assignments).filter(([hand, action]) => {
    const expected = node.strategyByHand[hand];
    return expected && (expected.find((item) => item.action === action)?.frequency ?? 0) < 50;
  });
  const userVpip = Object.entries(assignments).reduce((sum, [hand, action]) => sum + (action === "fold" ? 0 : handFeatures(hand).combos), 0) / 1326 * 100;
  return <section className="training-lab">
    <TrainerHeader kicker="RANGE TRAINER" title="Construa o range completo" copy="Escolha uma ação e pinte a matriz. Depois compare sua construção com a referência." />
    <SourceNote node={node} />
    <div className="range-trainer-layout">
      <div className="range-builder-card">
        <div className="range-tools">{allowed.map((action) => <button key={action} className={tool === action ? "selected" : ""} style={action !== "erase" ? { borderColor: ACTIONS[action].color } : undefined} onClick={() => setTool(action)}>{action === "erase" ? "Apagar" : ACTIONS[action].label}</button>)}</div>
        <RangeBuilderMatrix assignments={assignments} tool={tool} reference={compared ? node : undefined} onAssign={(hand, action) => {
          setAssignments((current) => {
            const next = { ...current };
            if (action === "erase") delete next[hand]; else next[hand] = action;
            return next;
          });
          setCompared(false);
        }} />
        <button className="primary-lab-button" onClick={() => setCompared(true)}>Comparar ranges</button>
      </div>
      <aside className="range-score-card">
        <span>COMPOSIÇÃO</span><div><small>Seu VPIP</small><b>{userVpip.toFixed(1)}%</b></div><div><small>Referência</small><b>~{rangeComposition(node).toFixed(1)}%</b></div>
        {compared ? <><div><small>Mãos ausentes</small><b className="bad">{missing.length}</b></div><div><small>Mãos em excesso</small><b className="warn">{excess.length}</b></div><div><small>Ação dominante errada</small><b>{wrong.length}</b></div>
          <section><small>MAIORES AJUSTES</small>{[...missing.slice(0, 4), ...excess.slice(0, 4)].slice(0, 7).map(([hand, strategy]) => <p key={hand}><strong>{hand}</strong><span>{Array.isArray(strategy) ? `Adicionar ${ACTIONS[dominantAction(strategy).action].label}` : "Remover do range"}</span></p>)}</section>
        </> : <p className="range-tip">Preencha o máximo que conseguir. A comparação destaca regiões ausentes, excessos e escolhas de ação incorretas.</p>}
      </aside>
    </div>
  </section>;
}

function DecisionCard({ node, candidates, title }: { node: StrategyNode; candidates: ReturnType<typeof boundaryCandidates>; title: string }) {
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<ActionKey | null>(null);
  const current = candidates[index % candidates.length];
  const expected = dominantAction(current.strategy);
  return <div className="focused-trainer">
    <div className="focused-question"><span>{title}</span><small>{node.actingPosition} · {SCENARIOS[node.query.scenario].short} · {node.effectiveStack}bb</small><b>{current.hand}</b><p>{current.reason}</p></div>
    <div className="focused-actions">{node.actionsAvailable.map((action) => <button key={action} disabled={Boolean(choice)} className={choice === action ? "chosen" : choice && expected.action === action ? "expected" : ""} style={{ borderColor: ACTIONS[action].color }} onClick={() => setChoice(action)}>{ACTIONS[action].label}</button>)}</div>
    {choice && <div className={`focused-feedback ${choice === expected.action ? "good" : "bad"}`}><strong>{choice === expected.action ? "Boa leitura da fronteira." : `A ação dominante é ${ACTIONS[expected.action].label}.`}</strong><p>Referência: {current.strategy.map((item) => `${ACTIONS[item.action].label} ${item.frequency}%`).join(" · ")}. Compare com mãos vizinhas para aprender onde a ação muda.</p><button onClick={() => { setIndex((value) => value + 1); setChoice(null); }}>Próxima</button></div>}
  </div>;
}

function BoundaryTrainer() {
  const lookup = strategyRepository.lookup(queryFor());
  if (lookup.status === "unavailable") return null;
  const candidates = boundaryCandidates(lookup.node);
  return <section className="training-lab"><TrainerHeader kicker="BOUNDARY TRAINER" title="Descubra onde o range muda" copy="Priorizamos misturas, trocas de ação e diferenças entre mãos vizinhas. AA não desperdiça sua sessão." /><SourceNote node={lookup.node} /><DecisionCard node={lookup.node} candidates={candidates} title="FRONTEIRA ESTRATÉGICA" /></section>;
}

function stackFromBand(band: string) {
  if (band.startsWith("8")) return 12;
  if (band.startsWith("17")) return 20;
  if (band.startsWith("30")) return 40;
  return 80;
}

function LeakTrainer({ history }: { history: HandRecord[] }) {
  const leaks = detectLeaks(history);
  const [active, setActive] = useState<string | null>(null);
  const leak = leaks.find((item) => item.id === active);
  if (leak) {
    const hero = POSITIONS.includes(leak.hero as Position) ? leak.hero as Position : "BTN";
    const lookup = strategyRepository.lookup(queryFor(stackFromBand(leak.stackBand), hero, leak.scenario));
    if (lookup.status === "available") return <section className="training-lab"><button className="back-link" onClick={() => setActive(null)}>← Voltar aos leaks</button><TrainerHeader kicker="LEAK TRAINER" title={leak.title} copy={leak.description} /><SourceNote node={lookup.node} /><DecisionCard node={lookup.node} candidates={boundaryCandidates(lookup.node)} title="SESSÃO DIRECIONADA" /></section>;
  }
  return <section className="training-lab"><TrainerHeader kicker="LEAK TRAINER" title="Treino guiado pelos seus padrões" copy="Agrupamos erros por node, posição, stack e classe de mão para corrigir regiões inteiras." />
    {leaks.length ? <div className="leak-cards">{leaks.map((item) => <article key={item.id} className={`leak-card ${item.severity}`}><span>{item.severity === "major" ? "MAJOR LEAK" : item.severity === "moderate" ? "LEAK MODERADO" : "OBSERVAR"}</span><h2>{item.title}</h2><p>{item.description}</p><div><b>{item.accuracy}%</b><small>accuracy</small><b>{item.frequencyError}pp</b><small>erro freq.</small><b>{item.evLoss === null ? "—" : `${item.evLoss.toFixed(2)}bb`}</b><small>EV loss</small></div><button onClick={() => setActive(item.id)}>Treinar este leak</button></article>)}</div>
      : <div className="honest-empty"><span>SEM AMOSTRA SUFICIENTE</span><h2>Ainda não há um padrão confiável</h2><p>Complete pelo menos três decisões na mesma região. O sistema não inventa um leak a partir de uma única mão.</p></div>}
  </section>;
}

type CustomPreset = { name: string; stack: number; hero: Position; scenario: ScenarioKey; difficulty: Difficulty; count: number; mixedOnly: boolean };

function CustomTrainer() {
  const [preset, setPreset] = useState<CustomPreset>({ name: "Minha sessão", stack: 40, hero: "BTN", scenario: "rfi", difficulty: "advanced", count: 25, mixedOnly: false });
  const [queue, setQueue] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [choice, setChoice] = useState<ActionKey | null>(null);
  const lookup = strategyRepository.lookup(queryFor(preset.stack, preset.hero, preset.scenario));
  if (lookup.status === "unavailable") return <section className="training-lab"><TrainerHeader kicker="CUSTOM SESSION" title="Configuração indisponível" copy={lookup.reason} /></section>;
  const node = lookup.node;
  const start = () => {
    const candidates = boundaryCandidates(node, 169).filter((item) => !preset.mixedOnly || isMixedStrategy(item.strategy)).map((item) => item.hand);
    const generated = Array.from({ length: preset.count }, (_, i) => candidates[i % candidates.length]);
    setQueue(generated); setIndex(0); setCorrect(0); setChoice(null);
    localStorage.setItem("preflop-lab-custom-preset", JSON.stringify(preset));
    void fetch("/api/user-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "custom-session", data: { name: preset.name, filters: preset } }) });
  };
  if (queue.length) {
    if (index >= queue.length) return <section className="training-lab"><TrainerHeader kicker="SESSION COMPLETE" title={`${correct}/${queue.length} decisões dominantes corretas`} copy="A sessão foi gerada com seus filtros e priorizou fronteiras dentro do node." /><div className="session-finish"><b>{Math.round(correct / queue.length * 100)}%</b><p>Precisão de ação dominante</p><button className="primary-lab-button" onClick={() => setQueue([])}>Editar sessão</button></div></section>;
    const hand = queue[index];
    const strategy = node.strategyByHand[hand];
    const expected = dominantAction(strategy);
    return <section className="training-lab"><div className="custom-progress"><span>{preset.name}</span><b>{index + 1}/{queue.length}</b><i><em style={{ width: `${index / queue.length * 100}%` }} /></i></div><div className="focused-trainer"><div className="focused-question"><span>SESSÃO CUSTOM</span><small>{preset.hero} · {SCENARIOS[preset.scenario].short} · {preset.stack}bb</small><b>{hand}</b><p>{preset.difficulty} · {preset.mixedOnly ? "somente estratégias mistas" : "fronteiras e reforço"}</p></div><div className="focused-actions">{node.actionsAvailable.map((action) => <button key={action} disabled={Boolean(choice)} className={choice === action ? "chosen" : choice && expected.action === action ? "expected" : ""} style={{ borderColor: ACTIONS[action].color }} onClick={() => { setChoice(action); if (action === expected.action) setCorrect((value) => value + 1); }}>{ACTIONS[action].label}</button>)}</div>{choice && <div className="focused-feedback"><p>Referência: {strategy.map((item) => `${ACTIONS[item.action].label} ${item.frequency}%`).join(" · ")}</p><button onClick={() => { setIndex((value) => value + 1); setChoice(null); }}>Próxima</button></div>}</div></section>;
  }
  return <section className="training-lab"><TrainerHeader kicker="CUSTOM SESSION BUILDER" title="Monte uma sessão com propósito" copy="Filtre o node, a dificuldade e o tipo de estratégia. O preset fica salvo neste dispositivo." /><div className="custom-builder">
    <label>Nome<input value={preset.name} onChange={(event) => setPreset({ ...preset, name: event.target.value })} /></label>
    <label>Stack<select value={preset.stack} onChange={(event) => setPreset({ ...preset, stack: Number(event.target.value) })}>{STACKS.map((stack) => <option key={stack}>{stack}</option>)}</select></label>
    <label>Hero<select value={preset.hero} onChange={(event) => setPreset({ ...preset, hero: event.target.value as Position })}>{POSITIONS.map((position) => <option key={position}>{position}</option>)}</select></label>
    <label>Situação<select value={preset.scenario} onChange={(event) => setPreset({ ...preset, scenario: event.target.value as ScenarioKey })}>{(Object.keys(SCENARIOS) as ScenarioKey[]).map((scenario) => <option key={scenario} value={scenario}>{SCENARIOS[scenario].label}</option>)}</select></label>
    <label>Dificuldade<select value={preset.difficulty} onChange={(event) => setPreset({ ...preset, difficulty: event.target.value as Difficulty })}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="pro">Pro</option></select></label>
    <label>Decisões<select value={preset.count} onChange={(event) => setPreset({ ...preset, count: Number(event.target.value) })}><option>10</option><option>25</option><option>50</option><option>100</option></select></label>
    <label className="check-field"><input type="checkbox" checked={preset.mixedOnly} onChange={(event) => setPreset({ ...preset, mixedOnly: event.target.checked })} />Somente estratégias mistas</label>
    <div className="custom-summary"><StrategyLegend actions={node.actionsAvailable} /><b>{boundaryCandidates(node, 169).filter((item) => !preset.mixedOnly || isMixedStrategy(item.strategy)).length}</b><span>mãos elegíveis neste node</span></div>
    <button className="primary-lab-button" onClick={start}>Iniciar sessão</button>
  </div></section>;
}

export function TrainingLab({ mode, history }: { mode: Exclude<TrainingMode, "decision">; history: HandRecord[] }) {
  if (mode === "frequency") return <FrequencyTrainer />;
  if (mode === "range") return <RangeTrainer />;
  if (mode === "boundary") return <BoundaryTrainer />;
  if (mode === "leak") return <LeakTrainer history={history} />;
  if (mode === "mixed") return <FrequencyTrainer mixedOnly />;
  return <CustomTrainer />;
}
