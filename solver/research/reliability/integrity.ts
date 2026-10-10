import type { CompactCfrSolver } from "../compact/compact-cfr";
import { deserializeStructuralCacheV2, type StructuralCacheIdentityV2 } from "../generic/structural-cache-v2";
import { deserializeBinaryCheckpointV5, restoreBinaryCheckpointV5 } from "../resource-safe/binary-checkpoint-v5";
import { ReliabilityError } from "./errors";

function checkpointCode(message: string) {
  return /version|algorithm|configuration|another game|structural representation/i.test(message)
    ? "CHECKPOINT_INCOMPATIBLE" as const
    : "CHECKPOINT_CORRUPTED" as const;
}

export function decodeCheckpointReliably(buffer: Buffer) {
  try {
    return deserializeBinaryCheckpointV5(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReliabilityError(checkpointCode(message), message, { bytes: buffer.length }, error instanceof Error ? { cause: error } : undefined);
  }
}

export function restoreCheckpointReliably(solver: CompactCfrSolver, buffer: Buffer) {
  const checkpoint = decodeCheckpointReliably(buffer);
  try {
    restoreBinaryCheckpointV5(solver, checkpoint);
    return checkpoint;
  } catch (error) {
    throw new ReliabilityError(
      "CHECKPOINT_INCOMPATIBLE",
      error instanceof Error ? error.message : String(error),
      { iteration: checkpoint.iteration, semanticStateHash: checkpoint.semanticStateHash },
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}

export function decodeCacheReliably(buffer: Uint8Array, identity: StructuralCacheIdentityV2) {
  try {
    return deserializeStructuralCacheV2(buffer, identity, { mode: "safe-copy", trust: "persisted-local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /identity|version|schema/i.test(message) ? "CACHE_INCOMPATIBLE" : "CACHE_CORRUPTED";
    throw new ReliabilityError(code, message, { bytes: buffer.byteLength }, error instanceof Error ? { cause: error } : undefined);
  }
}
