import { ACTIONS, type ActionKey, type InterfaceLevel, type Spot } from "./domain";
import { handFeatures } from "./hands";

function referencePrefix(spot: Spot) {
  return spot.provenance.trustLevel === "verified"
    ? "No dataset verificado"
    : spot.provenance.trustLevel === "curated"
      ? "Nesta estratégia de referência curada"
      : "Neste modelo educacional";
}

export function explainDecision(spot: Spot, action: ActionKey, level: InterfaceLevel) {
  const hand = handFeatures(spot.notation);
  const opener = spot.villain ?? "o range adversário";
  const actionLabel = ACTIONS[action].label.toLowerCase();
  const suited = hand.suited ? "o mesmo naipe melhora a realização de equidade" : "sem o mesmo naipe, a mão realiza menos equidade";
  const blocker = hand.ace ? "O ás bloqueia parte de AA e AK, o que é uma vantagem" : hand.king ? "O rei bloqueia parte de KK e AK" : "A mão não remove muitas combinações do topo adversário";
  const domination = hand.ace && hand.low <= 8 && !hand.suited ? "mas ainda sofre dominação contra ases melhores" : hand.broadway ? "e suas cartas altas preservam boa força relativa" : "e pode ser dominada quando encontra resistência";
  const position = spot.hero === "BB" || spot.hero === "SB" ? "fora de posição" : "com posição favorável em boa parte das continuações";
  const stack = spot.stack <= 15 ? "O stack curto aumenta o peso da equidade imediata e dos all-ins." : spot.stack <= 30 ? "O stack médio comprime o espaço para calls marginais e re-raises." : "O stack mais profundo aumenta o valor de realização, jogabilidade e cobertura de boards.";

  if (level === "beginner") {
    if (action === "fold") return `${blocker}, ${domination}. ${suited}. Esses pontos não compensam o range de ${opener} e jogar ${position}; por isso o fold preserva fichas.`;
    return `${referencePrefix(spot)}, ${spot.notation} continua com ${actionLabel}. ${blocker}; ${suited}. A combinação desses fatores sustenta a decisão.`;
  }
  if (level === "advanced") {
    const scenario = spot.scenario === "rfi" ? "quantos ranges ainda podem reagir" : spot.scenario === "vs-3bet" ? "o range concentrado da 3-bet e o preço da continuação" : spot.scenario === "bb-defense" ? "o desconto do blind contra a dificuldade de realizar equidade" : "o range anterior, o preço e a posição";
    return `${referencePrefix(spot)}, a decisão considera ${scenario}. ${blocker}, ${domination}; ${suited}. ${stack}`;
  }
  const construction = ["raise", "threebet", "fourbet", "jam"].includes(action)
    ? "A mão ocupa a região agressiva por combinar força relativa, remoção de continuações e cobertura do range"
    : action === "call"
      ? "A mão permanece na região de call porque conserva equidade sem inflar a faixa agressiva"
      : "A mão fica fora da fronteira de continuação porque sua realização e resistência à dominação são insuficientes";
  return `${referencePrefix(spot)}, ${construction}. ${blocker}; ${domination}, e joga ${position}. ${stack} Compare as vizinhas para localizar onde a ação dominante ou a composição da mistura muda.`;
}
