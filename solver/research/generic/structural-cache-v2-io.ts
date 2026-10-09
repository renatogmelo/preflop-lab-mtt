import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { CompactIndexedTree } from "../compact/compact-tree";
import {
  deserializeStructuralCacheV2,
  serializeStructuralCacheV2,
  type StructuralCacheIdentityV2,
} from "./structural-cache-v2";

export async function writeStructuralCacheV2Atomic(
  target: string,
  tree: CompactIndexedTree,
  identity: StructuralCacheIdentityV2,
  options: { simulateFailureAfterSync?: boolean } = {},
) {
  const serialized = serializeStructuralCacheV2(tree, identity);
  await mkdir(dirname(target), { recursive: true });
  try {
    const existing = await readFile(target);
    const loaded = deserializeStructuralCacheV2(existing, identity, { mode: "safe-copy", trust: "persisted-local" });
    return { written: false, fileBytes: existing.length, checksum: loaded.checksum, header: loaded.header };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Refusing to overwrite an existing incompatible Structural Cache V2 entry at ${target}.`, { cause: error });
    }
  }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(serialized.buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    if (options.simulateFailureAfterSync) throw new Error("Simulated Structural Cache V2 interruption after sync.");
    const reread = await readFile(temporary);
    deserializeStructuralCacheV2(reread, identity, { mode: "safe-copy", trust: "freshly-generated" });
    await rename(temporary, target);
    const persisted = await stat(target);
    return { written: true, fileBytes: persisted.size, checksum: serialized.checksum, header: serialized.header };
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}
