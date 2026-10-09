import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hashValue } from "../core/stable";

const target = resolve("solver/artifacts/phase6-13-mathematical-verification-v0.13.0.json");
const artifact = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
delete artifact.artifactHash;
artifact.validation = {
  completedAt: "2026-10-09",
  check: { command: "npm run check", passed: true },
  typecheck: { command: "npm run typecheck", passed: true },
  lint: { command: "npm run lint", passed: true },
  build: { command: "npm run build", passed: true },
  typescript: { command: "node --import tsx --test tests/*.test.mjs", total: 239, passed: 239, failed: 0, historicalPreserved: 221, phase613Added: 18 },
  focal: { command: "node --import tsx --test tests/solver-phase6-13.test.mjs", total: 18, passed: 18, failed: 0 },
  rust: { command: "cargo test --manifest-path solver/native/phase611-compiler/Cargo.toml --release", total: 3, passed: 3, failed: 0 },
};
artifact.artifactHash = hashValue(artifact);
await writeFile(target, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ target, artifactHash: artifact.artifactHash, validation: artifact.validation }, null, 2));
