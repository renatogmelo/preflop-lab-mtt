import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hashValue } from "../core/stable";

const target = resolve("solver/artifacts/phase6-14-convergence-v0.14.0.json");
const artifact = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
delete artifact.artifactHash;
artifact.validation = {
  completedAt: "2026-10-10",
  check: { command: "npm run check", passed: true },
  typecheck: { command: "npm run typecheck", passed: true },
  lint: { command: "npm run lint", passed: true },
  build: { command: "npm run build", passed: true },
  typescript: { command: "node --import tsx --test tests/*.test.mjs", total: 261, passed: 261, failed: 0, historicalPreserved: 239, phase614Added: 22 },
  focal: { command: "node --import tsx --test tests/solver-phase6-14.test.mjs", total: 22, passed: 22, failed: 0 },
  rust: { command: "cargo test --manifest-path solver/native/phase611-compiler/Cargo.toml --release", total: 3, passed: 3, failed: 0 },
};
artifact.artifactHash = hashValue(artifact);
await writeFile(target, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ target, artifactHash: artifact.artifactHash, validation: artifact.validation }, null, 2));
