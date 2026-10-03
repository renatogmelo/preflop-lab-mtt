import { validateGameDefinition, type GameDefinition } from "./definition";

export type BettingAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; raiseTo: number }
  | { type: "all-in" };

export type BettingPlayerState = {
  id: string;
  position: string;
  startingStack: number;
  stack: number;
  committed: number;
  deadCommitted: number;
  folded: boolean;
  allIn: boolean;
};

export type BettingEvent = {
  playerId: string;
  action: BettingAction["type"] | "small-blind" | "big-blind" | "ante" | "big-blind-ante";
  contributed: number;
  raiseTo?: number;
  fullRaise?: boolean;
};

export type BettingState = {
  definitionId: string;
  players: BettingPlayerState[];
  actingPlayerId: string | null;
  currentBet: number;
  minRaiseIncrement: number;
  pendingPlayerIds: string[];
  actedSinceFullRaise: string[];
  lastAggressorId: string | null;
  raises: number;
  pot: number;
  complete: boolean;
  history: BettingEvent[];
};

function round(value: number) {
  return Number(value.toFixed(6));
}

function playerIndex(state: BettingState, id: string) {
  const index = state.players.findIndex((player) => player.id === id);
  if (index < 0) throw new Error(`Unknown player ${id}.`);
  return index;
}

function activePlayers(state: BettingState) {
  return state.players.filter((player) => !player.folded);
}

function actionablePlayers(state: BettingState) {
  return state.players.filter((player) => !player.folded && !player.allIn);
}

function nextPendingPlayer(state: BettingState, afterId: string) {
  const start = playerIndex(state, afterId);
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidate = state.players[(start + offset) % state.players.length];
    if (state.pendingPlayerIds.includes(candidate.id) && !candidate.folded && !candidate.allIn) return candidate.id;
  }
  return null;
}

function contribute(player: BettingPlayerState, requested: number) {
  const amount = round(Math.min(player.stack, Math.max(0, requested)));
  player.stack = round(player.stack - amount);
  player.committed = round(player.committed + amount);
  if (player.stack <= 1e-9) {
    player.stack = 0;
    player.allIn = true;
  }
  return amount;
}

function postDead(player: BettingPlayerState, requested: number) {
  const amount = round(Math.min(player.stack, Math.max(0, requested)));
  player.stack = round(player.stack - amount);
  player.deadCommitted = round(player.deadCommitted + amount);
  if (player.stack <= 1e-9) {
    player.stack = 0;
    player.allIn = true;
  }
  return amount;
}

export function createPreflopBettingState(definition: GameDefinition): BettingState {
  const validation = validateGameDefinition(definition);
  if (!validation.valid) throw new Error(validation.issues.join(" "));
  const players = definition.players.map((player) => ({
    ...player,
    stack: player.startingStack,
    committed: 0,
    deadCommitted: 0,
    folded: false,
    allIn: false,
  }));
  const history: BettingEvent[] = [];
  let pot = 0;
  players.forEach((player) => {
    if (definition.antePerPlayer > 0) {
      const amount = postDead(player, definition.antePerPlayer);
      pot += amount;
      history.push({ playerId: player.id, action: "ante", contributed: amount });
    }
  });
  const smallBlind = players.find((player) => player.position === "SB");
  const bigBlind = players.find((player) => player.position === "BB");
  if (!smallBlind || !bigBlind) throw new Error("Game definition requires SB and BB positions.");
  if (definition.bigBlindAnte > 0) {
    const amount = postDead(bigBlind, definition.bigBlindAnte);
    pot += amount;
    history.push({ playerId: bigBlind.id, action: "big-blind-ante", contributed: amount });
  }
  const smallBlindAmount = contribute(smallBlind, definition.smallBlind);
  const bigBlindAmount = contribute(bigBlind, definition.bigBlind);
  pot += smallBlindAmount + bigBlindAmount;
  history.push({ playerId: smallBlind.id, action: "small-blind", contributed: smallBlindAmount });
  history.push({ playerId: bigBlind.id, action: "big-blind", contributed: bigBlindAmount });

  const pending = players.filter((player) => !player.allIn).map((player) => player.id);
  const firstToAct = players.length === 2
    ? smallBlind.id
    : nextPendingPlayer({ players, pendingPlayerIds: pending } as BettingState, bigBlind.id);
  return {
    definitionId: definition.id,
    players,
    actingPlayerId: firstToAct,
    currentBet: bigBlind.committed,
    minRaiseIncrement: definition.bigBlind,
    pendingPlayerIds: pending,
    actedSinceFullRaise: [],
    lastAggressorId: bigBlind.id,
    raises: 0,
    pot: round(pot),
    complete: activePlayers({ players } as BettingState).length <= 1 || firstToAct === null,
    history,
  };
}

export function amountToCall(state: BettingState, playerId = state.actingPlayerId) {
  if (!playerId) return 0;
  const player = state.players[playerIndex(state, playerId)];
  return round(Math.max(0, state.currentBet - player.committed));
}

export function effectiveLiveStack(state: BettingState, leftId: string, rightId: string) {
  const left = state.players[playerIndex(state, leftId)];
  const right = state.players[playerIndex(state, rightId)];
  return round(Math.min(left.committed + left.stack, right.committed + right.stack));
}

export function legalBettingActions(state: BettingState, raiseTargets: number[] = []) {
  if (state.complete || !state.actingPlayerId) return [];
  const player = state.players[playerIndex(state, state.actingPlayerId)];
  const toCall = amountToCall(state, player.id);
  const maxTarget = round(player.committed + player.stack);
  const canReopen = !state.actedSinceFullRaise.includes(player.id);
  const minimumRaiseTo = round(state.currentBet + state.minRaiseIncrement);
  const actions: BettingAction[] = [];
  if (toCall > 0) actions.push({ type: "fold" }, { type: "call" });
  else actions.push({ type: "check" });
  if (canReopen && maxTarget > state.currentBet) {
    raiseTargets
      .filter((target) => target >= minimumRaiseTo - 1e-9 && target < maxTarget - 1e-9)
      .forEach((raiseTo) => actions.push({ type: "raise", raiseTo }));
    actions.push({ type: "all-in" });
  } else if (toCall > 0 && player.stack <= toCall + 1e-9) {
    actions.push({ type: "all-in" });
  }
  return actions;
}

export function applyBettingAction(input: BettingState, action: BettingAction) {
  if (input.complete || !input.actingPlayerId) throw new Error("Betting round is already complete.");
  const state: BettingState = structuredClone(input);
  const actorId = state.actingPlayerId;
  if (!actorId) throw new Error("Betting state lost its acting player during cloning.");
  const player = state.players[playerIndex(state, actorId)];
  const legal = legalBettingActions(state, action.type === "raise" ? [action.raiseTo] : []);
  if (!legal.some((candidate) => candidate.type === action.type && (candidate.type !== "raise" || action.type !== "raise" || candidate.raiseTo === action.raiseTo))) {
    throw new Error(`Illegal ${action.type} action for ${actorId}.`);
  }

  const oldBet = state.currentBet;
  const toCall = amountToCall(state, actorId);
  let contributed = 0;
  let raisedTo: number | undefined;
  let fullRaise = false;
  if (action.type === "fold") player.folded = true;
  else if (action.type === "call") contributed = contribute(player, toCall);
  else if (action.type === "raise") {
    contributed = contribute(player, action.raiseTo - player.committed);
    raisedTo = player.committed;
  } else if (action.type === "all-in") {
    contributed = contribute(player, player.stack);
    raisedTo = player.committed > oldBet ? player.committed : undefined;
  }

  state.pot = round(state.pot + contributed);
  state.pendingPlayerIds = state.pendingPlayerIds.filter((id) => id !== actorId);
  if (raisedTo !== undefined && raisedTo > oldBet) {
    const increment = round(raisedTo - oldBet);
    fullRaise = increment + 1e-9 >= state.minRaiseIncrement;
    state.currentBet = raisedTo;
    state.lastAggressorId = actorId;
    state.raises += 1;
    if (fullRaise) {
      state.minRaiseIncrement = increment;
      state.actedSinceFullRaise = [];
    }
    state.pendingPlayerIds = actionablePlayers(state)
      .filter((candidate) => candidate.id !== actorId && candidate.committed < state.currentBet - 1e-9)
      .map((candidate) => candidate.id);
  }
  state.actedSinceFullRaise = [...new Set([...state.actedSinceFullRaise, actorId])];
  state.history.push({
    playerId: actorId,
    action: action.type,
    contributed,
    raiseTo: raisedTo,
    fullRaise: raisedTo === undefined ? undefined : fullRaise,
  });

  if (activePlayers(state).length <= 1 || state.pendingPlayerIds.length === 0) {
    state.complete = true;
    state.actingPlayerId = null;
  } else {
    state.actingPlayerId = nextPendingPlayer(state, actorId);
    if (!state.actingPlayerId) state.complete = true;
  }
  return state;
}

export function assertBettingState(state: BettingState) {
  const issues: string[] = [];
  if (state.players.some((player) => player.stack < -1e-9 || player.committed < -1e-9 || player.deadCommitted < -1e-9)) issues.push("Negative chips detected.");
  const accountedPot = state.players.reduce((sum, player) => sum + player.committed + player.deadCommitted, 0);
  if (Math.abs(accountedPot - state.pot) > 1e-6) issues.push("Pot does not equal committed chips.");
  if (state.currentBet + 1e-9 < Math.max(...state.players.map((player) => player.committed))) issues.push("Current bet is below a player commitment.");
  if (state.actingPlayerId && !state.pendingPlayerIds.includes(state.actingPlayerId)) issues.push("Acting player is not pending.");
  return { valid: issues.length === 0, issues };
}
