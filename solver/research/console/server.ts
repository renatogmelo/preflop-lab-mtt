import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createBuiltinProvider,
  createResearchSdk,
  type ExperimentHandle,
  type ResearchExperimentConfigurationV1,
  type ResearchOperationResult,
  type ResearchProgressEvent,
  type ResearchResultV1,
} from "../public/index";
import { asResearchError } from "../public/errors";
import type {
  ConsoleGame,
  ConsoleListResponse,
  ConsoleOverview,
  ConsoleRunDetails,
  ConsoleRunSummary,
  ConsoleTree,
  ConsoleTreeNode,
} from "./contracts";

const API_PREFIX = "/api/research";
const INDEX_SCHEMA = "research-run-index-v1";
const MAX_BODY_BYTES = 256 * 1024;
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "interrupted"]);

type StoredIndex = {
  schemaVersion: typeof INDEX_SCHEMA;
  experimentId: string;
  runId: string;
  runDirectory: string;
  configurationPath: string;
};

export type ResearchConsoleServerOptions = {
  workspaceRoot?: string;
  host?: string;
  port?: number;
  quiet?: boolean;
};

function isSafeId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(value);
}

function allowedOrigin(origin: string | undefined) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1") && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function cors(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (!allowedOrigin(origin)) return false;
  if (origin) response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-headers", "content-type, last-event-id, x-preflop-console");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("cache-control", "no-store");
  return true;
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value)}\n`);
}

function sendOperation<T>(response: ServerResponse, operation: ResearchOperationResult<T>, successStatus = 200) {
  if (operation.ok) sendJson(response, successStatus, operation);
  else sendJson(response, operation.error.code === "INVALID_CONFIGURATION" || operation.error.code === "VALIDATION_ERROR" ? 400 : 409, operation);
}

async function readBody(request: IncomingMessage) {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error("Request body exceeds 256 KiB.");
  let text = "";
  for await (const chunk of request) {
    text += chunk.toString("utf8");
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error("Request body exceeds 256 KiB.");
  }
  return text ? JSON.parse(text) as unknown : {};
}

function defaultConfiguration(providerId: ResearchExperimentConfigurationV1["provider"]["id"]): ResearchExperimentConfigurationV1 {
  return {
    schemaVersion: "research-experiment-v1",
    provider: { id: providerId },
    algorithm: { id: "dcfr", seed: 7000, dcfr: { alpha: 1.5, beta: 0, gamma: 2 } },
    budget: { iterations: 6, runtimeMs: 10_000, memoryBytes: 256 * 1024 * 1024, tier: "tier0" },
    evaluation: { interval: 2, exact: true },
    checkpoint: { interval: 3, retain: 2 },
    outputDirectory: ".preflop-research/runs",
    validation: { structural: true, independentEvaluation: true },
  };
}

function csvFromResult(result: ResearchResultV1) {
  const keys = [...new Set(result.convergence.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const provenance = [
    `# schemaVersion=${result.schemaVersion}`,
    `# engineVersion=${result.engineVersion}`,
    `# experimentId=${result.experimentId}`,
    `# runId=${result.runId}`,
    `# artifactChecksum=${result.artifactChecksum}`,
  ];
  return [...provenance, keys.join(","), ...result.convergence.map((row) => keys.map((key) => escape(row[key])).join(","))].join("\n") + "\n";
}

export function createResearchConsoleServer(options: ResearchConsoleServerOptions = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const engineDirectory = join(workspaceRoot, ".preflop-research");
  const sdk = createResearchSdk({ workspaceRoot });
  const active = new Map<string, Promise<void>>();
  let gamesCache: ConsoleGame[] | null = null;

  async function readIndex(runId: string): Promise<StoredIndex> {
    if (!isSafeId(runId)) throw new Error("Unsafe run id.");
    const value = JSON.parse(await readFile(join(engineDirectory, "index", `${runId}.json`), "utf8")) as StoredIndex;
    if (value.schemaVersion !== INDEX_SCHEMA || value.runId !== runId || !isSafeId(value.experimentId)) throw new Error("Run index is incompatible.");
    return value;
  }

  async function runDirectory(runId: string) {
    const index = await readIndex(runId);
    const target = resolve(workspaceRoot, index.runDirectory);
    const relation = relative(workspaceRoot, target);
    if (relation.startsWith("..") || relation === "") throw new Error("Run path escapes workspace.");
    return { index, target };
  }

  async function readEvents(directory: string) {
    try {
      return (await readFile(join(directory, "events.ndjson"), "utf8"))
        .split(/\r?\n/).filter(Boolean).flatMap((line) => {
          try { return [JSON.parse(line) as ResearchProgressEvent]; } catch { return []; }
        }).sort((left, right) => left.sequence - right.sequence);
    } catch {
      return [];
    }
  }

  async function details(runId: string): Promise<ConsoleRunDetails> {
    const { target } = await runDirectory(runId);
    const [configurationText, statusOperation, entries, events] = await Promise.all([
      readFile(join(target, "experiment.json"), "utf8"),
      sdk.status(runId),
      readdir(target, { withFileTypes: true }),
      readEvents(target),
    ]);
    if (!statusOperation.ok) throw Object.assign(new Error(statusOperation.error.message), { researchError: statusOperation.error });
    const configuration = JSON.parse(configurationText) as ResearchExperimentConfigurationV1;
    const resultOperation = await sdk.results(runId);
    const result = resultOperation.ok ? resultOperation.value : null;
    const checkpoints = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".plcpv5")).map(async (entry) => {
      const info = await stat(join(target, entry.name));
      const match = entry.name.match(/(\d+)(?=\.plcpv5$)/);
      return { file: entry.name, iteration: match ? Number(match[1]) : null, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() };
    }));
    const status = statusOperation.value;
    const completedIterations = result?.metrics.iterations ?? status.lastEvent?.iteration ?? 0;
    const summary: ConsoleRunSummary = {
      experimentId: status.experimentId,
      runId: status.runId,
      state: status.state,
      createdAt: status.createdAt,
      updatedAt: status.updatedAt,
      algorithm: configuration.algorithm.id,
      provider: configuration.provider.id,
      iterations: configuration.budget.iterations,
      completedIterations,
      progress: result ? 1 : status.lastEvent?.progress ?? 0,
      durationMs: result?.metrics.runtimeMs ?? null,
      resultAvailable: Boolean(result),
      checkpointCount: checkpoints.length,
      error: status.error,
    };
    return { summary, status, configuration, result, events, checkpoints: checkpoints.sort((a, b) => (b.iteration ?? 0) - (a.iteration ?? 0)) };
  }

  async function listRuns(): Promise<ConsoleRunDetails[]> {
    let files: string[] = [];
    try { files = (await readdir(join(engineDirectory, "index"))).filter((file) => file.endsWith(".json")); } catch { return []; }
    const settled = await Promise.allSettled(files.map((file) => details(basename(file, ".json"))));
    return settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []).sort((a, b) => b.summary.updatedAt.localeCompare(a.summary.updatedAt));
  }

  function startRun(handle: ExperimentHandle, resume = false) {
    if (active.has(handle.runId)) return false;
    const task = (async () => {
      const result = resume ? await sdk.resume(handle.runId) : await sdk.runExperiment(handle);
      if (!result.ok && !options.quiet) process.stderr.write(`[research-console] ${result.error.code}: ${result.error.message}\n`);
    })().finally(() => active.delete(handle.runId));
    active.set(handle.runId, task);
    return true;
  }

  async function games() {
    if (gamesCache) return gamesCache;
    const capabilities = sdk.capabilities();
    const items: ConsoleGame[] = [];
    for (const provider of capabilities.providers) {
      const selectionId = provider.id === "research-regular"
        ? "regular-synthetic"
        : provider.id.startsWith("variable-depth") ? "variable-depth-hidden"
        : provider.id.startsWith("asymmetric") ? "asymmetric-chance"
        : "irregular-branching";
      const configuration = defaultConfiguration(selectionId as ResearchExperimentConfigurationV1["provider"]["id"]);
      const validated = await sdk.validate(configuration);
      const compiled = await sdk.compile(configuration);
      if (!validated.ok || !compiled.ok) continue;
      const structure = validated.value.structure;
      items.push({
        selectionId: configuration.provider.id,
        id: compiled.value.provider.id,
        version: compiled.value.provider.version,
        structuralHash: compiled.value.compiler.structuralHash,
        compiler: compiled.value.compiler.id,
        nodes: structure.nodes,
        terminalNodes: structure.terminals,
        chanceNodes: structure.chanceNodes,
        decisionNodes: structure.decisionNodes,
        informationSets: structure.informationSets,
        maximumDepth: null,
        actions: [],
        capabilities: provider.capabilities,
        validation: { valid: validated.value.valid, issues: structure.issues, independentDelta: validated.value.independentEvaluation.maximumDelta },
      });
    }
    gamesCache = items;
    return items;
  }

  function gameTree(providerId: ResearchExperimentConfigurationV1["provider"]["id"], limit = 160): ConsoleTree {
    const provider = createBuiltinProvider({ id: providerId });
    type Pending = { state: unknown; parentId: string | null; depth: number; action: string | null; chanceProbability: number | null };
    const pending: Pending[] = [{ state: provider.initialState(), parentId: null, depth: 0, action: null, chanceProbability: null }];
    const nodes: ConsoleTreeNode[] = [];
    while (pending.length && nodes.length < limit) {
      const item = pending.shift()!;
      const id = `n${nodes.length}`;
      const actor = provider.actor(item.state);
      const terminal = actor === null;
      const chance = actor === "chance";
      nodes.push({
        id,
        parentId: item.parentId,
        depth: item.depth,
        kind: terminal ? "terminal" : chance ? "chance" : "player",
        actor,
        action: item.action,
        informationSet: terminal || chance ? null : provider.informationSetKey(item.state),
        chanceProbability: item.chanceProbability,
        utility: terminal ? provider.terminalUtility(item.state) : null,
      });
      if (terminal) continue;
      for (const action of provider.legalActions(item.state)) {
        pending.push({
          state: provider.transition(item.state, action),
          parentId: id,
          depth: item.depth + 1,
          action: provider.actionLabel(item.state, action),
          chanceProbability: chance ? provider.chanceProbability(item.state, action) : null,
        });
      }
    }
    return { gameId: provider.identity.id, nodes, truncated: pending.length > 0, limit };
  }

  async function handleEvents(request: IncomingMessage, response: ServerResponse, runId: string, url: URL) {
    const { target } = await runDirectory(runId);
    response.statusCode = 200;
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("connection", "keep-alive");
    response.setHeader("x-accel-buffering", "no");
    response.flushHeaders();
    let last = Number(request.headers["last-event-id"] ?? url.searchParams.get("after") ?? -1);
    let closed = false;
    request.on("close", () => { closed = true; });
    const tick = async () => {
      if (closed) return;
      const values = await readEvents(target);
      for (const event of values.filter((candidate) => candidate.sequence > last)) {
        response.write(`id: ${event.sequence}\nevent: research\ndata: ${JSON.stringify(event)}\n\n`);
        last = event.sequence;
      }
      const final = values.at(-1);
      if (final && TERMINAL_STATES.has(final.state)) {
        response.end();
        closed = true;
      }
    };
    await tick();
    const interval = setInterval(() => void tick(), 250);
    const heartbeat = setInterval(() => { if (!closed) response.write(": heartbeat\n\n"); }, 15_000);
    response.on("close", () => { closed = true; clearInterval(interval); clearInterval(heartbeat); });
  }

  const server = createServer(async (request, response) => {
    try {
      if (!cors(request, response)) return sendJson(response, 403, { ok: false, error: { code: "FORBIDDEN_ORIGIN", message: "Origin is not permitted." } });
      if (request.method === "OPTIONS") { response.statusCode = 204; return response.end(); }
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (!url.pathname.startsWith(API_PREFIX)) return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Route not found." } });
      if (request.method === "POST" && request.headers["x-preflop-console"] !== "1") return sendJson(response, 403, { ok: false, error: { code: "CSRF_GUARD", message: "Console request header is required." } });
      const path = url.pathname.slice(API_PREFIX.length) || "/";

      if (request.method === "GET" && path === "/health") return sendJson(response, 200, { ok: true, value: { status: "healthy", engineVersion: sdk.capabilities().engineVersion } });
      if (request.method === "GET" && path === "/capabilities") return sendJson(response, 200, { ok: true, value: sdk.capabilities() });
      if (request.method === "GET" && path === "/doctor") return sendOperation(response, await sdk.doctor());
      if (request.method === "POST" && path === "/validate") return sendOperation(response, await sdk.validate(await readBody(request)));
      if (request.method === "POST" && path === "/compile") return sendOperation(response, await sdk.compile(await readBody(request)));
      if (request.method === "GET" && path === "/games") return sendJson(response, 200, { ok: true, value: await games() });
      const treeMatch = path.match(/^\/games\/([a-z-]+)\/tree$/);
      if (request.method === "GET" && treeMatch) return sendJson(response, 200, { ok: true, value: gameTree(treeMatch[1] as ResearchExperimentConfigurationV1["provider"]["id"], Math.min(240, Math.max(20, Number(url.searchParams.get("limit") ?? 160)))) });

      if (request.method === "GET" && path === "/overview") {
        const runs = await listRuns();
        const doctor = await sdk.doctor();
        const summaries = runs.map((run) => run.summary);
        const overview: ConsoleOverview = {
          capabilities: sdk.capabilities(),
          totals: {
            all: summaries.length,
            completed: summaries.filter((run) => run.state === "completed").length,
            running: summaries.filter((run) => ["preflight", "ready", "running", "cancelling"].includes(run.state)).length,
            interrupted: summaries.filter((run) => ["interrupted", "cancelled"].includes(run.state)).length,
            failed: summaries.filter((run) => run.state === "failed").length,
          },
          recentRuns: summaries.slice(0, 5),
          recentFailures: summaries.filter((run) => run.error).slice(0, 5),
          resources: {
            activeRuns: active.size,
            peakRssBytes: runs.find((run) => run.result)?.result?.metrics.peakRssBytes ?? null,
            runtimeMs: runs.find((run) => run.result)?.result?.metrics.runtimeMs ?? null,
          },
          environment: { status: doctor.ok && Object.values(doctor.value.checks).every((check) => check.passed) ? "healthy" : "degraded", checkedAt: new Date().toISOString() },
        };
        return sendJson(response, 200, { ok: true, value: overview });
      }

      if (request.method === "GET" && path === "/experiments") {
        const search = (url.searchParams.get("search") ?? "").toLowerCase();
        const state = url.searchParams.get("state") ?? "all";
        const sort = url.searchParams.get("sort") === "oldest" ? "oldest" : "newest";
        const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
        const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get("pageSize") ?? 10)));
        let items = (await listRuns()).map((run) => run.summary).filter((run) => (!search || `${run.experimentId} ${run.runId} ${run.provider} ${run.algorithm}`.toLowerCase().includes(search)) && (state === "all" || run.state === state));
        if (sort === "oldest") items = items.reverse();
        const result: ConsoleListResponse = { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
        return sendJson(response, 200, { ok: true, value: result });
      }
      if (request.method === "POST" && path === "/experiments") return sendOperation(response, await sdk.createExperiment(await readBody(request)), 201);

      const runMatch = path.match(/^\/experiments\/([a-zA-Z0-9._-]+)(?:\/(run|cancel|checkpoint|resume|events|result|verify|export))?$/);
      if (runMatch) {
        const [, runId, action] = runMatch;
        if (!isSafeId(runId)) return sendJson(response, 400, { ok: false, error: { code: "INVALID_CONFIGURATION", message: "Unsafe run id." } });
        if (request.method === "GET" && !action) return sendJson(response, 200, { ok: true, value: await details(runId) });
        if (request.method === "GET" && action === "events") return handleEvents(request, response, runId, url);
        if (request.method === "GET" && action === "result") return sendOperation(response, await sdk.results(runId));
        if (request.method === "GET" && action === "export") {
          const result = await sdk.results(runId);
          if (!result.ok) return sendOperation(response, result);
          const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
          response.statusCode = 200;
          response.setHeader("content-disposition", `attachment; filename="${runId}.${format}"`);
          response.setHeader("content-type", format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
          return response.end(format === "csv" ? csvFromResult(result.value) : `${JSON.stringify(result.value, null, 2)}\n`);
        }
        if (request.method === "POST" && action === "run") {
          const index = await readIndex(runId);
          const started = startRun({ experimentId: index.experimentId, runId });
          return sendJson(response, started ? 202 : 409, started ? { ok: true, value: { runId, accepted: true } } : { ok: false, error: { code: "EXECUTION_ERROR", message: "Run is already active." } });
        }
        if (request.method === "POST" && action === "resume") {
          const index = await readIndex(runId);
          const started = startRun({ experimentId: index.experimentId, runId }, true);
          return sendJson(response, started ? 202 : 409, started ? { ok: true, value: { runId, accepted: true } } : { ok: false, error: { code: "EXECUTION_ERROR", message: "Run is already active." } });
        }
        if (request.method === "POST" && action === "cancel") return sendOperation(response, await sdk.cancel(runId));
        if (request.method === "POST" && action === "checkpoint") return sendOperation(response, await sdk.checkpoint(runId));
        if (request.method === "POST" && action === "verify") {
          const { target } = await runDirectory(runId);
          return sendOperation(response, await sdk.verify(relative(workspaceRoot, join(target, "result.json"))));
        }
      }
      return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Route not found." } });
    } catch (error) {
      const candidate = error as { researchError?: unknown };
      const normalized = candidate.researchError ?? asResearchError(error).toJSON();
      return sendJson(response, 500, { ok: false, error: normalized });
    }
  });

  return {
    server,
    active,
    async listen() {
      const host = options.host ?? "127.0.0.1";
      const port = options.port ?? 8788;
      await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolveListen());
      });
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      if (!options.quiet) process.stdout.write(`Preflop Lab Research API: http://${host}:${actualPort}${API_PREFIX}\n`);
      return { host, port: actualPort };
    },
    async close() {
      await Promise.allSettled([...active.values()]);
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}

async function main() {
  const portArgument = process.argv.find((value) => value.startsWith("--port="));
  const port = portArgument ? Number(portArgument.split("=")[1]) : 8788;
  const app = createResearchConsoleServer({ port });
  await app.listen();
  const shutdown = () => void app.close().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) void main();
