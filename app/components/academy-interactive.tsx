"use client";

import { useState } from "react";
import type { Position } from "../core/domain";
import { handFeatures } from "../core/hands";
import { defaultQuery, strategyRepository } from "../core/strategy-data";
import { StrategyMatrix } from "./strategy-matrix";

const ORDER: Position[] = ["UTG", "HJ", "CO", "BTN", "SB"];

function vpip(position: Position) {
  const result = strategyRepository.lookup(defaultQuery({ stack: 40, hero: position, scenario: "rfi" }));
  if (result.status === "unavailable") return null;
  const combos = Object.entries(result.node.strategyByHand).reduce((sum, [hand, actions]) => sum + handFeatures(hand).combos * actions.filter((item) => item.action !== "fold").reduce((value, item) => value + item.frequency, 0) / 100, 0);
  return { node: result.node, percent: combos / 1326 * 100 };
}

export function PositionExpansionLab() {
  const [index, setIndex] = useState(0);
  const [prediction, setPrediction] = useState<"expand" | "contract" | null>(null);
  const position = ORDER[index];
  const current = vpip(position);
  const next = ORDER[index + 1];
  return <section className="academy-interactive"><header><span>INTERACTIVE · POSITION EVOLUTION</span><h2>Veja o range crescer, depois preveja o próximo passo</h2></header><div className="position-steps">{ORDER.map((item, itemIndex) => <button key={item} className={itemIndex === index ? "active" : ""} onClick={() => { setIndex(itemIndex); setPrediction(null); }}>{item}</button>)}</div>{current && <div className="academy-range-step"><div><b>{position}</b><strong>{current.percent.toFixed(1)}%</strong><small>entrada ponderada no pote</small></div><StrategyMatrix node={current.node} compact /></div>}{next ? <div className="prediction-row"><p>Indo de {position} para {next}, o range tende a:</p><button onClick={() => setPrediction("expand")}>Expandir</button><button onClick={() => setPrediction("contract")}>Contrair</button>{prediction && <span className={prediction === "expand" ? "good" : "bad"}>{prediction === "expand" ? "Correto: menos ranges atrás permitem incluir novas regiões." : "Revise: em geral há menos jogadores para reagir, então o range se expande."}</span>}<button disabled={!prediction} onClick={() => { setIndex((value) => Math.min(ORDER.length - 1, value + 1)); setPrediction(null); }}>Revelar próxima posição</button></div> : <p className="good">Chegamos ao SB. Agora abra o RFI Trainer e teste as fronteiras que entraram.</p>}</section>;
}
