import { HOLDEM_RANKS, type SolverCard } from "./cards";

export type HandCategory =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-of-a-kind"
  | "straight-flush";

export type HandRank = {
  category: HandCategory;
  categoryValue: number;
  kickers: number[];
  score: number;
};

const CATEGORIES: HandCategory[] = [
  "high-card",
  "pair",
  "two-pair",
  "three-of-a-kind",
  "straight",
  "flush",
  "full-house",
  "four-of-a-kind",
  "straight-flush",
];

function value(card: SolverCard) {
  return HOLDEM_RANKS.indexOf(card.rank) + 2;
}

function straightHigh(values: number[]) {
  const unique = [...new Set(values)].sort((left, right) => right - left);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    if (unique.slice(index, index + 5).every((rank, offset) => rank === unique[index] - offset)) {
      return unique[index];
    }
  }
  return null;
}

function rankFive(cards: SolverCard[]): HandRank {
  if (cards.length !== 5 || new Set(cards.map((card) => card.id)).size !== 5) {
    throw new Error("Five-card evaluation requires five unique cards.");
  }
  const values = cards.map(value).sort((left, right) => right - left);
  const counts = new Map<number, number>();
  values.forEach((rank) => counts.set(rank, (counts.get(rank) ?? 0) + 1));
  const groups = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0]);
  const flush = new Set(cards.map((card) => card.suit)).size === 1;
  const straight = straightHigh(values);
  let categoryValue: number;
  let kickers: number[];
  if (flush && straight !== null) {
    categoryValue = 8;
    kickers = [straight];
  } else if (groups[0][1] === 4) {
    categoryValue = 7;
    kickers = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    categoryValue = 6;
    kickers = [groups[0][0], groups[1][0]];
  } else if (flush) {
    categoryValue = 5;
    kickers = values;
  } else if (straight !== null) {
    categoryValue = 4;
    kickers = [straight];
  } else if (groups[0][1] === 3) {
    categoryValue = 3;
    kickers = [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = groups.filter(([, count]) => count === 2).map(([rank]) => rank).sort((a, b) => b - a);
    const kicker = groups.find(([, count]) => count === 1)![0];
    categoryValue = 2;
    kickers = [...pairs, kicker];
  } else if (groups[0][1] === 2) {
    categoryValue = 1;
    kickers = [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)];
  } else {
    categoryValue = 0;
    kickers = values;
  }
  const score = [categoryValue, ...kickers].reduce((result, item) => result * 15 + item, 0);
  return { category: CATEGORIES[categoryValue], categoryValue, kickers, score };
}

function combinations<T>(values: T[], choose: number, start = 0, prefix: T[] = [], result: T[][] = []) {
  if (prefix.length === choose) {
    result.push([...prefix]);
    return result;
  }
  for (let index = start; index <= values.length - (choose - prefix.length); index += 1) {
    prefix.push(values[index]);
    combinations(values, choose, index + 1, prefix, result);
    prefix.pop();
  }
  return result;
}

export function compareHandRanks(left: HandRank, right: HandRank) {
  if (left.categoryValue !== right.categoryValue) return Math.sign(left.categoryValue - right.categoryValue);
  const length = Math.max(left.kickers.length, right.kickers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.kickers[index] ?? 0) - (right.kickers[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function evaluateHoldemHand(cards: SolverCard[]): HandRank {
  if (cards.length < 5 || cards.length > 7 || new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error("Hold'em evaluation requires five to seven unique cards.");
  }
  return combinations(cards, 5)
    .map(rankFive)
    .reduce((best, candidate) => compareHandRanks(candidate, best) > 0 ? candidate : best);
}

export function compareHoldemHands(left: SolverCard[], right: SolverCard[]) {
  return compareHandRanks(evaluateHoldemHand(left), evaluateHoldemHand(right));
}
