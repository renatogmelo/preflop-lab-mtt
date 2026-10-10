export const RELIABILITY_ERROR_CODES = [
  "CHECKPOINT_CORRUPTED",
  "CHECKPOINT_INCOMPATIBLE",
  "CHECKPOINT_NOT_FOUND",
  "CACHE_CORRUPTED",
  "CACHE_INCOMPATIBLE",
  "RESOURCE_LIMIT",
  "PROCESS_TERMINATED",
  "RECOVERY_FAILED",
  "CONCURRENT_WRITER",
  "MANIFEST_INVALID",
  "INVALID_TRANSITION",
  "ARTIFACT_INCOMPLETE",
] as const;

export type ReliabilityErrorCode = (typeof RELIABILITY_ERROR_CODES)[number];

export class ReliabilityError extends Error {
  readonly name = "ReliabilityError";

  constructor(
    readonly code: ReliabilityErrorCode,
    message: string,
    readonly context: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, context: this.context };
  }
}

export function asReliabilityError(
  error: unknown,
  fallbackCode: ReliabilityErrorCode,
  context: Readonly<Record<string, unknown>> = {},
) {
  if (error instanceof ReliabilityError) return error;
  return new ReliabilityError(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
    context,
    error instanceof Error ? { cause: error } : undefined,
  );
}
