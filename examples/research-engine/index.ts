import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createResearchSdk, type ResearchExperimentConfigurationV1 } from "../../solver/research/public/index";

const here = dirname(fileURLToPath(import.meta.url));

export async function loadExampleConfiguration() {
  return JSON.parse(await readFile(resolve(here, "experiment.json"), "utf8")) as ResearchExperimentConfigurationV1;
}

export async function runWorkingExamples(workspaceRoot = process.cwd()) {
  const sdk = createResearchSdk({ workspaceRoot });
  const configuration = await loadExampleConfiguration();
  const validation = await sdk.validate(configuration); // 1. Validate a game.
  const compilation = await sdk.compile(configuration); // 2. Compile a game.
  const algorithms = ["vanilla-cfr", "cfr-plus", "dcfr"] as const;
  const runs = [];
  for (const algorithm of algorithms) {
    const run = await sdk.run({
      ...configuration,
      experimentId: `example-${algorithm}-${Date.now()}`,
      algorithm: { ...configuration.algorithm, id: algorithm },
    });
    runs.push(run); // 3/4/5. Execute Vanilla CFR, CFR+ and DCFR.
  }
  const successful = runs.filter((run) => run.ok);
  if (!successful.length) return { validation, compilation, runs };
  const first = successful[0].value;
  const runId = first.status.runId;
  const metrics = await sdk.results(runId); // 6. Query metrics/results.
  const checkpoint = await sdk.checkpoint(runId); // 7. Inspect/create checkpoint.
  const resumed = await sdk.resume(runId); // 8. Resume from Checkpoint V5.
  const comparison = successful.map((run) => run.value.result?.metrics ?? null); // 9. Compare algorithms.
  const resultPath = `.preflop-research/runs/${runId}/result.json`;
  const verification = await sdk.verify(resultPath); // 10. Verify the sealed artifact.
  return { validation, compilation, runs, metrics, checkpoint, resumed, comparison, verification };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkingExamples().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`));
}
