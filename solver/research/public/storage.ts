import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { hashValue, stableStringify } from "../../core/stable";
import type { ResearchResultV1 } from "./contracts";
import { ResearchEngineError } from "./errors";

export async function pathExists(path: string) {
  try { await access(path); return true; } catch { return false; }
}

export async function resolveWorkspacePath(root: string, candidate: string, label: string) {
  if (isAbsolute(candidate)) throw new ResearchEngineError("INVALID_CONFIGURATION", `${label} must be relative.`, { candidate });
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, candidate);
  const relation = relative(resolvedRoot, target);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new ResearchEngineError("INVALID_CONFIGURATION", `${label} escapes the engine workspace.`, { candidate });
  }
  let cursor = resolvedRoot;
  for (const segment of relation.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (await pathExists(cursor) && (await lstat(cursor)).isSymbolicLink()) {
      throw new ResearchEngineError("INVALID_CONFIGURATION", `${label} crosses a symbolic link.`, { candidate, segment });
    }
  }
  return target;
}

export async function writeJsonFile(path: string, value: unknown) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${stableStringify(value)}\n`, { encoding: "utf8", flag: "w" });
}

export async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new ResearchEngineError("ARTIFACT_ERROR", "JSON file could not be read or parsed.", { path }, false, { cause: error });
  }
}

export function sealResearchResult(result: Omit<ResearchResultV1, "artifactChecksum">): ResearchResultV1 {
  return Object.freeze({ ...result, artifactChecksum: hashValue(result) });
}

export function verifyResearchResult(value: unknown): ResearchResultV1 {
  if (!value || typeof value !== "object") throw new ResearchEngineError("ARTIFACT_ERROR", "Artifact is not an object.");
  const artifact = value as ResearchResultV1;
  const { artifactChecksum, ...unsigned } = artifact;
  if (!artifactChecksum || hashValue(unsigned) !== artifactChecksum) throw new ResearchEngineError("ARTIFACT_ERROR", "Artifact checksum mismatch.");
  if (artifact.completion?.status !== "completed") throw new ResearchEngineError("ARTIFACT_ERROR", "Incomplete results cannot be verified as completed artifacts.");
  return artifact;
}

export function sha256Bytes(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}
