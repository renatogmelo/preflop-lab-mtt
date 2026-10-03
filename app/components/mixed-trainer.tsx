"use client";

import { useState } from "react";
import { ACTIONS, type ActionKey } from "../core/domain";
import { boundaryCandidates } from "../core/learning";
import { defaultQuery, dominantAction, isMixedStrategy, strategyRepository } from "../core/strategy-data";
import { TrustBadge } from "./trust-badge";

type Stage = "recognition" | "composition" | "frequency";

export function MixedStrategyTrainer() {
  const lookup = strategyRepository.lookup(defaultQuery({ stack: 40, hero: "BTN", scenario: "rfi" }));
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("recognition");
  const [recognition, setRecognition] = useState<"pure" | "mixed" | null>(null);
  const [composition, setComposition] = useState<ActionKey[]>([]);
  const [estimate, setEstimate] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState(false);
  if (lookup.status === "unavailable") return <div className="honest-empty"><h2>Estratégia indisponível</h2><p>{lookup.reason}</p></div>;
  const pool = boundaryCandidates(lookup.node, 169).filter((item) => isMixedStrategy(item.strategy));
  const current = pool[index % pool.length];
  const expectedActions = current.strategy.filter((item) => item.frequency >= 5).map((item) => item.action);
  const recognitionCorrect = recognition === "mixed";
  const compositionCorrect = composition.length === expectedActions.length && expectedActions.every((action) => composition.includes(action));
  const total = current.strategy.reduce((sum, item) => sum + (estimate[item.action] ?? 0), 0);
  const mae = current.strategy.reduce((sum, item) => sum + Math.abs((estimate[item.action] ?? 0) - item.frequency), 0) / current.strategy.length;
  const reset = () => { setIndex((value) => value + 1); setStage("recognition"); setRecognition(null); setComposition([]); setEstimate({}); setChecked(false); };
  return <section className="training-lab"><div className="trainer-lab-head"><div><span>MIXED STRATEGY TRAINER</span><h1>Entenda a mistura antes do número</h1><p>Recognition → Composition → Frequency. A progressão ensina função e composição antes de cobrar aproximações.</p></div><TrustBadge level={lookup.node.provenance.trustLevel} /></div>
    <div className="mixed-progress">{(["recognition", "composition", "frequency"] as Stage[]).map((item, itemIndex) => <span key={item} className={stage === item ? "active" : ""}>{itemIndex + 1} · {item}</span>)}</div>
    <div className="focused-trainer"><div className="focused-question"><span>{stage.toUpperCase()}</span><small>BTN · RFI · 40bb</small><b>{current.hand}</b><p>{stage === "recognition" ? "Esta mão usa uma ação pura ou mistura ações?" : stage === "composition" ? "Quais ações fazem parte da mistura relevante?" : "Aproxime a proporção entre as ações. Não é necessário decorar casas decimais."}</p></div>
      {stage === "recognition" && <><div className="focused-actions"><button className={recognition === "pure" ? "chosen" : ""} onClick={() => setRecognition("pure")}>Pure</button><button className={recognition === "mixed" ? "chosen" : ""} onClick={() => setRecognition("mixed")}>Mixed</button></div>{recognition && <div className={`focused-feedback ${recognitionCorrect ? "good" : "bad"}`}><strong>{recognitionCorrect ? "Correto: há mais de uma ação relevante." : "Aqui existe uma mistura relevante."}</strong><button onClick={() => setStage("composition")}>Composition →</button></div>}</>}
      {stage === "composition" && <><div className="focused-actions">{lookup.node.actionsAvailable.map((action) => <button key={action} className={composition.includes(action) ? "chosen" : ""} onClick={() => setComposition((items) => items.includes(action) ? items.filter((item) => item !== action) : [...items, action])}>{ACTIONS[action].label}</button>)}</div><div className="focused-feedback"><p>Selecione todas as ações que você espera.</p><button onClick={() => compositionCorrect ? setStage("frequency") : setChecked(true)}>Verificar composição</button>{checked && <strong>{compositionCorrect ? "Composição correta." : `A mistura contém ${expectedActions.map((item) => ACTIONS[item].label).join(" + ")}.`}</strong>}{checked && !compositionCorrect && <button onClick={() => { setComposition(expectedActions); setStage("frequency"); setChecked(false); }}>Continuar com a composição correta</button>}</div></>}
      {stage === "frequency" && <div className="frequency-form">{current.strategy.map((item) => <label key={item.action}><span><i style={{ background: ACTIONS[item.action].color }} />{ACTIONS[item.action].label}<b>{estimate[item.action] ?? 0}%</b></span><input type="range" min="0" max="100" step="5" value={estimate[item.action] ?? 0} onChange={(event) => setEstimate((values) => ({ ...values, [item.action]: Number(event.target.value) }))} /></label>)}<div className={`frequency-total ${total === 100 ? "valid" : ""}`}><span>Total</span><b>{total}%</b></div>{!checked ? <button className="primary-lab-button" disabled={total !== 100} onClick={() => setChecked(true)}>Comparar</button> : <div className="frequency-result"><span>MAE</span><strong>{mae.toFixed(1)}pp</strong><p>Ação dominante: {ACTIONS[dominantAction(current.strategy).action].label}. {mae <= 10 ? "Boa aproximação da região." : "Revise a proporção, preservando primeiro a composição correta."}</p><button className="primary-lab-button" onClick={reset}>Próxima mistura</button></div>}</div>}
    </div>
  </section>;
}
