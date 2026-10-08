import { parentPort, workerData } from "node:worker_threads";
import { runFixtureExperiment, runProfileExperiment } from "./experiment-core";
import type { IsolatedExperimentRequest, StageMetric } from "./types";

const port = parentPort;
if (!port) throw new Error("Phase 6.10 experiment worker requires a parent port.");
const request = workerData as IsolatedExperimentRequest;
const report = (metric: StageMetric) => port.postMessage({ type: "stage", metric });

try {
  const result = request.kind === "profile"
    ? await runProfileExperiment(request, report)
    : await runFixtureExperiment(request);
  port.postMessage({ type: "result", result });
} catch (error) {
  port.postMessage({ type: "error", error: error instanceof Error ? error.stack ?? error.message : String(error) });
}
