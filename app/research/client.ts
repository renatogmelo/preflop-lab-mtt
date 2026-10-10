import type {
  ConsoleGame,
  ConsoleListResponse,
  ConsoleOverview,
  ConsoleRunDetails,
  ConsoleTree,
} from "../../solver/research/console/contracts";
import type {
  EngineCapabilitiesV1,
  ResearchErrorShape,
  ResearchExperimentConfigurationV1,
  ResearchProgressEvent,
} from "../../solver/research/public/contracts";

export const RESEARCH_API = process.env.NEXT_PUBLIC_RESEARCH_API_URL ?? "http://127.0.0.1:8788/api/research";

type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ResearchErrorShape | { code: string; message: string; recoverable?: boolean } };

export class ConsoleApiError extends Error {
  constructor(readonly code: string, message: string, readonly recoverable = false) {
    super(message);
    this.name = "ConsoleApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${RESEARCH_API}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json", "x-preflop-console": "1" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ConsoleApiError("CONNECTION_LOSS", "O Research Engine local não respondeu. Inicie o console com npm run research:console.", true);
  }
  const payload = await response.json() as ApiResult<T>;
  if (!payload.ok) throw new ConsoleApiError(payload.error.code, payload.error.message, Boolean(payload.error.recoverable));
  return payload.value;
}

export const researchApi = {
  health: () => request<{ status: string; engineVersion: string }>("/health"),
  capabilities: () => request<EngineCapabilitiesV1>("/capabilities"),
  overview: () => request<ConsoleOverview>("/overview"),
  experiments: (query = "") => request<ConsoleListResponse>(`/experiments${query ? `?${query}` : ""}`),
  experiment: (runId: string) => request<ConsoleRunDetails>(`/experiments/${encodeURIComponent(runId)}`),
  validate: (configuration: ResearchExperimentConfigurationV1) => request<unknown>("/validate", { method: "POST", body: JSON.stringify(configuration) }),
  compile: (configuration: ResearchExperimentConfigurationV1) => request<unknown>("/compile", { method: "POST", body: JSON.stringify(configuration) }),
  create: (configuration: ResearchExperimentConfigurationV1) => request<{ experimentId: string; runId: string }>("/experiments", { method: "POST", body: JSON.stringify(configuration) }),
  action: (runId: string, action: "run" | "cancel" | "checkpoint" | "resume" | "verify") => request<unknown>(`/experiments/${encodeURIComponent(runId)}/${action}`, { method: "POST", body: "{}" }),
  games: () => request<ConsoleGame[]>("/games"),
  tree: (provider: string, limit = 160) => request<ConsoleTree>(`/games/${encodeURIComponent(provider)}/tree?limit=${limit}`),
  doctor: () => request<Record<string, unknown>>("/doctor"),
  exportUrl: (runId: string, format: "json" | "csv") => `${RESEARCH_API}/experiments/${encodeURIComponent(runId)}/export?format=${format}`,
};

export function subscribeToRun(runId: string, handlers: {
  event: (event: ResearchProgressEvent) => void;
  error: () => void;
}) {
  const source = new EventSource(`${RESEARCH_API}/experiments/${encodeURIComponent(runId)}/events`);
  source.addEventListener("research", (message) => handlers.event(JSON.parse((message as MessageEvent<string>).data) as ResearchProgressEvent));
  source.onerror = handlers.error;
  return () => source.close();
}
