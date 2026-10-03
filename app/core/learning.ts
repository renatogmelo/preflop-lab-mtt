import {
  ACTIONS,
  type ActionKey,
  type Confidence,
  type Difficulty,
  type HandRecord,
  type KnowledgeState,
  type ScenarioKey,
  type StrategyAction,
  type StrategyNode,
} from "./domain";
import { handFeatures, nearbyHands } from "./hands";
import { dominantAction, isMixedStrategy } from "./strategy-data";

export type LearningState = {
  key: string;
  nodeId: string;
  hand: string;
  attempts: number;
  correct: number;
  incorrect: number;
  streak: number;
  lastSeen: number;
  nextReview: number;
  mastery: number;
  confidenceCalibration: number;
  averageEvLoss: number | null;
  averageFrequencyError: number;
  knowledgeState: KnowledgeState;
};

export type LearningAttempt = {
  nodeId: string;
  hand: string;
  correct: boolean;
  confidence: Confidence;
  frequencyError: number;
  evLoss: number | null;
  difficulty: Difficulty;
  timestamp: number;
};

export type LeakInsight = {
  id: string;
  severity: "major" | "moderate" | "watch";
  confidence: "possible" | "likely" | "confirmed";
  title: string;
  description: string;
  scenario: ScenarioKey;
  hero: string;
  stackBand: string;
  handClass: string;
  attempts: number;
  accuracy: number;
  frequencyError: number;
  evLoss: number | null;
  recommendedMode: "boundary" | "mixed" | "decision";
};

export type MasteryNode = {
  key: string;
  label: string;
  mastery: number;
  attempts: number;
  evidence: "insufficient" | "learning" | "competent" | "strong" | "mastered";
  datasetLabel?: string;
  children?: MasteryNode[];
};

export type BoundaryCandidate = {
  hand: string;
  score: number;
  reason: string;
  strategy: StrategyAction[];
};

export type SessionReport = {
  decisions: number;
  accuracy: number;
  frequencyMae: number;
  evLoss: number | null;
  strongest: string | null;
  weakest: string | null;
  misconceptions: number;
  recommendation: string;
};

const DAY = 86_400_000;
const DIFFICULTY_FACTOR: Record<Difficulty, number> = {
  beginner: .82,
  intermediate: 1,
  advanced: 1.18,
  pro: 1.35,
};

export function learningKey(nodeId: string, hand: string) {
  return nodeId + "::" + hand;
}

export function classifyKnowledge(correct: boolean, confidence: Confidence, attempts = 1): KnowledgeState {
  if (!correct && confidence >= 4) return "misconception";
  if (!correct && confidence <= 2) return "knowledge-gap";
  if (correct && confidence >= 4 && attempts >= 3) return "mastered";
  return "uncertain";
}

function recencyScore(lastSeen: number, now: number) {
  if (!lastSeen) return 0;
  const ageDays = Math.max(0, now - lastSeen) / DAY;
  return Math.exp(-ageDays / 45);
}

export function computeMastery(input: {
  attempts: number;
  correct: number;
  averageFrequencyError: number;
  confidenceCalibration: number;
  streak: number;
  lastSeen: number;
  strategyTrust?: "verified" | "curated" | "modeled" | "experimental";
}, now = Date.now()) {
  if (input.attempts <= 0) return 0;
  const accuracy = input.correct / input.attempts;
  const evidence = 1 - Math.exp(-input.attempts / 8);
  const frequency = 1 - Math.min(1, input.averageFrequencyError / 50);
  const stability = Math.min(1, input.streak / 5);
  const recency = recencyScore(input.lastSeen, now);
  const calibration = Math.max(0, Math.min(1, input.confidenceCalibration));
  const trustFactor = input.strategyTrust === "verified" ? 1 : input.strategyTrust === "curated" ? .97 : input.strategyTrust === "experimental" ? .72 : .88;
  const quality = accuracy * .44 + frequency * .2 + calibration * .12 + stability * .12 + recency * .12;
  return Math.round(Math.min(.99, quality * evidence * trustFactor) * 100);
}

function nextIntervalDays(attempts: number, streak: number, correct: boolean, confidence: Confidence, difficulty: Difficulty, knowledge: KnowledgeState) {
  if (knowledge === "misconception") return .25;
  if (!correct) return confidence <= 2 ? .75 : .4;
  const confidenceFactor = .65 + confidence * .16;
  const base = Math.max(1, Math.pow(1.82, Math.min(8, streak)) * confidenceFactor);
  const evidenceGuard = .7 + Math.min(1, attempts / 8) * .3;
  return Math.min(90, base * evidenceGuard / DIFFICULTY_FACTOR[difficulty]);
}

export function updateLearningState(previous: LearningState | undefined, attempt: LearningAttempt): LearningState {
  const attempts = (previous?.attempts ?? 0) + 1;
  const correct = (previous?.correct ?? 0) + (attempt.correct ? 1 : 0);
  const incorrect = attempts - correct;
  const streak = attempt.correct ? (previous?.streak ?? 0) + 1 : 0;
  const priorFrequencyTotal = (previous?.averageFrequencyError ?? 0) * (attempts - 1);
  const averageFrequencyError = (priorFrequencyTotal + attempt.frequencyError) / attempts;
  const calibrationValue = attempt.correct
    ? 1 - Math.abs(attempt.confidence / 5 - 1)
    : 1 - attempt.confidence / 5;
  const priorCalibrationTotal = (previous?.confidenceCalibration ?? .5) * (attempts - 1);
  const confidenceCalibration = (priorCalibrationTotal + calibrationValue) / attempts;
  const knownEvAttempts = (previous?.averageEvLoss === null || previous?.averageEvLoss === undefined) ? 0 : attempts - 1;
  const averageEvLoss = attempt.evLoss === null
    ? previous?.averageEvLoss ?? null
    : (((previous?.averageEvLoss ?? 0) * knownEvAttempts) + attempt.evLoss) / (knownEvAttempts + 1);
  const knowledgeState = classifyKnowledge(attempt.correct, attempt.confidence, attempts);
  const base = {
    attempts,
    correct,
    averageFrequencyError,
    confidenceCalibration,
    streak,
    lastSeen: attempt.timestamp,
  };
  const mastery = computeMastery(base, attempt.timestamp);
  const interval = nextIntervalDays(attempts, streak, attempt.correct, attempt.confidence, attempt.difficulty, knowledgeState);
  return {
    key: learningKey(attempt.nodeId, attempt.hand),
    nodeId: attempt.nodeId,
    hand: attempt.hand,
    attempts,
    correct,
    incorrect,
    streak,
    lastSeen: attempt.timestamp,
    nextReview: attempt.timestamp + interval * DAY,
    mastery,
    confidenceCalibration,
    averageEvLoss,
    averageFrequencyError,
    knowledgeState,
  };
}

export function duePriority(state: LearningState, now = Date.now()) {
  const overdueDays = Math.max(0, now - state.nextReview) / DAY;
  const misconception = state.knowledgeState === "misconception" ? 45 : 0;
  const weakness = 100 - state.mastery;
  const error = Math.min(35, state.averageFrequencyError);
  const ev = state.averageEvLoss === null ? 0 : Math.min(30, state.averageEvLoss * 40);
  return overdueDays * 4 + misconception + weakness * .45 + error * .35 + ev;
}

export function buildReviewQueue(states: LearningState[], now = Date.now(), limit = 20) {
  return states
    .filter((state) => state.nextReview <= now || state.knowledgeState === "misconception")
    .sort((a, b) => duePriority(b, now) - duePriority(a, now))
    .slice(0, limit);
}

function strategyDistance(left: StrategyAction[], right: StrategyAction[]) {
  const actions = new Set([...left, ...right].map((item) => item.action));
  let distance = 0;
  actions.forEach((action) => {
    const a = left.find((item) => item.action === action)?.frequency ?? 0;
    const b = right.find((item) => item.action === action)?.frequency ?? 0;
    distance += Math.abs(a - b);
  });
  return distance / 2;
}

export function boundaryCandidates(node: StrategyNode, limit = 40, history: HandRecord[] = []): BoundaryCandidate[] {
  return Object.entries(node.strategyByHand)
    .map(([hand, strategy]) => {
      const neighbors = nearbyHands(hand).filter((item) => node.strategyByHand[item]);
      const primary = dominantAction(strategy);
      const mixedBonus = isMixedStrategy(strategy) ? 35 : 0;
      const edgeBonus = Math.max(0, 35 - Math.abs(primary.frequency - 50) * .45);
      const neighborDistance = neighbors.length
        ? Math.max(...neighbors.map((item) => strategyDistance(strategy, node.strategyByHand[item])))
        : 0;
      const actionSwitches = neighbors.filter((item) => dominantAction(node.strategyByHand[item]).action !== primary.action).length;
      const attempts = history.filter((record) => record.nodeId === node.id && record.notation === hand);
      const historicalError = attempts.length ? attempts.filter((record) => !record.correct).length / attempts.length * 28 : 0;
      const confidentMistakes = attempts.filter((record) => !record.correct && record.confidence >= 4).length * 9;
      const features = handFeatures(hand);
      const importance = features.pair ? 8 : features.broadway ? 7 : features.ace && features.suited ? 6 : features.connector ? 4 : 1;
      const evs = strategy.map((item) => item.ev).filter((value): value is number => value !== null);
      const evGap = evs.length > 1 ? Math.min(20, (Math.max(...evs) - Math.min(...evs)) * 30) : 0;
      const score = Math.round((mixedBonus + edgeBonus + neighborDistance * .6 + actionSwitches * 12 + historicalError + confidentMistakes + importance + evGap) * 10) / 10;
      const reason = confidentMistakes
        ? "Erro histórico com confiança alta"
        : actionSwitches
          ? "A ação dominante muda nas mãos vizinhas"
          : isMixedStrategy(strategy)
            ? "Duas ou mais ações compõem esta fronteira"
            : "A frequência muda perto da fronteira";
      return { hand, score, reason, strategy };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function stackBand(stack: number) {
  if (stack <= 15) return "8–15bb";
  if (stack <= 25) return "17–25bb";
  if (stack <= 50) return "30–50bb";
  return "60–100bb";
}

function groupKey(record: HandRecord) {
  return [record.scenario, record.hero, stackBand(record.stack), handFeatures(record.notation).family].join("|");
}

export function detectLeaks(records: HandRecord[], minimumAttempts = 4): LeakInsight[] {
  const groups = new Map<string, HandRecord[]>();
  records.forEach((record) => {
    const key = groupKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  });
  return [...groups.entries()].flatMap(([key, items]) => {
    if (items.length < minimumAttempts) return [];
    const [scenario, hero, band, handClass] = key.split("|");
    const accuracy = items.filter((item) => item.correct).length / items.length * 100;
    const frequencyError = items.reduce((sum, item) => sum + item.frequencyError, 0) / items.length;
    const knownEv = items.filter((item) => item.loss !== null);
    const evLoss = knownEv.length ? knownEv.reduce((sum, item) => sum + (item.loss ?? 0), 0) : null;
    const misconceptions = items.filter((item) => item.knowledgeState === "misconception").length;
    const leakScore = (100 - accuracy) * .55 + frequencyError * .75 + misconceptions * 8 + (evLoss ?? 0) * 25;
    if (leakScore < 22) return [];
    const selected = items.map((item) => item.selected);
    const dominantSelected = selected.sort((a, b) => selected.filter((x) => x === a).length - selected.filter((x) => x === b).length).at(-1) as ActionKey;
    const recommendation = frequencyError >= 18 ? "mixed" : items.some((item) => item.strategy.some((action) => action.frequency > 10 && action.frequency < 90)) ? "boundary" : "decision";
    return [{
      id: key,
      severity: leakScore >= 55 ? "major" : leakScore >= 36 ? "moderate" : "watch",
      confidence: items.length >= 12 && accuracy < 55 ? "confirmed" : items.length >= 7 ? "likely" : "possible",
      title: `${hero} · ${scenario} · ${band}`,
      description: `${handClass}: baixa precisão ao escolher ${ACTIONS[dominantSelected]?.label ?? "a ação"}. Revise a região do range, não apenas uma mão.`,
      scenario: scenario as ScenarioKey,
      hero,
      stackBand: band,
      handClass,
      attempts: items.length,
      accuracy: Math.round(accuracy),
      frequencyError: Math.round(frequencyError * 10) / 10,
      evLoss,
      recommendedMode: recommendation,
    } satisfies LeakInsight];
  }).sort((a, b) => {
    const rank = { major: 3, moderate: 2, watch: 1 };
    return rank[b.severity] - rank[a.severity] || b.frequencyError - a.frequencyError;
  });
}

function aggregateMastery(records: HandRecord[], now: number) {
  if (!records.length) return 0;
  const correct = records.filter((record) => record.correct).length;
  const frequencyError = records.reduce((sum, record) => sum + record.frequencyError, 0) / records.length;
  const confidenceCalibration = records.reduce((sum, record) => {
    const value = record.correct ? 1 - Math.abs(record.confidence / 5 - 1) : 1 - record.confidence / 5;
    return sum + value;
  }, 0) / records.length;
  let streak = 0;
  for (const record of [...records].sort((a, b) => b.timestamp - a.timestamp)) {
    if (!record.correct) break;
    streak += 1;
  }
  const trust = records.some((record) => record.provenance.trustLevel === "verified") ? "verified" : records.some((record) => record.provenance.trustLevel === "curated") ? "curated" : records.some((record) => record.provenance.trustLevel === "experimental") ? "experimental" : "modeled";
  return computeMastery({
    attempts: records.length,
    correct,
    averageFrequencyError: frequencyError,
    confidenceCalibration,
    streak,
    lastSeen: Math.max(...records.map((record) => record.timestamp)),
    strategyTrust: trust,
  }, now);
}

export function masteryEvidence(attempts: number, mastery: number): MasteryNode["evidence"] {
  if (attempts < 5) return "insufficient";
  if (mastery < 45) return "learning";
  if (mastery < 65) return "competent";
  if (mastery < 82 || attempts < 15) return "strong";
  return "mastered";
}

export function buildMasteryTree(records: HandRecord[], now = Date.now()): MasteryNode {
  const scenarioKeys = [...new Set(records.map((record) => record.scenario))];
  const children = scenarioKeys.map((scenario) => {
    const scenarioRecords = records.filter((record) => record.scenario === scenario);
    const matchups = [...new Set(scenarioRecords.map((record) => `${record.hero} vs ${record.villain ?? "field"}`))];
    return {
      key: scenario,
      label: scenario,
      mastery: aggregateMastery(scenarioRecords, now),
      attempts: scenarioRecords.length,
      evidence: masteryEvidence(scenarioRecords.length, aggregateMastery(scenarioRecords, now)),
      children: matchups.map((matchup) => {
        const matchupRecords = scenarioRecords.filter((record) => `${record.hero} vs ${record.villain ?? "field"}` === matchup);
        return {
          key: scenario + ":" + matchup,
          label: matchup,
          mastery: aggregateMastery(matchupRecords, now),
          attempts: matchupRecords.length,
          evidence: masteryEvidence(matchupRecords.length, aggregateMastery(matchupRecords, now)),
          children: [...new Set(matchupRecords.map((record) => stackBand(record.stack)))].map((band) => {
            const bandRecords = matchupRecords.filter((record) => stackBand(record.stack) === band);
            const score = aggregateMastery(bandRecords, now);
            return { key: scenario + ":" + matchup + ":" + band, label: band, mastery: score, attempts: bandRecords.length, evidence: masteryEvidence(bandRecords.length, score) };
          }),
        };
      }),
    };
  });
  const rootMastery = aggregateMastery(records, now);
  const datasetLabel = records.some((record) => record.provenance.trustLevel === "verified") ? "Mastery — dataset verified" : records.some((record) => record.provenance.trustLevel === "curated") ? "Mastery — Preflop Lab Reference" : "Mastery — Preflop Lab Modeled Strategy";
  return { key: "preflop", label: datasetLabel, datasetLabel, mastery: rootMastery, attempts: records.length, evidence: masteryEvidence(records.length, rootMastery), children };
}

export function createSessionReport(records: HandRecord[]): SessionReport {
  if (!records.length) return { decisions: 0, accuracy: 0, frequencyMae: 0, evLoss: null, strongest: null, weakest: null, misconceptions: 0, recommendation: "Comece com uma sessão curta de Decision Trainer." };
  const grouped = new Map<ScenarioKey, HandRecord[]>();
  records.forEach((record) => grouped.set(record.scenario, [...(grouped.get(record.scenario) ?? []), record]));
  const ordered = [...grouped.entries()].map(([key, items]) => ({ key, score: items.filter((item) => item.correct).length / items.length })).sort((a, b) => b.score - a.score);
  const knownEv = records.filter((record) => record.loss !== null);
  const misconceptions = records.filter((record) => record.knowledgeState === "misconception").length;
  const leaks = detectLeaks(records, 2);
  return {
    decisions: records.length,
    accuracy: Math.round(records.filter((record) => record.correct).length / records.length * 100),
    frequencyMae: Math.round(records.reduce((sum, record) => sum + record.frequencyError, 0) / records.length * 10) / 10,
    evLoss: knownEv.length ? knownEv.reduce((sum, record) => sum + (record.loss ?? 0), 0) : null,
    strongest: ordered[0]?.key ?? null,
    weakest: ordered.at(-1)?.key ?? null,
    misconceptions,
    recommendation: leaks[0] ? `Treine o leak: ${leaks[0].title}` : "Pratique fronteiras e estratégias mistas para consolidar o range.",
  };
}


export type TodayTrainingItem = {
  id: string;
  category: "due_review" | "misconception" | "confirmed_leak" | "boundary" | "mixed" | "recent" | "maintenance";
  record: HandRecord;
  priority: number;
};

export function buildTodayTraining(records: HandRecord[], limit = 30, now = Date.now()): TodayTrainingItem[] {
  if (!records.length) return [];
  const leaks = detectLeaks(records).filter((leak) => leak.confidence === "confirmed");
  const leakKeys = new Set(leaks.map((leak) => leak.id));
  const unique = new Map<string, HandRecord>();
  [...records].sort((a, b) => b.timestamp - a.timestamp).forEach((record) => {
    const key = record.nodeId + "::" + record.notation;
    if (!unique.has(key)) unique.set(key, record);
  });
  const candidates = [...unique.values()].map((record) => {
    const key = groupKey(record);
    const mixed = record.strategy.filter((action) => action.frequency >= 5).length > 1;
    const category: TodayTrainingItem["category"] = record.knowledgeState === "misconception"
      ? "misconception"
      : leakKeys.has(key)
        ? "confirmed_leak"
        : record.marked || !record.correct
          ? "due_review"
          : mixed
            ? "mixed"
            : dominantAction(record.strategy).frequency < 80
              ? "boundary"
              : now - record.timestamp < 7 * DAY
                ? "recent"
                : "maintenance";
    const rank = { misconception: 100, confirmed_leak: 90, due_review: 80, boundary: 65, mixed: 60, recent: 40, maintenance: 20 }[category];
    return { id: record.nodeId + "::" + record.notation, category, record, priority: rank + record.confidence * (!record.correct ? 4 : 0) + record.frequencyError * .25 };
  }).sort((a, b) => b.priority - a.priority);
  const selected: TodayTrainingItem[] = [];
  const pending = [...candidates];
  while (pending.length && selected.length < limit) {
    const recent = selected.slice(-3);
    let index = pending.findIndex((candidate) => recent.every((item) =>
      item.record.hero !== candidate.record.hero
      || stackBand(item.record.stack) !== stackBand(candidate.record.stack)
      || handFeatures(item.record.notation).family !== handFeatures(candidate.record.notation).family
      || item.record.nodeId !== candidate.record.nodeId));
    if (index < 0) index = 0;
    selected.push(pending.splice(index, 1)[0]);
  }
  return selected;
}

export function adjacentReinforcementHands(hand: string) {
  return [...new Set([hand, ...nearbyHands(hand)])].slice(0, 7);
}
