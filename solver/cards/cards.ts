export const HOLDEM_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const HOLDEM_SUITS = ["c", "d", "h", "s"] as const;

export type HoldemRank = typeof HOLDEM_RANKS[number];
export type HoldemSuit = typeof HOLDEM_SUITS[number];

export type SolverCard = {
  id: number;
  rank: HoldemRank;
  suit: HoldemSuit;
  notation: string;
};

export type HoleCombo = {
  id: string;
  first: SolverCard;
  second: SolverCard;
  notation: string;
  canonical: string;
};

export function createHoldemDeck(): SolverCard[] {
  return HOLDEM_RANKS.flatMap((rank, rankIndex) => HOLDEM_SUITS.map((suit, suitIndex) => ({
    id: rankIndex * HOLDEM_SUITS.length + suitIndex,
    rank,
    suit,
    notation: rank + suit,
  })));
}

function rankIndex(card: SolverCard) {
  return HOLDEM_RANKS.indexOf(card.rank);
}

export function canonicalHand(first: SolverCard, second: SolverCard) {
  if (first.id === second.id) throw new Error("A hole-card combo cannot contain the same card twice.");
  const ordered = rankIndex(first) >= rankIndex(second) ? [first, second] : [second, first];
  if (ordered[0].rank === ordered[1].rank) return ordered[0].rank + ordered[1].rank;
  return ordered[0].rank + ordered[1].rank + (ordered[0].suit === ordered[1].suit ? "s" : "o");
}

export function createCombo(first: SolverCard, second: SolverCard): HoleCombo {
  if (first.id === second.id) throw new Error("Card collision inside hole-card combo.");
  const ordered = first.id < second.id ? [first, second] : [second, first];
  return {
    id: `${ordered[0].id}-${ordered[1].id}`,
    first: ordered[0],
    second: ordered[1],
    notation: ordered[0].notation + ordered[1].notation,
    canonical: canonicalHand(ordered[0], ordered[1]),
  };
}

export function enumerateHoleCombos(deck = createHoldemDeck()) {
  const combos: HoleCombo[] = [];
  for (let first = 0; first < deck.length; first += 1) {
    for (let second = first + 1; second < deck.length; second += 1) {
      combos.push(createCombo(deck[first], deck[second]));
    }
  }
  return combos;
}

export function combosCollide(left: HoleCombo, right: HoleCombo) {
  return left.first.id === right.first.id
    || left.first.id === right.second.id
    || left.second.id === right.first.id
    || left.second.id === right.second.id;
}

export function canonicalClassCounts(combos = enumerateHoleCombos()) {
  const counts = new Map<string, number>();
  combos.forEach((combo) => counts.set(combo.canonical, (counts.get(combo.canonical) ?? 0) + 1));
  return counts;
}

export function comboStrength(combo: HoleCombo) {
  const high = Math.max(rankIndex(combo.first), rankIndex(combo.second)) + 2;
  const low = Math.min(rankIndex(combo.first), rankIndex(combo.second)) + 2;
  const pair = combo.first.rank === combo.second.rank;
  const suited = combo.first.suit === combo.second.suit;
  const gap = high - low;
  let score = high / 14 * 0.42 + low / 14 * 0.18;
  if (pair) score += 0.25 + high / 14 * 0.15;
  if (suited && !pair) score += 0.06;
  if (!pair && gap === 1) score += 0.055;
  else if (!pair && gap === 2) score += 0.025;
  if (high >= 10 && low >= 10) score += 0.05;
  if (high === 14 && low <= 5) score += 0.025;
  return Math.max(0, Math.min(1, score));
}
