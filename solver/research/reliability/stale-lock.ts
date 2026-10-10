import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ReliabilityError } from "./errors";

export async function recoverStaleWriterLease(target: string) {
  const lockPath = `${target}.writer-lock`;
  let owner: { pid?: number; owner?: string };
  try {
    owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as { pid?: number; owner?: string };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { recovered: false, reason: "no-lock" as const };
    throw new ReliabilityError("CONCURRENT_WRITER", "Writer lock exists without a readable owner record.", { target, lockPath }, { cause: error });
  }
  if (!Number.isInteger(owner.pid)) throw new ReliabilityError("CONCURRENT_WRITER", "Writer lock owner PID is invalid.", { target, lockPath, owner });
  try {
    process.kill(owner.pid!, 0);
    throw new ReliabilityError("CONCURRENT_WRITER", "Writer process is still alive.", { target, lockPath, owner });
  } catch (error) {
    if (error instanceof ReliabilityError) throw error;
  }
  await rm(lockPath, { recursive: true, force: true });
  return { recovered: true, reason: "dead-owner" as const, owner };
}
