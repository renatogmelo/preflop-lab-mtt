#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ALGORITHM_DESCRIPTORS } from "./public/algorithms";
import { PUBLIC_API_VERSION, RESEARCH_ENGINE_VERSION } from "./public/contracts";
import { ResearchEngineError, asResearchError } from "./public/errors";
import { createResearchEngine } from "./public/engine";
import { STRUCTURAL_CACHE_V2_VERSION } from "./generic/structural-cache-v2";
import { STRUCTURAL_CACHE_VERSION } from "./fast-compiler/structural-cache-v1";
import { BINARY_CHECKPOINT_VERSION } from "./resource-safe/binary-checkpoint-v5";

type Parsed = { command: string; flags: Map<string, string | true> };

function parse(argv: string[]): Parsed {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new ResearchEngineError("INVALID_CONFIGURATION", `Unexpected positional argument ${token}.`);
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) { flags.set(key, next); index += 1; }
    else flags.set(key, true);
  }
  return { command, flags };
}

function required(flags: Map<string, string | true>, name: string) {
  const value = flags.get(name);
  if (typeof value !== "string" || !value) throw new ResearchEngineError("INVALID_CONFIGURATION", `--${name} is required.`);
  return value;
}

async function json(path: string) {
  try { return JSON.parse(await readFile(resolve(path), "utf8")) as unknown; }
  catch (error) { throw new ResearchEngineError("INVALID_CONFIGURATION", "Configuration file is not valid JSON.", { path }, false, { cause: error }); }
}

const usage = {
  name: "preflop-research",
  commands: {
    info: "Show engine, runtime, formats and limitations.",
    capabilities: "List negotiated capabilities.",
    validate: "Validate a synthetic game: --config <file>.",
    compile: "Compile and summarize a synthetic game: --config <file>.",
    run: "Create and execute an isolated experiment: --config <file>.",
    status: "Read persisted execution status: --run-id <id>.",
    cancel: "Request controlled cancellation: --run-id <id>.",
    resume: "Resume from the newest compatible Checkpoint V5: --run-id <id>.",
    checkpoint: "Request or inspect a checkpoint: --run-id <id>.",
    results: "Read and verify completed results: --run-id <id>.",
    verify: "Verify a result artifact: --artifact <workspace-relative-file>.",
    doctor: "Diagnose the local research environment without destructive changes.",
  },
};

async function main() {
  const parsed = parse(process.argv.slice(2));
  const engine = createResearchEngine();
  let output: unknown;
  if (parsed.command === "help" || parsed.flags.has("help")) output = usage;
  else if (parsed.command === "info") {
    output = {
      name: "Preflop Lab Research Engine",
      engineVersion: RESEARCH_ENGINE_VERSION,
      apiVersion: PUBLIC_API_VERSION,
      buildCommit: process.env.PREFLOP_RESEARCH_COMMIT ?? "unknown",
      runtime: { node: process.version, platform: process.platform, architecture: process.arch },
      algorithms: ALGORITHM_DESCRIPTORS,
      scope: engine.getCapabilities().scope,
      formats: { structuralCache: [STRUCTURAL_CACHE_VERSION, STRUCTURAL_CACHE_V2_VERSION], checkpoint: BINARY_CHECKPOINT_VERSION },
      limitations: ["Synthetic finite games only", "No multiplayer support", "No certified poker strategy", "Cross-OS reproducibility not established"],
    };
  } else if (parsed.command === "capabilities") output = engine.getCapabilities();
  else if (parsed.command === "validate") output = engine.validateGame(await json(required(parsed.flags, "config")));
  else if (parsed.command === "compile") output = engine.compileGame(await json(required(parsed.flags, "config")));
  else if (parsed.command === "run") {
    const handle = await engine.createExperiment(await json(required(parsed.flags, "config")));
    output = await engine.runExperiment(handle);
  } else if (parsed.command === "status") output = await engine.getExperimentStatus(required(parsed.flags, "run-id"));
  else if (parsed.command === "cancel") output = await engine.cancelExperiment(required(parsed.flags, "run-id"));
  else if (parsed.command === "resume") output = await engine.resumeExperiment(required(parsed.flags, "run-id"));
  else if (parsed.command === "checkpoint") output = await engine.checkpointExperiment(required(parsed.flags, "run-id"));
  else if (parsed.command === "results") output = await engine.getExperimentResults(required(parsed.flags, "run-id"));
  else if (parsed.command === "verify") output = await engine.verifyArtifact(required(parsed.flags, "artifact"));
  else if (parsed.command === "doctor") output = await engine.doctor();
  else throw new ResearchEngineError("INVALID_CONFIGURATION", `Unknown command ${parsed.command}.`, { commands: Object.keys(usage.commands) });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  const structured = asResearchError(error);
  process.stderr.write(`${JSON.stringify(structured.toJSON())}\n`);
  process.exitCode = structured.code === "INVALID_CONFIGURATION" ? 2 : 1;
});
