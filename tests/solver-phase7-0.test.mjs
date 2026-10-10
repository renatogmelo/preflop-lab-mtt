import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  CAPABILITY_IDS,
  EVENT_SCHEMA_VERSION,
  EXPERIMENT_SCHEMA_VERSION,
  PROVIDER_CONTRACT_V3,
  PUBLIC_API_VERSION,
  RESEARCH_ENGINE_VERSION,
  createBuiltinProvider,
  createResearchEngine,
  createResearchSdk,
  validateExperimentConfiguration,
  validateProviderContract,
} from "../solver/research/public/index.ts";

const execFileAsync = promisify(execFile);
const temporary = async (prefix, body) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try { return await body(directory); } finally { await rm(directory, { recursive: true, force: true }); }
};

function configuration(overrides = {}) {
  const base = {
    schemaVersion: EXPERIMENT_SCHEMA_VERSION,
    experimentId: `phase7-${Math.random().toString(16).slice(2)}`,
    provider: { id: "variable-depth-hidden" },
    algorithm: { id: "dcfr", seed: 7000, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } },
    budget: { iterations: 6, runtimeMs: 10_000, memoryBytes: 256 * 1024 * 1024, tier: "tier0" },
    evaluation: { interval: 2, exact: true },
    checkpoint: { interval: 3, retain: 2 },
    outputDirectory: "runs",
    validation: { structural: true, independentEvaluation: true },
  };
  return { ...base, ...overrides };
}

test("Phase 7.0 exposes a versioned stable capability contract without multiplayer or poker certification", () => {
  const capabilities = createResearchEngine().getCapabilities();
  assert.equal(RESEARCH_ENGINE_VERSION, "1.0.0");
  assert.equal(capabilities.apiVersion, PUBLIC_API_VERSION);
  assert.deepEqual(capabilities.capabilities, CAPABILITY_IDS);
  assert.equal(capabilities.scope.players, 2);
  assert.equal(capabilities.scope.multiplayer, false);
  assert.equal(capabilities.scope.pokerStrategiesCertified, false);
  assert.deepEqual(capabilities.algorithms.map((entry) => entry.id), ["vanilla-cfr", "cfr-plus", "dcfr"]);
});

test("Phase 7.0 Provider V3 preserves V2 prototype methods and validates stable identity", () => {
  const provider = createBuiltinProvider({ id: "variable-depth-hidden" });
  assert.equal(provider.contractVersion, PROVIDER_CONTRACT_V3);
  assert.equal(typeof provider.initialState, "function");
  assert.equal(provider.stateKey(provider.initialState()), "h:root");
  const validation = validateProviderContract(provider);
  assert.equal(validation.valid, true);
  assert.equal(validation.adapterCompatibility, "provider-contract-v2.0.0");
});

test("Phase 7.0 runtime schema rejects traversal, absolute outputs and impossible states", () => {
  assert.throws(() => validateExperimentConfiguration({ ...configuration(), outputDirectory: "../escape" }), (error) => error.code === "INVALID_CONFIGURATION");
  assert.throws(() => validateExperimentConfiguration({ ...configuration(), outputDirectory: resolve("escape") }), (error) => error.code === "INVALID_CONFIGURATION");
  assert.throws(() => validateExperimentConfiguration({ ...configuration(), algorithm: { id: "invalid", seed: 1 } }), (error) => error.code === "INVALID_CONFIGURATION");
  assert.throws(() => validateExperimentConfiguration({ ...configuration(), budget: { ...configuration().budget, memoryBytes: 1 } }), (error) => error.code === "INVALID_CONFIGURATION");
});

test("Phase 7.0 validation executes structural and independent mathematical checks", () => {
  const report = createResearchEngine().validateGame(configuration());
  assert.equal(report.valid, true);
  assert.equal(report.structure.perfectRecall, true);
  assert.equal(report.structure.chanceMaximumError, 0);
  assert.equal(report.structure.maximumZeroSumError, 0);
  assert.equal(report.independentEvaluation.performed, true);
  assert.equal(report.independentEvaluation.maximumDelta, 0);
});

test("Phase 7.0 compiler negotiation selects Generic V3 and Fast V2 from capabilities", () => {
  const engine = createResearchEngine();
  assert.equal(engine.compileGame(configuration()).compiler.id, "compiler-v3");
  const regular = configuration({
    provider: { id: "regular-synthetic", parameters: { id: "regular-test", privateStates: 2, publicSignals: 2, stages: 1, actionsPerDecision: 2, seed: 7 } },
    validation: { structural: true, independentEvaluation: false },
  });
  assert.equal(engine.compileGame(regular).compiler.id, "compiler-v2");
});

test("Phase 7.0 Resource Policy rejects incompatible large Tier 0 requests before materialization", () => {
  const large = configuration({
    provider: { id: "regular-synthetic", parameters: { id: "too-large", privateStates: 4, publicSignals: 3, stages: 6, actionsPerDecision: 3, seed: 7 } },
    budget: { iterations: 1, runtimeMs: 30_000, memoryBytes: 768 * 1024 * 1024, tier: "tier0" },
    evaluation: { interval: 1, exact: true },
    checkpoint: { interval: 1, retain: 2 },
  });
  assert.throws(() => createResearchEngine().compileGame(large), (error) => error.code === "RESOURCE_LIMIT");
});

test("Phase 7.0 end-to-end workflow persists events, Checkpoint V5 and a verified complete artifact", async () => temporary("phase70-e2e-", async (workspaceRoot) => {
  const engine = createResearchEngine({ workspaceRoot, buildCommit: "test-commit" });
  const handle = await engine.createExperiment(configuration());
  const events = [];
  const completed = await engine.runExperiment(handle, { onProgress: (event) => events.push(event) });
  assert.equal(completed.status.state, "completed");
  assert.equal(completed.result.schemaVersion, "research-result-v1");
  assert.equal(completed.result.engineVersion, "1.0.0");
  assert.equal(completed.result.validation.level, "structurally-validated");
  assert.equal(completed.result.validation.pokerCertified, false);
  assert.equal(completed.result.checkpoints.length, 2);
  assert.ok(events.some((event) => event.type === "RUN_STARTED"));
  assert.ok(events.some((event) => event.type === "CHECKPOINT_CREATED"));
  assert.ok(events.every((event) => event.schemaVersion === EVENT_SCHEMA_VERSION));
  const status = await engine.getExperimentStatus(handle.runId);
  assert.equal(status.state, "completed");
  const result = await engine.getExperimentResults(handle.runId);
  assert.equal(result.artifactChecksum, completed.result.artifactChecksum);
  const verified = await engine.verifyArtifact(`runs/${handle.runId}/result.json`);
  assert.equal(verified.valid, true);
  const eventLines = (await readFile(join(workspaceRoot, "runs", handle.runId, "events.ndjson"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(eventLines[0].type, "EXPERIMENT_CREATED");
  assert.equal(eventLines.at(-1).type, "RUN_COMPLETED");
}));

test("Phase 7.0 SDK returns discriminated results and preserves structured errors", async () => temporary("phase70-sdk-", async (workspaceRoot) => {
  const sdk = createResearchSdk({ workspaceRoot });
  const valid = await sdk.validate(configuration());
  assert.equal(valid.ok, true);
  const invalid = await sdk.validate({ nope: true });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "INVALID_CONFIGURATION");
  const run = await sdk.run(configuration({ experimentId: "sdk-run" }));
  assert.equal(run.ok, true);
  assert.equal(run.value.status.state, "completed");
}));

test("Phase 7.0 incompatible or corrupted Checkpoint V5 fails closed during resume", async () => temporary("phase70-checkpoint-", async (workspaceRoot) => {
  const engine = createResearchEngine({ workspaceRoot });
  const handle = await engine.createExperiment(configuration({ experimentId: "corrupt-resume" }));
  const completed = await engine.runExperiment(handle);
  const latest = completed.result.checkpoints.at(-1).file;
  const checkpoint = join(workspaceRoot, "runs", handle.runId, latest);
  const bytes = await readFile(checkpoint);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(checkpoint, bytes);
  await assert.rejects(engine.resumeExperiment(handle.runId), (error) => ["EXECUTION_ERROR", "CHECKPOINT_ERROR"].includes(error.code));
}));

test("Phase 7.0 controlled cancellation crosses the process boundary", async () => temporary("phase70-cancel-", async (workspaceRoot) => {
  const engine = createResearchEngine({ workspaceRoot });
  const config = configuration({
    experimentId: "cancelled-run",
    provider: { id: "regular-synthetic", parameters: { id: "cancel-game", privateStates: 4, publicSignals: 2, stages: 4, actionsPerDecision: 2, seed: 70 } },
    budget: { iterations: 20, runtimeMs: 30_000, memoryBytes: 512 * 1024 * 1024, tier: "tier0" },
    evaluation: { interval: 10, exact: true },
    checkpoint: { interval: 10, retain: 2 },
    validation: { structural: true, independentEvaluation: false },
  });
  const handle = await engine.createExperiment(config);
  const running = engine.runExperiment(handle);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await engine.getExperimentStatus(handle.runId);
    if (["preflight", "ready", "running"].includes(status.state)) { await engine.cancelExperiment(handle.runId); break; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  const result = await running;
  assert.equal(result.status.state, "cancelled");
  assert.equal(result.result, null);
}));

test("Phase 7.0 CLI exposes the declared commands and machine-readable info", async () => {
  const entry = resolve("solver/research/cli.ts");
  const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", entry, "info"], { cwd: process.cwd(), windowsHide: true });
  const info = JSON.parse(stdout);
  assert.equal(info.engineVersion, "1.0.0");
  assert.deepEqual(info.algorithms.map((entry) => entry.id), ["vanilla-cfr", "cfr-plus", "dcfr"]);
  const help = JSON.parse((await execFileAsync(process.execPath, ["--import", "tsx", entry, "help"], { cwd: process.cwd(), windowsHide: true })).stdout);
  assert.deepEqual(Object.keys(help.commands), ["info", "capabilities", "validate", "compile", "run", "status", "cancel", "resume", "checkpoint", "results", "verify", "doctor"]);
});

test("Phase 7.0 all ten working examples execute automatically", async () => temporary("phase70-examples-", async (workspaceRoot) => {
  const { runWorkingExamples } = await import("../examples/research-engine/index.ts");
  const result = await runWorkingExamples(workspaceRoot);
  assert.equal(result.validation.ok, true);
  assert.equal(result.compilation.ok, true);
  assert.equal(result.runs.length, 3);
  assert.ok(result.runs.every((run) => run.ok));
  assert.equal(result.metrics.ok, true);
  assert.equal(result.checkpoint.ok, true);
  assert.equal(result.resumed.ok, true);
  assert.equal(result.comparison.length, 3);
  assert.equal(result.verification.ok, true);
}));
test("Phase 7.0 release manifest validates versions, exports and deterministic package checksum", async () => {
  const { buildPhase70ReleaseArtifact, verifyPhase70ReleaseArtifact } = await import("../solver/research/release.ts");
  const first = await buildPhase70ReleaseArtifact({ write: false, typescriptTests: 301, rustTests: 3 });
  const second = await buildPhase70ReleaseArtifact({ write: false, typescriptTests: 301, rustTests: 3 });
  assert.equal(verifyPhase70ReleaseArtifact(first), true);
  assert.equal(first.build.packageChecksum, second.build.packageChecksum);
  assert.equal(first.releaseVersion, "1.0.0");
  assert.ok(Object.values(first.gates).every((gate) => gate === "PASS"));
});
test("Phase 7.0 package exports only the stable Research Engine surface", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.bin["preflop-research"], "./solver/research/cli.ts");
  assert.equal(manifest.exports["./research"], "./solver/research/public/index.ts");
});

test("Phase 7.0 doctor validates runtime, write access, capabilities and resource configuration", async () => temporary("phase70-doctor-", async (workspaceRoot) => {
  const report = await createResearchEngine({ workspaceRoot }).doctor();
  assert.equal(report.checks.nodeVersion.passed, true);
  assert.equal(report.checks.workspaceWritable.passed, true);
  assert.equal(report.checks.capabilities.passed, true);
  assert.equal(report.destructiveChangesPerformed, false);
}));
