"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import {
  ACTIONS, grade, INITIAL_SPOT, makeSpot, POSITIONS, RANKS, round, SCENARIOS, STACKS, strategy,
  type ActionKey, type Card, type HandRecord, type Position, type ScenarioKey, type Spot,
} from "./engine";

type ViewKey = "trainer" | "review" | "stats";
type StackFilter = number | "Todos";

function stackFor(filter: StackFilter) {
  return filter === "Todos" ? STACKS[Math.floor(Math.random() * STACKS.length)] : filter;
}

function CardView({ card }: { card: Card }) {
  const red = card.suit === "♥" || card.suit === "♦";
  return <span className={`playing-card ${red ? "red" : "black"}`} aria-label={`${card.rank} de ${card.suit}`}>
    <span>{card.rank}</span><span className="suit">{card.suit}</span>
  </span>;
}

function StatRing({ value }: { value: number }) {
  return <div className="stat-ring" style={{ background: `conic-gradient(#b9f45b ${value * 3.6}deg, #25322d 0deg)` }}>
    <div><strong>{value}</strong><span>score</span></div>
  </div>;
}

function Matrix({ spot }: { spot: Spot }) {
  const ranks = [...RANKS].reverse();
  return <div className="matrix" aria-label="Matriz das 169 mãos iniciais">
    {ranks.flatMap((row, i) => ranks.map((col, j) => {
      const hand = i === j ? `${row}${col}` : i < j ? `${row}${col}s` : `${col}${row}o`;
      const primary = [...strategy(hand, spot.scenario, spot.hero, spot.stack)].sort((a, b) => b.frequency - a.frequency)[0];
      return <div
        key={`${i}-${j}`}
        className={`matrix-cell ${hand === spot.notation ? "current" : ""}`}
        title={`${hand}: ${ACTIONS[primary.action].label} ${primary.frequency}%`}
        style={{ background: `${ACTIONS[primary.action].color}${primary.frequency > 70 ? "e8" : "9e"}` }}
      >{hand}</div>;
    }))}
  </div>;
}

function quickInsight(spot: Spot, action: ActionKey) {
  const pair = spot.notation.length === 2;
  const suited = spot.notation.endsWith("s");
  const hasAce = spot.notation.includes("A");
  const broadway = ["A", "K", "Q", "J", "T"].includes(spot.notation[0]) && ["A", "K", "Q", "J", "T"].includes(spot.notation[1]);
  const texture = pair ? "O par retém equidade contra mãos não pareadas" : suited ? "O combo suited realiza melhor a equidade" : hasAce ? "O Ás funciona como blocker de mãos fortes" : broadway ? "As duas cartas altas reduzem problemas de dominância" : "O combo offsuit realiza pouca equidade";
  const opener = spot.villain ?? "o range adversário";

  if (spot.scenario === "vs-jam") {
    const required = Math.round(spot.stack / (spot.pot + spot.stack) * 100);
    return action === "fold"
      ? `Contra o shove de ${spot.stack}bb de ${opener}, o call exige cerca de ${required}% de equidade. ${texture}, mas esta mão não alcança esse limiar contra o range de jam.`
      : `O preço exige cerca de ${required}% de equidade contra o shove de ${spot.stack}bb. ${texture} e a mão conserva equidade suficiente para o call.`;
  }
  if (spot.scenario === "rfi") return action === "fold"
    ? `${texture}, mas em ${spot.hero} ela fica abaixo do limite de abertura e sofre quando recebe ação. Fold protege a parte fraca do range.`
    : `${texture}; em ${spot.hero}, posição e fold equity tornam a abertura lucrativa. A agressão também nega equidade aos blinds.`;
  if (spot.scenario === "bb-defense") return action === "fold"
    ? `Mesmo com o desconto do BB, ${texture.toLowerCase()} e não compensa a desvantagem posicional contra ${opener}.`
    : `${texture}. O preço do BB permite continuar mais mãos, enquanto a linha escolhida equilibra realização de equidade e pressão sobre ${opener}.`;
  if (spot.scenario === "vs-3bet") return action === "fold"
    ? `A 3-bet comprime a realização de equidade: ${texture.toLowerCase()}, mas não o bastante para pagar o preço e jogar um pote inflado.`
    : `${texture}. Contra a 3-bet, esta mão mantém força suficiente para continuar sem deixar o range de abertura excessivamente vulnerável.`;
  if (spot.scenario === "squeeze") return action === "fold"
    ? `Há dois ranges envolvidos e pior realização de equidade; ${texture.toLowerCase()}, mas não sustenta um pote multiway inflado.`
    : `${texture}. O dinheiro morto aumenta o incentivo para continuar, e a linha agressiva captura fold equity contra dois ranges limitados.`;
  if (spot.scenario === "bvb") return action === "fold"
    ? `${texture}, mas ainda fica abaixo da defesa necessária nesta profundidade. Evitar o pior bloco offsuit reduz erros pós-flop.`
    : `${texture}. Blind vs blind contém ranges largos, então esta mão ganha valor relativo e pode disputar os blinds com frequência maior.`;
  return action === "fold"
    ? `Contra a abertura de ${opener}, ${texture.toLowerCase()}, mas não supera dominância, posição e preço para continuar.`
    : `${texture}. Contra ${opener}, blockers e força relativa sustentam esta continuação sem abrir um excesso de folds exploráveis.`;
}

export default function Home() {
  const [view, setView] = useState<ViewKey>("trainer");
  const [stack, setStack] = useState<StackFilter>("Todos");
  const [heroFilter, setHeroFilter] = useState<Position | "Todos">("Todos");
  const [scenarioFilter, setScenarioFilter] = useState<ScenarioKey | "Todos">("Todos");
  const [target, setTarget] = useState(20);
  const [history, setHistory] = useState<HandRecord[]>([]);
  const [selected, setSelected] = useState<ActionKey | null>(null);
  const [showMatrix, setShowMatrix] = useState(false);
  const [spot, setSpot] = useState<Spot>(INITIAL_SPOT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("preflop-lab-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
    setSpot(makeSpot(stackFor("Todos"), "Todos", "Todos"));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem("preflop-lab-history", JSON.stringify(history.slice(0, 250)));
  }, [history, loaded]);

  const answer = selected ? grade(spot.strategy, selected) : null;
  const recent = history.slice(0, target);
  const avgScore = recent.length ? Math.round(recent.reduce((sum, hand) => sum + hand.score, 0) / recent.length) : 0;
  const accuracy = recent.length ? Math.round(recent.filter((hand) => hand.loss <= .04).length / recent.length * 100) : 0;
  const totalLoss = round(recent.reduce((sum, hand) => sum + hand.loss, 0));
  const bestAction = [...spot.strategy].sort((a, b) => b.ev - a.ev)[0];

  const decide = useCallback((action: ActionKey) => {
    if (selected) return;
    const result = grade(spot.strategy, action);
    const record: HandRecord = { ...spot, selected: action, ...result, marked: false, timestamp: Date.now() };
    setSelected(action);
    setHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
  }, [selected, spot]);

  const next = useCallback(() => {
    setSelected(null);
    setShowMatrix(false);
    setSpot(makeSpot(stackFor(stack), scenarioFilter, heroFilter));
  }, [stack, scenarioFilter, heroFilter]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const match = spot.strategy.find((item) => ACTIONS[item.action].hotkey.toLowerCase() === event.key.toLowerCase());
      if (match) decide(match.action);
      if ((event.key === "Enter" || event.key === " ") && selected) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spot, selected, decide, next]);

  const seats = useMemo(() => {
    const index = POSITIONS.indexOf(spot.hero);
    return [...POSITIONS.slice(index), ...POSITIONS.slice(0, index)];
  }, [spot.hero]);

  const changeConfig = (newStack: StackFilter, newScenario: ScenarioKey | "Todos", newHero: Position | "Todos") => {
    setStack(newStack); setScenarioFilter(newScenario); setHeroFilter(newHero);
    setSelected(null); setShowMatrix(false); setSpot(makeSpot(stackFor(newStack), newScenario, newHero));
  };

  const leaks = (Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
    const hands = history.filter((hand) => hand.scenario === key);
    return {
      key, count: hands.length,
      score: hands.length ? Math.round(hands.reduce((sum, hand) => sum + hand.score, 0) / hands.length) : 0,
      loss: round(hands.reduce((sum, hand) => sum + hand.loss, 0)),
    };
  }).sort((a, b) => (a.score || 101) - (b.score || 101));

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView("trainer")} aria-label="Preflop Lab — início">
        <span className="brand-mark">P<span>♠</span></span>
        <span><strong>PREFLOP</strong><small>LAB</small></span>
      </button>
      <nav aria-label="Navegação principal">
        <button className={view === "trainer" ? "active" : ""} onClick={() => setView("trainer")}>Treinar</button>
        <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>Revisão <span>{history.length}</span></button>
        <button className={view === "stats" ? "active" : ""} onClick={() => setView("stats")}>Estatísticas</button>
      </nav>
      <div className="top-meta"><span className="live-dot" /> MTT 8-max <b>Chip EV</b></div>
    </header>

    {view === "trainer" && <div className="workspace">
      <aside className="control-panel">
        <div className="eyebrow"><span>SESSÃO ATIVA</span><span className="session-status">FOCO</span></div>
        <h1>Treino preflop</h1>
        <p className="muted">Decisões aleatórias na árvore completa. Um spot de cada vez.</p>

        <label className="field-label">STACK EFETIVO</label>
        <div className="stack-pills">
          <button className={stack === "Todos" ? "selected" : ""} onClick={() => changeConfig("Todos", scenarioFilter, heroFilter)}>Todos</button>
          {STACKS.map((value) =>
          <button key={value} className={stack === value ? "selected" : ""} onClick={() => changeConfig(value, scenarioFilter, heroFilter)}>
            {value}<small>bb</small>
          </button>
        )}</div>

        <label className="field-label" htmlFor="position">SUA POSIÇÃO</label>
        <select id="position" value={heroFilter} onChange={(event) => changeConfig(stack, scenarioFilter, event.target.value as Position | "Todos")}>
          <option>Todos</option>{POSITIONS.map((position) => <option key={position}>{position}</option>)}
        </select>

        <label className="field-label" htmlFor="spot">TIPO DE SPOT</label>
        <select id="spot" value={scenarioFilter} onChange={(event) => changeConfig(stack, event.target.value as ScenarioKey | "Todos", heroFilter)}>
          <option value="Todos">Todos os spots</option>
          {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => <option key={key} value={key}>{SCENARIOS[key].label}</option>)}
        </select>

        <label className="field-label">META DA SESSÃO</label>
        <div className="target-row">{[10, 20, 50].map((value) =>
          <button key={value} className={target === value ? "selected" : ""} onClick={() => setTarget(value)}>{value} mãos</button>
        )}</div>

        <div className="session-card">
          <div className="progress-copy"><span>Progresso</span><strong>{Math.min(recent.length, target)} / {target}</strong></div>
          <div className="progress"><span style={{ width: `${Math.min(100, recent.length / target * 100)}%` }} /></div>
          <div className="quick-stats">
            <div><strong>{avgScore || "—"}</strong><span>score</span></div>
            <div><strong>{accuracy ? `${accuracy}%` : "—"}</strong><span>precisão</span></div>
            <div><strong>{totalLoss ? `−${totalLoss}` : "—"}</strong><span>EV bb</span></div>
          </div>
        </div>
        <div className="model-note"><span>β</span><p><strong>Modo demonstrativo</strong>A estrutura está pronta, mas estes ranges ainda não são solves certificados. Não memorize como GTO perfeito.</p></div>
      </aside>

      <section className="table-stage">
        <div className="spot-heading">
          <div><span className="crumb">{spot.stack}BB · {SCENARIOS[spot.scenario].short}</span><h2>{SCENARIOS[spot.scenario].label}</h2><p>{SCENARIOS[spot.scenario].copy}</p></div>
          <button className="icon-button" onClick={() => setShowMatrix(!showMatrix)} aria-pressed={showMatrix}>▦ <span>Matriz</span></button>
        </div>

        <div className="poker-table-wrap">
          <div className="table-glow" />
          <div className="poker-table">
            <div className="felt-lines" />
            <div className="pot"><span>POTE</span><strong>{spot.pot} bb</strong></div>
            <div className="action-history">{spot.history.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>
            {seats.map((position, index) => {
              const hero = position === spot.hero;
              const folded = spot.scenario === "rfi" && !hero && position !== "SB" && position !== "BB";
              const villain = position === spot.villain;
              return <div className={`seat seat-${index} ${hero ? "hero" : ""} ${folded ? "folded" : ""}`} key={position}>
                {villain && <span className="action-bubble">{spot.scenario === "vs-jam" ? "ALL-IN" : spot.scenario === "vs-3bet" ? "3-BET" : "RAISE"}</span>}
                <div className="avatar">{hero ? "VOCÊ" : position === "BTN" ? "D" : position.slice(0, 2)}</div>
                <div className="seat-copy"><strong>{position}</strong><span>{villain && spot.scenario === "vs-jam" ? "0.0" : `${spot.stack}.0`} bb</span></div>
                {hero && <div className="hole-cards"><CardView card={spot.cards[0]} /><CardView card={spot.cards[1]} /></div>}
              </div>;
            })}
          </div>
        </div>

        <div className="decision-area">
          <div className="decision-title"><span>SUA DECISÃO</span><small>{spot.notation} · {spot.hero}</small></div>
          <div className="action-buttons">{spot.strategy.map((item) => {
            const chosen = selected === item.action;
            const best = Boolean(selected) && item.ev === bestAction.ev;
            return <button
              key={item.action}
              className={`${chosen ? "chosen" : ""} ${best ? "best" : ""}`}
              style={{ "--action": ACTIONS[item.action].color } as CSSProperties}
              disabled={Boolean(selected)}
              onClick={() => decide(item.action)}
            >
              <span className="hotkey">{ACTIONS[item.action].hotkey}</span>
              <strong>{ACTIONS[item.action].label}</strong>
              {selected && <small>{item.frequency}% · {item.ev >= 0 ? "+" : ""}{item.ev.toFixed(2)} EV</small>}
            </button>;
          })}</div>
        </div>

        {showMatrix && <div className="matrix-panel">
          <div className="matrix-head">
            <div><span>MAPA DO RANGE</span><strong>{spot.hero} · {SCENARIOS[spot.scenario].short} · {spot.stack}BB</strong></div>
            <div className="legend">{spot.strategy.map((item) => <span key={item.action}><i style={{ background: ACTIONS[item.action].color }} />{ACTIONS[item.action].compact}</span>)}</div>
          </div>
          <Matrix spot={spot} />
        </div>}
      </section>

      <aside className="coach-panel">
        {!selected ? <div className="waiting-card">
          <span className="target-icon">◎</span><h3>Leia a mesa</h3>
          <p>Considere posição, stack efetivo e ação anterior. Escolha a linha de maior EV.</p>
          <div className="thought-list"><span>01</span><p><strong>Quem abriu?</strong>Ranges iniciais mudam toda a defesa.</p></div>
          <div className="thought-list"><span>02</span><p><strong>Qual o stack?</strong>Stacks curtos favorecem jams.</p></div>
          <div className="thought-list"><span>03</span><p><strong>Qual sua classe?</strong>Valor, blocker ou realização de equidade.</p></div>
        </div> : answer && <div className={`feedback-card ${answer.loss <= .04 ? "correct" : answer.loss <= .12 ? "close" : "mistake"}`}>
          <div className="feedback-kicker">{answer.loss <= .04 ? "LINHA APROVADA" : answer.loss <= .12 ? "QUASE LÁ" : "REVER ESTE SPOT"}</div>
          <div className="feedback-score">
            <StatRing value={answer.score} />
            <div><h3>{answer.loss <= .04 ? "Boa decisão." : answer.loss <= .12 ? "Imprecisão." : "EV deixado na mesa."}</h3><p>{ACTIONS[selected].label} aparece em <strong>{answer.frequency}%</strong> da estratégia.</p></div>
          </div>
          <div className="ev-loss"><span>PERDA DE EV</span><strong>{answer.loss ? `−${answer.loss.toFixed(2)} bb` : "0.00 bb"}</strong></div>
          <div className="strategy-bars"><span>ESTRATÉGIA DO MODELO</span>{[...spot.strategy].sort((a, b) => b.frequency - a.frequency).map((item) =>
            <div className="strategy-row" key={item.action}>
              <div><i style={{ background: ACTIONS[item.action].color }} /><strong>{ACTIONS[item.action].label}</strong><b>{item.frequency}%</b></div>
              <span><i style={{ width: `${item.frequency}%`, background: ACTIONS[item.action].color }} /></span>
            </div>
          )}</div>
          <div className="coach-copy"><span>POR QUÊ</span><p>{quickInsight(spot, bestAction.action)}</p></div>
          <button className="next-button" onClick={next}>Próxima mão <span>ENTER ↵</span></button>
          <button className="mark-button" onClick={() => setHistory((items) => items.map((item) => item.id === spot.id ? { ...item, marked: !item.marked } : item))}>
            {history.find((item) => item.id === spot.id)?.marked ? "★ Mão marcada" : "☆ Marcar para revisar"}
          </button>
        </div>}
      </aside>
    </div>}

    {view === "review" && <section className="page-view">
      <div className="page-title">
        <div><span>HISTÓRICO LOCAL</span><h1>Revisão de mãos</h1><p>Volte aos spots de maior impacto e transforme erro em padrão reconhecível.</p></div>
        <button className="secondary-button" onClick={() => setHistory([])}>Limpar histórico</button>
      </div>
      {history.length ? <div className="review-table">
        <div className="review-head"><span>MÃO</span><span>SPOT</span><span>DECISÃO</span><span>SCORE</span><span>EV</span><span /></div>
        {history.slice(0, 40).map((hand) => {
          const optimal = [...hand.strategy].sort((a, b) => b.ev - a.ev)[0];
          return <div className="review-row" key={hand.id}>
            <span className="hand-chip">{hand.notation}</span>
            <span><strong>{hand.hero} · {hand.stack}BB</strong><small>{SCENARIOS[hand.scenario].label}</small></span>
            <span><strong>{ACTIONS[hand.selected].label}</strong><small>Modelo: {ACTIONS[optimal.action].label}</small></span>
            <span className={hand.score >= 85 ? "good" : hand.score >= 65 ? "warn" : "bad"}>{hand.score}</span>
            <span className={hand.loss ? "bad" : "good"}>{hand.loss ? `−${hand.loss.toFixed(2)} bb` : "0.00 bb"}</span>
            <button aria-label="Marcar mão" onClick={() => setHistory((items) => items.map((item) => item.id === hand.id ? { ...item, marked: !item.marked } : item))}>{hand.marked ? "★" : "☆"}</button>
          </div>;
        })}
      </div> : <div className="empty-state"><span>♠</span><h2>Nenhuma decisão registrada</h2><p>Complete algumas mãos no treino para construir seu histórico.</p><button onClick={() => setView("trainer")}>Começar sessão</button></div>}
    </section>}

    {view === "stats" && <section className="page-view">
      <div className="page-title"><div><span>DIAGNÓSTICO</span><h1>Seu jogo em números</h1><p>Os dados ficam somente neste dispositivo.</p></div></div>
      <div className="stats-grid">
        <div className="hero-stat"><StatRing value={history.length ? Math.round(history.reduce((sum, hand) => sum + hand.score, 0) / history.length) : 0} /><div><span>SCORE GERAL</span><strong>{history.length} decisões</strong><p>{history.length ? "Continue atacando primeiro os spots de menor score." : "Sua leitura começa na primeira sessão."}</p></div></div>
        <div className="metric"><span>PRECISÃO</span><strong>{history.length ? Math.round(history.filter((hand) => hand.loss <= .04).length / history.length * 100) : 0}%</strong><small>sem perda relevante</small></div>
        <div className="metric"><span>EV PERDIDO</span><strong>−{round(history.reduce((sum, hand) => sum + hand.loss, 0))} bb</strong><small>acumulado no histórico</small></div>
        <div className="metric"><span>MARCADAS</span><strong>{history.filter((hand) => hand.marked).length}</strong><small>mãos para revisão</small></div>
      </div>
      <div className="leaks-card">
        <div className="card-title"><div><span>MAPA DE LEAKS</span><h2>Performance por formação</h2></div><small>priorizado pelo menor score</small></div>
        <div className="leak-table">{leaks.map((row) => <div className="leak-row" key={row.key}>
          <div><strong>{SCENARIOS[row.key].label}</strong><small>{row.count} decisões</small></div>
          <span className="leak-track"><i style={{ width: `${row.score}%` }} /></span>
          <b>{row.count ? row.score : "—"}</b><small>{row.loss ? `−${row.loss} bb` : "0.00 bb"}</small>
          <button onClick={() => { setScenarioFilter(row.key); setView("trainer"); setSpot(makeSpot(stackFor(stack), row.key, heroFilter)); setSelected(null); }}>Treinar</button>
        </div>)}</div>
      </div>
    </section>}
  </main>;
}
