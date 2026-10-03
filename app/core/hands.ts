import { POSITIONS, RANKS, type Card, type Position } from "./domain";

export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export const MATRIX_RANKS = [...RANKS].reverse();

export type HandFeatures = {
  hand: string;
  high: number;
  low: number;
  pair: boolean;
  suited: boolean;
  offsuit: boolean;
  gap: number;
  ace: boolean;
  king: boolean;
  broadway: boolean;
  connector: boolean;
  gapper: boolean;
  wheelAce: boolean;
  combos: number;
  family: string;
};

export function allHandClasses() {
  const hands: string[] = [];
  MATRIX_RANKS.forEach((row, i) => MATRIX_RANKS.forEach((col, j) => {
    if (i === j) hands.push(row + col);
    else if (i < j) hands.push(row + col + "s");
    else hands.push(col + row + "o");
  }));
  return hands;
}

export const HAND_CLASSES = allHandClasses();
export const HAND_CLASS_SET = new Set(HAND_CLASSES);

export function isValidHandClass(hand: string) {
  return HAND_CLASS_SET.has(hand);
}

export function normalizeHand(hand: string) {
  const clean = hand.trim().toUpperCase().replace(/10/g, "T");
  const match = clean.match(/^([2-9TJQKA])([2-9TJQKA])([SO])?$/);
  if (!match) return null;
  const [, first, second, suffix] = match;
  if (first === second) return suffix ? null : first + second;
  if (!suffix) return null;
  const firstIndex = RANKS.indexOf(first);
  const secondIndex = RANKS.indexOf(second);
  const high = firstIndex > secondIndex ? first : second;
  const low = firstIndex > secondIndex ? second : first;
  return high + low + suffix.toLowerCase();
}

export function handNotation(cards: Card[]) {
  if (cards.length !== 2) throw new Error("Uma mão inicial precisa ter exatamente duas cartas.");
  const sorted = [...cards].sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank));
  if (sorted[0].rank === sorted[1].rank) return sorted[0].rank + sorted[1].rank;
  return sorted[0].rank + sorted[1].rank + (sorted[0].suit === sorted[1].suit ? "s" : "o");
}

export function handFeatures(hand: string): HandFeatures {
  const normalized = normalizeHand(hand);
  if (!normalized) throw new Error("Classe de mão inválida: " + hand);
  const high = RANKS.indexOf(normalized[0]) + 2;
  const low = RANKS.indexOf(normalized[1]) + 2;
  const pair = normalized.length === 2;
  const suited = normalized.endsWith("s");
  const gap = Math.abs(high - low);
  const ace = high === 14;
  const king = high === 13;
  const broadway = high >= 10 && low >= 10;
  const connector = !pair && gap === 1;
  const gapper = !pair && gap >= 2 && gap <= 3;
  const wheelAce = ace && low <= 5;
  const combos = pair ? 6 : suited ? 4 : 12;
  const family = pair ? "Pocket pair" : ace ? "Ax" : king ? "Kx" : broadway ? "Broadway" : connector ? "Connector" : gapper ? "Gapper" : suited ? "Suited" : "Offsuit";
  return { hand: normalized, high, low, pair, suited, offsuit: !pair && !suited, gap, ace, king, broadway, connector, gapper, wheelAce, combos, family };
}

export function createDeck(): Card[] {
  return RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
}

export function shuffleDeck(cards: Card[], random = Math.random) {
  const deck = cards.map((card) => ({ ...card }));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [deck[index], deck[target]] = [deck[target], deck[index]];
  }
  return deck;
}

export function dealTable(random = Math.random): Record<Position, Card[]> {
  const deck = shuffleDeck(createDeck(), random);
  const table = {} as Record<Position, Card[]>;
  POSITIONS.forEach((position) => {
    table[position] = [deck.pop() as Card, deck.pop() as Card];
  });
  return table;
}

export function cardsAreUnique(table: Record<Position, Card[]>) {
  const ids = POSITIONS.flatMap((position) => table[position].map((card) => card.rank + card.suit));
  return ids.length === new Set(ids).size;
}

export function nearbyHands(hand: string) {
  const feature = handFeatures(hand);
  if (feature.pair) {
    return MATRIX_RANKS.filter((rank) => Math.abs(RANKS.indexOf(rank) + 2 - feature.high) <= 2).map((rank) => rank + rank);
  }
  const suffix = feature.suited ? "s" : "o";
  return RANKS
    .map((rank) => feature.hand[0] + rank + suffix)
    .filter((candidate) => normalizeHand(candidate) && Math.abs((RANKS.indexOf(candidate[1]) + 2) - feature.low) <= 3)
    .map((candidate) => normalizeHand(candidate) as string);
}
