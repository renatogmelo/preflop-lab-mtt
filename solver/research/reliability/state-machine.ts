import { ReliabilityError } from "./errors";

export const RUN_STATES = [
  "CREATED",
  "PREFLIGHT",
  "READY",
  "RUNNING",
  "CHECKPOINTING",
  "INTERRUPTED",
  "RECOVERABLE",
  "RESUMING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type RunState = (typeof RUN_STATES)[number];

const transitions: Readonly<Record<RunState, readonly RunState[]>> = {
  CREATED: ["PREFLIGHT", "CANCELLED", "FAILED"],
  PREFLIGHT: ["READY", "FAILED", "CANCELLED"],
  READY: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: ["CHECKPOINTING", "INTERRUPTED", "COMPLETED", "FAILED", "CANCELLED"],
  CHECKPOINTING: ["RUNNING", "INTERRUPTED", "FAILED", "CANCELLED"],
  INTERRUPTED: ["RECOVERABLE", "FAILED", "CANCELLED"],
  RECOVERABLE: ["RESUMING", "FAILED", "CANCELLED"],
  RESUMING: ["RUNNING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export type RunTransition = {
  sequence: number;
  runId: string;
  from: RunState | null;
  to: RunState;
  at: string;
  reason: string;
};

export function canTransition(from: RunState, to: RunState) {
  return transitions[from].includes(to);
}

export function transitionRun(
  runId: string,
  current: RunState,
  to: RunState,
  history: readonly RunTransition[],
  reason: string,
  at = new Date().toISOString(),
): RunTransition {
  if (!canTransition(current, to)) {
    throw new ReliabilityError(
      "INVALID_TRANSITION",
      `Run ${runId} cannot transition from ${current} to ${to}.`,
      { runId, from: current, to },
    );
  }
  return { sequence: history.length, runId, from: current, to, at, reason };
}

export function initialTransition(runId: string, at = new Date().toISOString()): RunTransition {
  return { sequence: 0, runId, from: null, to: "CREATED", at, reason: "run-created" };
}
