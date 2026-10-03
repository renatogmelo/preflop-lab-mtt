export type SolverPosition = "UTG" | "UTG+1" | "LJ" | "HJ" | "CO" | "BTN" | "SB" | "BB";

export type SolverPlayerDefinition = {
  id: string;
  position: SolverPosition;
  startingStack: number;
};

export type BettingAbstraction = {
  openRaiseTo: number[];
  threeBetTo: number[];
  fourBetTo: number[];
  jamAllowed: boolean;
  maximumRaisesPerRound?: number;
};

export type GameDefinition = {
  id: string;
  game: "NLHE" | "Kuhn" | "Leduc";
  format: string;
  utilityModel: "chipev" | "equity-approximation" | "solved-continuation";
  players: SolverPlayerDefinition[];
  smallBlind: number;
  bigBlind: number;
  antePerPlayer: number;
  bigBlindAnte: number;
  abstraction: BettingAbstraction;
};

export function validateGameDefinition(definition: GameDefinition) {
  const issues: string[] = [];
  if (!definition.id) issues.push("Game definition id is required.");
  if (definition.players.length < 2) issues.push("At least two players are required.");
  if (new Set(definition.players.map((player) => player.id)).size !== definition.players.length) issues.push("Player ids must be unique.");
  if (new Set(definition.players.map((player) => player.position)).size !== definition.players.length) issues.push("Player positions must be unique.");
  if (definition.players.some((player) => !Number.isFinite(player.startingStack) || player.startingStack <= 0)) issues.push("Starting stacks must be positive finite numbers.");
  if (!(definition.smallBlind > 0 && definition.bigBlind > definition.smallBlind)) issues.push("Blinds are invalid.");
  if (definition.antePerPlayer < 0 || definition.bigBlindAnte < 0) issues.push("Antes cannot be negative.");
  return { valid: issues.length === 0, issues };
}

export function mtt8MaxDefinition(stack: number): GameDefinition {
  const positions: SolverPosition[] = ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
  return {
    id: `nlhe-mtt-8max-${stack}bb-chipev`,
    game: "NLHE",
    format: "MTT 8-max",
    utilityModel: "chipev",
    players: positions.map((position) => ({ id: position, position, startingStack: stack })),
    smallBlind: 0.5,
    bigBlind: 1,
    antePerPlayer: 0,
    bigBlindAnte: 1,
    abstraction: {
      openRaiseTo: [stack <= 25 ? 2 : stack <= 40 ? 2.1 : 2.2],
      threeBetTo: [stack <= 25 ? 6 : 8],
      fourBetTo: [stack <= 25 ? stack : 18],
      jamAllowed: true,
      maximumRaisesPerRound: 4,
    },
  };
}
