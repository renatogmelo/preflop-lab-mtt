import {
  ACTIONS,
  POSITIONS,
  SCENARIOS,
  lookupStrategy,
  round,
  scenarioIsCompatible,
  strategy,
  type ActionEvent,
  type ActionKey,
  type Position,
  type RoundResolution,
  type ScenarioKey,
  type SeatState,
  type Spot,
  type StrategyAction,
} from "./engine";

import { dealTable, handNotation } from "./core/hands";
export { handNotation } from "./core/hands";

function pick<T>(items: T[]): T {
  if (!items.length) throw new Error("Cannot pick from an empty collection.");
  return items[Math.floor(Math.random() * items.length)];
}

function sampleAction(items: StrategyAction[]) {
  let roll = Math.random() * 100;
  for (const item of items) {
    roll -= item.frequency;
    if (roll <= 0) return item.action;
  }
  return items[items.length - 1].action;
}

function actionFrequency(items: StrategyAction[], actions: ActionKey[]) {
  return items.filter((item) => actions.includes(item.action)).reduce((sum, item) => sum + item.frequency, 0);
}

function range(from: number, to: number) {
  return POSITIONS.slice(Math.max(0, from), Math.max(0, to));
}

function buildFormation(stack: number, scenario: ScenarioKey, hero: Position, villain?: Position, caller?: Position): SeatState[] {
  for (let attempt = 0; attempt < 7000; attempt += 1) {
    const table = dealTable();
    const actions: Partial<Record<Position, ActionKey>> = {};
    const strict = attempt < 3500;
    const hand = (position: Position) => handNotation(table[position]);

    const requireOne = (position: Position, items: StrategyAction[], accepted: ActionKey[], recorded?: ActionKey) => {
      if (actionFrequency(items, accepted) <= 0) return false;
      const sampled = strict ? sampleAction(items) : accepted.find((action) => actionFrequency(items, [action]) > 0) as ActionKey;
      if (!accepted.includes(sampled)) return false;
      actions[position] = recorded ?? sampled;
      return true;
    };

    const rfiFold = (position: Position) => requireOne(position, strategy(hand(position), "rfi", position, stack), ["fold"]);
    const vsOpenFold = (position: Position, opener: Position) => {
      const node: ScenarioKey = position === "BB" ? "bb-defense" : "vs-open";
      return requireOne(position, strategy(hand(position), node, position, stack, opener), ["fold"]);
    };
    const vsJamFold = (position: Position, jammer: Position) =>
      requireOne(position, strategy(hand(position), "vs-jam", position, stack, jammer), ["fold"]);
     let valid = true;

    if (scenario === "rfi" || scenario === "bvb") {
      for (const position of range(0, POSITIONS.indexOf(hero))) {
        if (!rfiFold(position)) { valid = false; break; }
      }
    }

    if ((scenario === "vs-open" || scenario === "bb-defense") && villain) {
      const vi = POSITIONS.indexOf(villain);
      for (const position of range(0, vi)) {
        if (!rfiFold(position)) { valid = false; break; }
      }
      if (valid && !requireOne(villain, strategy(hand(villain), "rfi", villain, stack), ["raise"])) valid = false;
      if (valid) {
        for (const position of range(vi + 1, POSITIONS.indexOf(hero))) {
          if (!vsOpenFold(position, villain)) { valid = false; break; }
        }
      }
    }

    if (scenario === "vs-3bet" && villain) {
      const hi = POSITIONS.indexOf(hero);
      const vi = POSITIONS.indexOf(villain);
      for (const position of range(0, hi)) {
        if (!rfiFold(position)) { valid = false; break; }
      }
      if (valid && !requireOne(hero, strategy(hand(hero), "rfi", hero, stack), ["raise"])) valid = false;
      if (valid) {
        for (const position of range(hi + 1, vi)) {
          if (!vsOpenFold(position, hero)) { valid = false; break; }
        }
      }
      if (valid && !requireOne(villain, strategy(hand(villain), "vs-open", villain, stack, hero), ["threebet"])) valid = false;
      if (valid) {
        for (const position of range(vi + 1, POSITIONS.length)) {
          if (!vsOpenFold(position, hero)) { valid = false; break; }
        }
      }
    }

    if (scenario === "squeeze" && villain && caller) {
      const vi = POSITIONS.indexOf(villain);
      const ci = POSITIONS.indexOf(caller);
      const hi = POSITIONS.indexOf(hero);
      for (const position of range(0, vi)) {
        if (!rfiFold(position)) { valid = false; break; }
      }
      if (valid && !requireOne(villain, strategy(hand(villain), "rfi", villain, stack), ["raise"])) valid = false;
      if (valid) {
        for (const position of range(vi + 1, ci)) {
          if (!vsOpenFold(position, villain)) { valid = false; break; }
        }
      }
      if (valid && !requireOne(caller, strategy(hand(caller), "vs-open", caller, stack, villain), ["call"])) valid = false;
      if (valid) {
        for (const position of range(ci + 1, hi)) {
          if (!vsOpenFold(position, villain)) { valid = false; break; }
        }
      }
    }

    if (scenario === "vs-jam" && villain) {
      const vi = POSITIONS.indexOf(villain);
      const hi = POSITIONS.indexOf(hero);
      for (const position of range(0, vi)) {
        if (!rfiFold(position)) { valid = false; break; }
      }
      if (valid && !requireOne(villain, strategy(hand(villain), "rfi", villain, stack), ["jam"])) valid = false;
      if (valid) {
        for (const position of range(vi + 1, hi)) {
          if (!vsJamFold(position, villain)) { valid = false; break; }
        }
      }
    }

    if (valid) {
      return POSITIONS.map((position) => ({
        position,
        cards: table[position],
        notation: hand(position),
        actionBeforeHero: actions[position],
      }));
    }
  }
  throw new Error("Não foi possível montar uma formação válida.");
}

function postedBlind(position?: Position) {
  return position === "SB" ? .5 : position === "BB" ? 1 : 0;
}

export function makeSpot(stack: number, scenarioFilter: ScenarioKey | "Todos", heroFilter: Position | "Todos"): Spot {
  const choices = (Object.keys(SCENARIOS) as ScenarioKey[]).filter((item) => scenarioIsCompatible(item, heroFilter, stack));
  let scenario = scenarioFilter === "Todos" ? pick(choices) : scenarioFilter;
  if (!scenarioIsCompatible(scenario, heroFilter, stack)) scenario = heroFilter === "BB" ? "bb-defense" : "rfi";

  let hero: Position;
  if (heroFilter !== "Todos") hero = heroFilter;
  else if (scenario === "bb-defense") hero = "BB";
  else if (scenario === "bvb") hero = "SB";
  else if (scenario === "rfi" || scenario === "vs-3bet") hero = pick(POSITIONS.slice(0, 7));
  else if (scenario === "squeeze") hero = pick(POSITIONS.slice(2));
  else hero = pick(POSITIONS.slice(1));

  const heroIndex = POSITIONS.indexOf(hero);
  let villain: Position | undefined;
  let caller: Position | undefined;

  if (scenario === "bvb") villain = "BB";
  else if (scenario === "vs-3bet") villain = pick(POSITIONS.slice(heroIndex + 1));
  else if (scenario === "squeeze") {
    const before = POSITIONS.slice(0, heroIndex);
    const openerIndex = Math.floor(Math.random() * (before.length - 1));
    villain = before[openerIndex];
    caller = pick(before.slice(openerIndex + 1));
  } else if (scenario === "vs-jam") {
    const candidates = POSITIONS.slice(0, heroIndex).filter((position) => !(stack > 15 && position === "SB"));
    villain = pick(candidates);
  } else if (scenario !== "rfi") {
    villain = scenario === "bb-defense" ? pick(POSITIONS.slice(0, 6)) : pick(POSITIONS.slice(0, heroIndex));
  }

  const seats = buildFormation(stack, scenario, hero, villain, caller);
  const heroSeat = seats.find((seat) => seat.position === hero) as SeatState;
  const openSize = stack <= 25 ? 2 : stack <= 40 ? 2.1 : 2.2;
  const oop = villain === "SB" || villain === "BB";
  const threeBetSize = stack <= 25 ? (oop ? 6 : 5.2) : (oop ? 8 : 6.8);
  const history: string[] = [];
  let pot = 2.5;
  const firstAction = (position: Position) => position === "UTG" ? "UTG é o primeiro a agir" : "Fold até " + position;

  if (scenario === "rfi" || scenario === "bvb") history.push(firstAction(hero));
  if (scenario === "vs-open" || scenario === "bb-defense") {
    const villainIndex = POSITIONS.indexOf(villain as Position);
    history.push(firstAction(villain as Position), villain + " raise " + openSize + "bb");
    if (heroIndex > villainIndex + 1) history.push("Fold até " + hero);
    pot += openSize - postedBlind(villain);
  }
  if (scenario === "vs-3bet") {
    const villainIndex = POSITIONS.indexOf(villain as Position);
    history.push(firstAction(hero), hero + " raise " + openSize + "bb");
    if (villainIndex > heroIndex + 1) history.push("Fold até " + villain);
    history.push(villain + " 3-bet " + threeBetSize + "bb");
    if (villainIndex < POSITIONS.length - 1) history.push("Demais jogadores fold; ação retorna a " + hero);
    pot += openSize - postedBlind(hero) + threeBetSize - postedBlind(villain);
  }
  if (scenario === "squeeze") {
    const villainIndex = POSITIONS.indexOf(villain as Position);
    const callerIndex = POSITIONS.indexOf(caller as Position);
    history.push(firstAction(villain as Position), villain + " raise " + openSize + "bb");
    if (callerIndex > villainIndex + 1) history.push("Fold até " + caller);
    history.push(caller + " call " + openSize + "bb");
    if (heroIndex > callerIndex + 1) history.push("Fold até " + hero);
    pot += openSize - postedBlind(villain) + openSize - postedBlind(caller);
  }
  if (scenario === "vs-jam") {
    const villainIndex = POSITIONS.indexOf(villain as Position);
    history.push(firstAction(villain as Position), villain + " all-in " + stack + "bb");
    if (heroIndex > villainIndex + 1) history.push("Fold até " + hero);
    pot += stack - postedBlind(villain);
  }

  const lookup = lookupStrategy(heroSeat.notation, scenario, hero, stack, villain, caller);
  if (lookup.status === "unavailable") throw new Error(lookup.reason);

  return {
    id: Math.random().toString(36).slice(2),
    cards: heroSeat.cards,
    notation: heroSeat.notation,
    hero,
    villain,
    caller,
    scenario,
    stack,
    history,
    pot: round(pot, 1),
    strategy: lookup.strategy,
    seats,
    nodeId: lookup.node.id,
    datasetId: lookup.node.datasetId,
    provenance: lookup.node.provenance,
  };
}

function seatFor(spot: Spot, position: Position) {
  return spot.seats?.find((seat) => seat.position === position);
}

function actionText(position: Position, action: ActionKey) {
  return position + " " + ACTIONS[action].label.toLowerCase();
}

function decideOpponent(spot: Spot, position: Position, node: ScenarioKey, villain?: Position, caller?: Position) {
  const seat = seatFor(spot, position);
  if (!seat) return "fold" as ActionKey;
  return sampleAction(strategy(seat.notation, node, position, spot.stack, villain, caller));
}

export function resolveRound(spot: Spot, selected: ActionKey): RoundResolution {
  const events: ActionEvent[] = [];
  const heroIndex = POSITIONS.indexOf(spot.hero);
  const unacted = POSITIONS.slice(heroIndex + 1).filter((position) => !seatFor(spot, position)?.actionBeforeHero);
  const aggressive = ["raise", "threebet", "fourbet", "jam"].includes(selected);

  const add = (position: Position, action: ActionKey, text?: string) => {
    events.push({ position, action, text: text ?? actionText(position, action) });
  };

  if (spot.scenario === "rfi" || spot.scenario === "bvb") {
    if (selected === "fold") {
      let opener: Position | undefined;
      for (const position of unacted) {
        if (!opener && position === "BB") {
          add("BB", "call", "BB recebe o walk");
          break;
        }
        const node: ScenarioKey = opener ? (position === "BB" ? "bb-defense" : "vs-open") : "rfi";
        const action = decideOpponent(spot, position, node, opener);
        add(position, action);
        if (!opener && (action === "raise" || action === "jam")) opener = position;
        if (action === "threebet" || action === "jam" || action === "fourbet") break;
      }
    } else if (selected === "limp") {
      const response = decideOpponent(spot, "BB", "bb-defense", "SB");
      add("BB", response === "call" ? "call" : response, response === "call" ? "BB check" : undefined);
    } else {
      for (const position of unacted) {
        const node: ScenarioKey = selected === "jam" ? "vs-jam" : position === "BB" ? "bb-defense" : "vs-open";
        const response = decideOpponent(spot, position, node, spot.hero);
        add(position, response);
        if (["threebet", "fourbet", "jam"].includes(response) || (selected === "jam" && response === "call")) break;
      }
    }
  } else {
    for (const position of unacted) {
      let node: ScenarioKey;
      if (selected === "jam" || spot.scenario === "vs-jam") node = "vs-jam";
      else if (aggressive) node = spot.scenario === "squeeze" ? "vs-3bet" : "squeeze";
      else node = position === "BB" ? "bb-defense" : "vs-open";
      const response = decideOpponent(spot, position, node, aggressive ? spot.hero : spot.villain, spot.caller);
      add(position, response);
      if (response !== "fold") break;
    }
    if (aggressive && spot.villain && !events.some((event) => event.position === spot.villain)) {
      const node: ScenarioKey = selected === "jam" ? "vs-jam" : "vs-3bet";
      add(spot.villain, decideOpponent(spot, spot.villain, node, spot.hero));
    }
  }

  const active = events.filter((event) => event.action !== "fold");
  return {
    events,
    summary: active.length
      ? "A mesa respondeu usando apenas as cartas e o range de cada assento."
      : "Os adversários restantes abandonaram; todas as cartas foram reveladas para estudo.",
  };
}
