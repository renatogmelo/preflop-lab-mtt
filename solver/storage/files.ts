import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SolverCheckpoint } from "../core/types";
import type { HoldemPocCheckpoint } from "../game/holdem-poc";

export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function readJson<T>(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function saveCheckpoint(path: string, checkpoint: SolverCheckpoint | HoldemPocCheckpoint) {
  await writeJson(path, checkpoint);
}
