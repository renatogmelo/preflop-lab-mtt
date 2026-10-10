import { runConvergenceExperiment } from "./experiment-framework";
import type { ConvergenceExperimentConfiguration } from "./types";

const prefix = "PHASE614:";
const encoded = process.argv[2];
if (!encoded) throw new Error("Missing convergence experiment payload.");
const configuration = JSON.parse(
  Buffer.from(encoded, "base64url").toString("utf8"),
) as ConvergenceExperimentConfiguration;

try {
  const result = await runConvergenceExperiment(configuration);
  process.stdout.write(
    `${prefix}${JSON.stringify({ type: "result", result })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${prefix}${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
}
