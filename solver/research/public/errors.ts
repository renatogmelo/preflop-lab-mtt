import type { ResearchErrorCode, ResearchErrorShape } from "./contracts";

export class ResearchEngineError extends Error {
  readonly name = "ResearchEngineError";
  constructor(
    readonly code: ResearchErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    readonly recoverable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  toJSON(): ResearchErrorShape {
    return { name: this.name, code: this.code, message: this.message, details: this.details, recoverable: this.recoverable };
  }
}

export function asResearchError(error: unknown, fallback: ResearchErrorCode = "INTERNAL_ERROR", details: Readonly<Record<string, unknown>> = {}) {
  if (error instanceof ResearchEngineError) return error;
  return new ResearchEngineError(fallback, error instanceof Error ? error.message : String(error), details, false, error instanceof Error ? { cause: error } : undefined);
}

export async function captureResearchResult<T>(operation: () => T | Promise<T>) {
  try {
    return { ok: true as const, value: await operation() };
  } catch (error) {
    return { ok: false as const, error: asResearchError(error).toJSON() };
  }
}
