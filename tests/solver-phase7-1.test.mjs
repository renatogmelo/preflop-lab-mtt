import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createResearchConsoleServer } from "../solver/research/console/server.ts";
import { hashValue } from "../solver/core/stable.ts";

function configuration(experimentId, overrides = {}) {
  const base = {
    schemaVersion: "research-experiment-v1",
    experimentId,
    provider: { id: "variable-depth-hidden" },
    algorithm: { id: "dcfr", seed: 7100, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } },
    budget: { iterations: 6, runtimeMs: 10_000, memoryBytes: 256 * 1024 * 1024, tier: "tier0" },
    evaluation: { interval: 2, exact: true },
    checkpoint: { interval: 2, retain: 3 },
    outputDirectory: ".preflop-research/runs",
    validation: { structural: true, independentEvaluation: true },
  };
  return { ...base, ...overrides };
}

async function api(origin, path, options = {}) {
  const response = await fetch(`${origin}/api/research${path}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json", "x-preflop-console": "1" } : {}), ...options.headers },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, payload };
}

async function waitFor(origin, runId, predicate, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { payload } = await api(origin, `/experiments/${runId}`);
    if (payload.ok && predicate(payload.value)) return payload.value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${runId}`);
}

const workspace = await mkdtemp(join(tmpdir(), "preflop-console-"));
const consoleServer = createResearchConsoleServer({ workspaceRoot: workspace, port: 0, quiet: true });
const address = await consoleServer.listen();
const origin = `http://${address.host}:${address.port}`;

test.after(async () => {
  await consoleServer.close();
});

test("Research Console implements all primary navigation destinations", async () => {
  const source = await readFile("app/research/research-console.tsx", "utf8");
  for (const label of ["Overview", "Experiments", "New Experiment", "Algorithms", "Game Explorer", "Results", "Checkpoints", "Diagnostics", "Settings"]) assert.match(source, new RegExp(label));
  assert.match(source, /Research Console/);
});

test("console UI source contains accessibility, responsive and real-data contracts", async () => {
  const [source, css] = await Promise.all([readFile("app/research/research-console.tsx", "utf8"), readFile("app/research/research-console.css", "utf8")]);
  assert.match(source, /subscribeToRun/);
  assert.match(source, /researchApi\.validate/);
  assert.match(source, /researchApi\.exportUrl/);
  assert.match(source, /aria-label/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(source, /mockResult|fakeProgress|Math\.random\(\) \* 100/);
});

test("health, capabilities, overview and four real game validations are exposed", async () => {
  const health = await api(origin, "/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.value.engineVersion, "1.0.0");
  const capabilities = await api(origin, "/capabilities");
  assert.equal(capabilities.payload.value.scope.multiplayer, false);
  assert.equal(capabilities.payload.value.scope.pokerStrategiesCertified, false);
  const games = await api(origin, "/games");
  assert.deepEqual(new Set(games.payload.value.map((game) => game.selectionId)), new Set(["variable-depth-hidden", "asymmetric-chance", "irregular-branching", "regular-synthetic"]));
  assert.ok(games.payload.value.every((game) => game.validation.valid && game.nodes > 0));
  const overview = await api(origin, "/overview");
  assert.equal(overview.payload.value.totals.all, 0);
});

test("origin, CSRF, schema and Resource Policy guards fail closed", async () => {
  const forbiddenOrigin = await api(origin, "/health", { headers: { origin: "https://attacker.example" } });
  assert.equal(forbiddenOrigin.response.status, 403);
  const missingHeader = await fetch(`${origin}/api/research/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(missingHeader.status, 403);
  const invalid = await api(origin, "/validate", { method: "POST", body: JSON.stringify({}) });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.error.code, "INVALID_CONFIGURATION");
  const rejected = configuration("resource-rejected", { budget: { iterations: 21, runtimeMs: 10_000, memoryBytes: 256 * 1024 * 1024, tier: "tier0" } });
  const resource = await api(origin, "/validate", { method: "POST", body: JSON.stringify(rejected) });
  assert.equal(resource.payload.error.code, "RESOURCE_LIMIT");
});

test("complete E2E run persists ordered events, real convergence, exports and verified artifact", async () => {
  const id = `phase71-e2e-${Date.now()}`;
  const validated = await api(origin, "/validate", { method: "POST", body: JSON.stringify(configuration(id)) });
  assert.equal(validated.payload.ok, true);
  const created = await api(origin, "/experiments", { method: "POST", body: JSON.stringify(configuration(id)) });
  assert.equal(created.response.status, 201);
  const { runId } = created.payload.value;
  const accepted = await api(origin, `/experiments/${runId}/run`, { method: "POST", body: "{}" });
  assert.equal(accepted.response.status, 202);
  const detail = await waitFor(origin, runId, (value) => value.summary.state === "completed");
  assert.equal(detail.result.completion.status, "completed");
  assert.ok(detail.result.convergence.length >= 3);
  assert.ok(detail.result.convergence.every((point) => Number.isFinite(point.iteration)));
  assert.ok(detail.events.length >= 6);
  assert.deepEqual(detail.events.map((event) => event.sequence), [...detail.events.map((event) => event.sequence)].sort((a, b) => a - b));
  assert.ok(detail.checkpoints.length >= 1);
  const verified = await api(origin, `/experiments/${runId}/verify`, { method: "POST", body: "{}" });
  assert.equal(verified.payload.value.valid, true);
  const json = await api(origin, `/experiments/${runId}/export?format=json`);
  assert.match(json.response.headers.get("content-disposition"), new RegExp(`${runId}\\.json`));
  assert.equal(json.payload.artifactChecksum, detail.result.artifactChecksum);
  const csv = await api(origin, `/experiments/${runId}/export?format=csv`);
  assert.match(csv.payload, /artifactChecksum=/);
  assert.match(csv.payload, /iteration/);
  const stream = await fetch(`${origin}/api/research/experiments/${runId}/events`);
  const replay = await stream.text();
  assert.match(replay, /event: research/);
  assert.match(replay, /RUN_COMPLETED/);
});

test("experiment management search, status and persisted refresh reconstruction work", async () => {
  const listed = await api(origin, "/experiments?state=completed&search=phase71-e2e&page=1&pageSize=10");
  assert.equal(listed.payload.value.total, 1);
  const run = listed.payload.value.items[0];
  const refreshed = await api(origin, `/experiments/${run.runId}`);
  assert.equal(refreshed.payload.value.result.artifactChecksum.length, 16);
  assert.equal(refreshed.payload.value.summary.resultAvailable, true);
});

test("active run can be checkpointed, cancelled and resumed from an intact generation", async () => {
  const id = `phase71-recovery-${Date.now()}`;
  const recoveryConfiguration = configuration(id, {
    provider: { id: "regular-synthetic", parameters: { privateStates: 3, publicSignals: 2, stages: 4, actionsPerDecision: 3, seed: 7101 } },
    budget: { iterations: 20, runtimeMs: 30_000, memoryBytes: 768 * 1024 * 1024, tier: "tier0" },
    evaluation: { interval: 1, exact: true },
    checkpoint: { interval: 1, retain: 4 },
    validation: { structural: true, independentEvaluation: false },
  });
  const created = await api(origin, "/experiments", { method: "POST", body: JSON.stringify(recoveryConfiguration) });
  const { runId } = created.payload.value;
  await api(origin, `/experiments/${runId}/run`, { method: "POST", body: "{}" });
  const checkpointed = await waitFor(origin, runId, (value) => value.checkpoints.length > 0 && ["running", "cancelling"].includes(value.summary.state));
  assert.ok(checkpointed.checkpoints[0].sizeBytes > 0);
  const cancelled = await api(origin, `/experiments/${runId}/cancel`, { method: "POST", body: "{}" });
  assert.equal(cancelled.payload.ok, true);
  const stopped = await waitFor(origin, runId, (value) => value.summary.state === "cancelled");
  assert.ok(stopped.checkpoints.length > 0);
  const resumed = await api(origin, `/experiments/${runId}/resume`, { method: "POST", body: "{}" });
  assert.equal(resumed.response.status, 202);
  const completed = await waitFor(origin, runId, (value) => value.summary.state === "completed", 30_000);
  assert.equal(completed.result.completion.status, "completed");
  assert.ok(completed.events.some((event) => event.type === "RECOVERY_STARTED"));
  assert.ok(completed.result.checkpoints.length > 0);
});
test("Phase 7.1 release artifact is checksummed and preserves trust boundaries", async () => {
  const artifact = JSON.parse(await readFile("solver/artifacts/phase7-1-research-console-v1.0.0.json", "utf8"));
  const { artifactChecksum, ...unsigned } = artifact;
  assert.equal(hashValue(unsigned), artifactChecksum);
  assert.equal(artifact.validation.typescript.passed, 310);
  assert.equal(artifact.gates.U1, "PASS");
  assert.match(artifact.gates.U8, /^PARTIAL/);
  assert.equal(artifact.trustBoundary.gateD, "FAIL");
  assert.equal(artifact.trustBoundary.verifiedDatasets, 0);
  assert.equal(artifact.trustBoundary.pokerStrategiesChanged, false);
});
test("game tree endpoint is capped and never materializes unbounded UI data", async () => {
  const tree = await api(origin, "/games/variable-depth-hidden/tree?limit=20");
  assert.equal(tree.response.status, 200);
  assert.ok(tree.payload.value.nodes.length <= 20);
  assert.equal(tree.payload.value.nodes[0].parentId, null);
  assert.ok(tree.payload.value.nodes.some((node) => node.kind === "chance"));
});
