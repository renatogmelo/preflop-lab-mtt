"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIONS, grade, INITIAL_SPOT, POSITIONS, RANKS, round, SCENARIOS, scenarioIsCompatible, STACKS, strategy,
  type ActionKey, type Card, type Confidence, type HandRecord, type Position, type RoundResolution, type ScenarioKey, type Spot,
} from "./engine";
import { makeSpot, resolveRound } from "./simulation";
import { ExploreView, type ExploreSearchRequest } from "./views/explore-view";
import { TrainingLab, TrainingModeNav, type TrainingMode } from "./views/training-lab";
import { LearnView } from "./views/learn-view";
import { AnalyzeView, ProgressView } from "./views/analytics-view";

type ViewKey = "learn" | "train" | "explore" | "analyze" | "progress";
type StackFilter = number | "Todos";

function stackFor(filter: StackFilter, scenario?: ScenarioKey | "Todos") {
  if (filter !== "Todos") return filter;
  const pool = scenario === "vs-jam" ? STACKS.filter((value) => value <= 25) : STACKS;
  return pool[Math.floor(Math.random() * pool.length)];
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
      const primary = [...strategy(hand, spot.scenario, spot.hero, spot.stack, spot.villain, spot.caller)].sort((a, b) => b.frequency - a.frequency)[0];
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
  const strength = pair
    ? "Um par começa na frente de muitas mãos sem par."
    : suited
      ? "Cartas do mesmo naipe podem formar um flush e costumam jogar melhor depois do flop."
      : hasAce
        ? "O ás reduz a chance de o adversário ter AA ou AK."
        : broadway
          ? "Duas cartas altas podem formar pares fortes e sequências."
          : "Cartas de naipes diferentes formam menos jogos fortes depois do flop.";
  const opener = spot.villain ?? "o range adversário";
  const move = action === "call" ? "Pagar" : action === "jam" ? "Ir all-in" : action === "threebet" ? "Aumentar novamente" : action === "fourbet" ? "Fazer a 4-bet" : action === "limp" ? "Completar" : "Abrir raise";

  if (spot.scenario === "vs-jam") {
    const posted = spot.hero === "BB" ? 1 : spot.hero === "SB" ? .5 : 0;
    const callAmount = spot.stack - posted;
    const required = Math.round(callAmount / (spot.pot + callAmount) * 100);
    return action === "fold"
      ? `Para pagar o all-in de ${opener}, esta mão precisa ganhar cerca de ${required}% das vezes. ${strength} Mesmo assim, ela não ganha o suficiente contra as mãos que costumam ir all-in.`
      : `Para pagar o all-in de ${opener}, esta mão precisa ganhar cerca de ${required}% das vezes. ${strength} Aqui ela ganha vezes suficientes para justificar o call.`;
  }
  if (spot.scenario === "rfi") return action === "fold"
    ? `${strength} Porém, em ${spot.hero}, esta mão é fraca demais para abrir com lucro e terá decisões difíceis se alguém reagir.`
    : `${strength} Em ${spot.hero}, abrir coloca pressão nos jogadores restantes e pode ganhar os blinds sem precisar ver o flop.`;
  if (spot.scenario === "bb-defense") return action === "fold"
    ? hasAce && !suited
      ? `${strength} Mesmo pagando menos por estar no BB, ${spot.notation} costuma perder para ases com carta acompanhante maior. Além disso, você jogará primeiro depois do flop, então o fold é mais seguro.`
      : `${strength} Mesmo pagando menos no BB, você jogará primeiro depois do flop e esta mão não é forte o bastante para compensar essa desvantagem.`
    : `${strength} Como o BB já colocou 1 blind, continuar custa menos. ${move} é lucrativo o bastante contra a abertura de ${opener}.`;
  if (spot.scenario === "vs-3bet") return action === "fold"
    ? `${strength} Porém, contra a 3-bet você precisa investir mais fichas e enfrentará mãos mais fortes. Esta mão não joga bem o bastante para continuar.`
    : `${strength} Mesmo contra uma 3-bet, esta mão ainda é forte o bastante. ${move} evita abandonar uma mão que pode ganhar um pote grande.`;
  if (spot.scenario === "squeeze") return action === "fold"
    ? `${strength} Aqui já houve um raise e um call, então você pode enfrentar duas mãos ao mesmo tempo. Esta mão não é forte o bastante para entrar nesse pote grande.`
    : `${strength} Já existe mais dinheiro no pote por causa do raise e do call. ${move} pode ganhar esse dinheiro agora ou jogar com uma mão forte se alguém continuar.`;
  if (spot.scenario === "bvb") return action === "fold"
    ? `${strength} Mesmo com apenas os blinds na disputa, esta mão continua fraca e tende a criar decisões ruins depois do flop.`
    : `${strength} Como só restam SB e BB, os dois jogam muito mais mãos. Por isso, ${move.toLowerCase()} com esta mão pode dar lucro.`;
  return action === "fold"
    ? `${strength} Contra a abertura de ${opener}, esta mão costuma estar atrás e pode ser difícil de jogar depois do flop. O fold evita investir fichas em uma situação ruim.`
    : `${strength} A abertura de ${opener} também pode incluir mãos mais fracas. Por isso, ${move.toLowerCase()} com esta mão pode dar lucro no longo prazo.`;
}

export default function Home() {
  const [view, setView] = useState<ViewKey>("train");
  const [trainMode, setTrainMode] = useState<TrainingMode>("decision");
  const [stack, setStack] = useState<StackFilter>("Todos");
  const [heroFilter, setHeroFilter] = useState<Position | "Todos">("Todos");
  const [scenarioFilter, setScenarioFilter] = useState<ScenarioKey | "Todos">("Todos");
  const [target, setTarget] = useState(20);
  const [history, setHistory] = useState<HandRecord[]>([]);
  const [selected, setSelected] = useState<ActionKey | null>(null);
  const [confidence, setConfidence] = useState<Confidence>(3);
  const [autoNext, setAutoNext] = useState(() => typeof window === "undefined" ? 0 : Number(localStorage.getItem("preflop-lab-auto-next") ?? 0));
  const [pauseOnMistake, setPauseOnMistake] = useState(() => typeof window === "undefined" ? true : localStorage.getItem("preflop-lab-pause-mistake") !== "false");
  const [resolution, setResolution] = useState<RoundResolution | null>(null);
  const [showMatrix, setShowMatrix] = useState(false);
  const [spot, setSpot] = useState<Spot>(INITIAL_SPOT);
  const [loaded, setLoaded] = useState(false);
  const [persistence, setPersistence] = useState<"local" | "d1">("local");
  const [searchText, setSearchText] = useState("");
  const [exploreSearch, setExploreSearch] = useState<ExploreSearchRequest>();
  const migratedRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem("preflop-lab-history");
        if (saved) {
          const parsed = JSON.parse(saved) as HandRecord[];
          setHistory(parsed.map((hand) => ({
            ...hand,
            correct: hand.correct ?? (typeof hand.loss === "number" && hand.loss <= .04),
            frequencyError: hand.frequencyError ?? 0,
            confidence: hand.confidence ?? 3,
            knowledgeState: hand.knowledgeState ?? "uncertain",
            loss: hand.provenance?.evAvailable ? hand.loss : null,
          })));
        }
      } catch {
        localStorage.removeItem("preflop-lab-history");
      }
      setSpot(makeSpot(stackFor("Todos"), "Todos", "Todos"));
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem("preflop-lab-history", JSON.stringify(history.slice(0, 250)));
  }, [history, loaded]);

  useEffect(() => {
    if (!loaded || migratedRef.current) return;
    migratedRef.current = true;
    const local = history;
    void fetch("/api/user-data").then(async (response) => {
      if (!response.ok) return;
      const remote = await response.json() as { history?: HandRecord[] };
      const merged = [...(remote.history ?? []), ...local].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).sort((a, b) => b.timestamp - a.timestamp);
      setHistory(merged.slice(0, 2000));
      setPersistence("d1");
      if (local.length) void fetch("/api/user-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ history: local }) });
    }).catch(() => setPersistence("local"));
  }, [loaded, history]);

  const answer = selected ? grade(spot.strategy, selected) : null;
  const recent = history.slice(0, target);
  const avgScore = recent.length ? Math.round(recent.reduce((sum, hand) => sum + hand.score, 0) / recent.length) : 0;
  const accuracy = recent.length ? Math.round(recent.filter((hand) => hand.correct).length / recent.length * 100) : 0;
  const knownLosses = recent.filter((hand) => hand.loss !== null);
  const totalLoss = knownLosses.length ? round(knownLosses.reduce((sum, hand) => sum + (hand.loss ?? 0), 0)) : null;
  const bestAction = [...spot.strategy].sort((a, b) => b.frequency - a.frequency)[0];

  const decide = useCallback((action: ActionKey) => {
    if (selected) return;
    const result = grade(spot.strategy, action, confidence);
    const roundResolution = resolveRound(spot, action);
    const record: HandRecord = { ...spot, selected: action, ...result, confidence, resolution: roundResolution, marked: false, timestamp: Date.now() };
    setSelected(action);
    setResolution(roundResolution);
    setHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
    void fetch("/api/user-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ history: [record] }) }).then((response) => {
      if (response.ok) setPersistence("d1");
    }).catch(() => setPersistence("local"));
  }, [selected, spot, confidence]);

  const next = useCallback(() => {
    setSelected(null);
    setResolution(null);
    setShowMatrix(false);
    setSpot(makeSpot(stackFor(stack, scenarioFilter), scenarioFilter, heroFilter));
  }, [stack, scenarioFilter, heroFilter]);

  useEffect(() => {
    if (!selected || !autoNext || (pauseOnMistake && !answer?.correct)) return;
    const timer = window.setTimeout(next, autoNext * 1000);
    return () => window.clearTimeout(timer);
  }, [selected, autoNext, pauseOnMistake, answer?.correct, next]);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("preflop-lab-auto-next", String(autoNext));
    localStorage.setItem("preflop-lab-pause-mistake", String(pauseOnMistake));
    void fetch("/api/user-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferences: { autoNext, pauseOnMistake } }) });
  }, [autoNext, pauseOnMistake, loaded]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const match = spot.strategy.find((item) => ACTIONS[item.action].hotkey.toLowerCase() === event.key.toLowerCase());
      if (match) decide(match.action);
      if (/^[1-5]$/.test(event.key)) setConfidence(Number(event.key) as Confidence);
      if (event.key.toLowerCase() === "m" && selected) setHistory((items) => items.map((item) => item.id === spot.id ? { ...item, marked: !item.marked } : item));
      if (event.key.toLowerCase() === "e") setShowMatrix((value) => !value);
      if ((event.key === "Enter" || event.key === " ") && selected) { event.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spot, selected, decide, next]);

  const seats = useMemo(() => {
    const index = POSITIONS.indexOf(spot.hero);
    return [...POSITIONS.slice(index), ...POSITIONS.slice(0, index)];
  }, [spot.hero]);

  const changeConfig = (newStack: StackFilter, newScenario: ScenarioKey | "Todos", newHero: Position | "Todos") => {
    const fixedStack = newStack === "Todos" ? undefined : newStack;
    const compatibleScenario = newScenario !== "Todos" && !scenarioIsCompatible(newScenario, newHero, fixedStack) ? "Todos" : newScenario;
    setStack(newStack); setScenarioFilter(compatibleScenario); setHeroFilter(newHero);
    setSelected(null); setResolution(null); setShowMatrix(false); setSpot(makeSpot(stackFor(newStack, compatibleScenario), compatibleScenario, newHero));
  };

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView("train")} aria-label="Preflop Lab — início">
        <span className="brand-mark">P<span>♠</span></span>
        <span><strong>PREFLOP</strong><small>LAB</small></span>
      </button>
      <nav aria-label="Navegação principal">
        <button className={view === "learn" ? "active" : ""} onClick={() => setView("learn")}>Aprender</button>
        <button className={view === "train" ? "active" : ""} onClick={() => setView("train")}>Treinar</button>
        <button className={view === "explore" ? "active" : ""} onClick={() => setView("explore")}>Explorar</button>
        <button className={view === "analyze" ? "active" : ""} onClick={() => setView("analyze")}>Analisar <span>{history.length}</span></button>
        <button className={view === "progress" ? "active" : ""} onClick={() => setView("progress")}>Progresso</button>
      </nav>
      <div className="top-meta"><form className="global-search" onSubmit={(event) => { event.preventDefault(); if (!searchText.trim()) return; setExploreSearch({ id: Date.now(), text: searchText }); setView("explore"); }}><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="BTN vs BB 40bb" aria-label="Buscar spot" /><button aria-label="Buscar">⌕</button></form><span className="live-dot" /><small>{persistence === "d1" ? "Cloud" : "Local"}</small></div>
    </header>

    {view === "learn" && <LearnView onPractice={(scenario, hero, lessonStack) => { changeConfig(lessonStack, scenario, hero); setTrainMode("decision"); setView("train"); }} />}

    {view === "explore" && <ExploreView key={exploreSearch?.id ?? 0} searchRequest={exploreSearch} />}

    {view === "train" && <>
      <TrainingModeNav mode={trainMode} onChange={setTrainMode} />
      {trainMode === "decision" ? <div className="workspace">
      <aside className="control-panel">
        <div className="eyebrow"><span>SESSÃO ATIVA</span><span className="session-status">FOCO</span></div>
        <h1>Treino preflop</h1>
        <p className="muted">Oito mãos únicas, ranges condicionados e decisões independentes. Um spot de cada vez.</p>

        <div className="field-label">STACK EFETIVO</div>
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
          {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => <option key={key} value={key} disabled={!scenarioIsCompatible(key, heroFilter, stack === "Todos" ? undefined : stack)}>{SCENARIOS[key].label}</option>)}
        </select>

        <div className="field-label">META DA SESSÃO</div>
        <div className="target-row">{[10, 20, 50].map((value) =>
          <button key={value} className={target === value ? "selected" : ""} onClick={() => setTarget(value)}>{value} mãos</button>
        )}</div>

        <div className="speed-settings"><label>PRÓXIMA MÃO<select value={autoNext} onChange={(event) => setAutoNext(Number(event.target.value))}><option value={0}>Manual</option><option value={1.5}>Após 1.5s</option><option value={3}>Após 3s</option><option value={5}>Após 5s</option></select></label><label className="pause-toggle"><input type="checkbox" checked={pauseOnMistake} onChange={(event) => setPauseOnMistake(event.target.checked)} />Pausar nos erros</label></div>

        <div className="session-card">
          <div className="progress-copy"><span>Progresso</span><strong>{Math.min(recent.length, target)} / {target}</strong></div>
          <div className="progress"><span style={{ width: `${Math.min(100, recent.length / target * 100)}%` }} /></div>
          <div className="quick-stats">
            <div><strong>{avgScore || "—"}</strong><span>score</span></div>
            <div><strong>{accuracy ? `${accuracy}%` : "—"}</strong><span>precisão</span></div>
            <div><strong>{totalLoss !== null ? `−${totalLoss}` : "—"}</strong><span>EV verificado</span></div>
          </div>
        </div>
        <div className="model-note"><span>~</span><p><strong>{spot.provenance.sourceLabel} · {spot.provenance.sourceType}</strong>Frequências aproximadas e claramente identificadas. EV não é exibido sem um dataset confiável.</p></div>
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
              const seatState = spot.seats?.find((seat) => seat.position === position);
              const postEvent = resolution?.events.find((event) => event.position === position);
              const action = postEvent?.action ?? seatState?.actionBeforeHero;
              const folded = action === "fold";
              const bubble = action && action !== "fold" ? (postEvent?.text === "BB check" ? "CHECK" : ACTIONS[action].compact) : null;
              const emptyStack = action === "jam" || (hero && selected === "jam");
              return <div className={`seat seat-${index} ${hero ? "hero" : ""} ${folded ? "folded" : ""} ${selected && !hero ? "revealed" : ""}`} key={position}>
                {!hero && bubble && <span className={`action-bubble action-${action}`}>{bubble}</span>}
                <div className="avatar">{hero ? "VOCÊ" : position === "BTN" ? "D" : position.slice(0, 2)}</div>
                <div className="seat-copy"><strong>{position}</strong><span>{emptyStack ? "0.0" : `${spot.stack}.0`} bb</span></div>
                {hero && <div className="hole-cards"><CardView card={spot.cards[0]} /><CardView card={spot.cards[1]} /></div>}
                {selected && !hero && seatState && <div className="hole-cards opponent-cards"><CardView card={seatState.cards[0]} /><CardView card={seatState.cards[1]} /></div>}
              </div>;
            })}
          </div>
        </div>

        <div className="decision-area">
          <div className="decision-title"><span>SUA DECISÃO</span><small>{spot.notation} · {spot.hero}</small></div>
          <div className="confidence-row"><span>CONFIANÇA</span><div>{([1, 2, 3, 4, 5] as Confidence[]).map((value) => <button key={value} className={confidence === value ? "selected" : ""} onClick={() => setConfidence(value)} disabled={Boolean(selected)} aria-label={`Confiança ${value} de 5`}><kbd>{value}</kbd>{value === 1 ? "Chute" : value === 3 ? "Acho" : value === 5 ? "Certeza" : ""}</button>)}</div></div>
          <div className="action-buttons">{spot.strategy.map((item) => {
            const chosen = selected === item.action;
            const best = Boolean(selected) && item.action === bestAction.action;
            return <button
              key={item.action}
              className={`${chosen ? "chosen" : ""} ${best ? "best" : ""}`}
              style={{ "--action": ACTIONS[item.action].color } as CSSProperties}
              disabled={Boolean(selected)}
              onClick={() => decide(item.action)}
            >
              <span className="hotkey">{ACTIONS[item.action].hotkey}</span>
              <strong>{ACTIONS[item.action].label}</strong>
              {selected && <small>~{item.frequency}% · {item.ev === null ? "EV indisponível" : `${item.ev >= 0 ? "+" : ""}${item.ev.toFixed(2)} EV`}</small>}
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
          <p>Considere posição, stack efetivo e ação anterior. Os adversários já têm cartas ocultas e decidirão pelos próprios ranges.</p>
          <div className="thought-list"><span>01</span><p><strong>Quem abriu?</strong>Ranges iniciais mudam toda a defesa.</p></div>
          <div className="thought-list"><span>02</span><p><strong>Qual o stack?</strong>Stacks curtos favorecem jams.</p></div>
          <div className="thought-list"><span>03</span><p><strong>Qual é o tipo da mão?</strong>Par, cartas altas, mesmo naipe ou mão fraca.</p></div>
        </div> : answer && <div className={`feedback-card ${answer.correct ? "correct" : answer.frequencyError <= 20 ? "close" : "mistake"}`}>
          <div className="feedback-kicker">{spot.provenance.sourceLabel.toUpperCase()} · {spot.provenance.sourceType.toUpperCase()}</div>
          <div className="feedback-score">
            <StatRing value={answer.score} />
            <div><h3>Análise da decisão.</h3><p>{ACTIONS[selected].label} aparece em aproximadamente <strong>{answer.frequency}%</strong> neste dataset.</p></div>
          </div>
          <div className="ev-loss"><span>PERDA DE EV</span><strong>{answer.loss === null ? "INDISPONÍVEL" : answer.loss ? `−${answer.loss.toFixed(2)} bb` : "0.00 bb"}</strong></div>
          <div className="strategy-bars"><span>REFERÊNCIA DO DATASET</span>{[...spot.strategy].sort((a, b) => b.frequency - a.frequency).map((item) =>
            <div className="strategy-row" key={item.action}>
              <div><i style={{ background: ACTIONS[item.action].color }} /><strong>{ACTIONS[item.action].label}</strong><b>{item.frequency}%</b></div>
              <span><i style={{ width: `${item.frequency}%`, background: ACTIONS[item.action].color }} /></span>
            </div>
          )}</div>
          <div className="coach-copy"><span>POR QUÊ</span><p>{quickInsight(spot, bestAction.action)}</p></div>
          {resolution && spot.seats && <div className="reveal-panel">
            <div className="reveal-head"><span>SHOWDOWN DIDÁTICO</span><small>{resolution.summary}</small></div>
            <div className="reveal-grid">{spot.seats.filter((seat) => seat.position !== spot.hero).map((seat) => {
              const event = resolution.events.find((item) => item.position === seat.position);
              const prior = seat.actionBeforeHero;
              const line = event?.text ?? (prior ? seat.position + " " + ACTIONS[prior].label.toLowerCase() : "Não precisou agir");
              return <div className="reveal-row" key={seat.position}>
                <strong>{seat.position}</strong>
                <div className="reveal-cards"><CardView card={seat.cards[0]} /><CardView card={seat.cards[1]} /></div>
                <span>{seat.notation}</span>
                <small>{line}</small>
              </div>;
            })}</div>
            <p>As decisões adversárias usam somente mão própria, posição, stack e range do nó — nunca as cartas do herói.</p>
          </div>}
          <button className="next-button" onClick={next}>Próxima mão <span>ENTER ↵</span></button>
          <button className="mark-button" onClick={() => setHistory((items) => items.map((item) => item.id === spot.id ? { ...item, marked: !item.marked } : item))}>
            {history.find((item) => item.id === spot.id)?.marked ? "★ Mão marcada" : "☆ Marcar para revisar"}
          </button>
        </div>}
      </aside>
    </div> : <TrainingLab mode={trainMode} history={history} />}
    </>}

    {view === "analyze" && <AnalyzeView history={history} onHistoryChange={setHistory} onTrainLeak={(scenario, targetHero, targetStack) => {
      changeConfig(targetStack, scenario, POSITIONS.includes(targetHero as Position) ? targetHero as Position : "BTN");
      setTrainMode("leak");
      setView("train");
    }} />}

    {view === "progress" && <ProgressView history={history} onToday={() => { setTrainMode("boundary"); setView("train"); }} />}
  </main>;
}
