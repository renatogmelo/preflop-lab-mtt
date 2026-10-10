import type {
  ConvergenceExperimentConfiguration,
  ConvergenceExperimentResult,
} from "./types";

export type ScheduledFailure = { experimentId: string; error: string };
export type SchedulerManifest = {
  maximumConcurrency: number;
  submitted: number;
  completed: number;
  cancelled: number;
  failures: ScheduledFailure[];
  results: ConvergenceExperimentResult[];
};

export class ConvergenceExperimentScheduler {
  constructor(readonly maximumConcurrency = 1) {
    if (!Number.isInteger(maximumConcurrency) || maximumConcurrency < 1)
      throw new Error("Scheduler concurrency must be a positive integer.");
  }

  async run(
    configurations: readonly ConvergenceExperimentConfiguration[],
    executor: (
      configuration: ConvergenceExperimentConfiguration,
      signal: AbortSignal,
    ) => Promise<ConvergenceExperimentResult>,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SchedulerManifest> {
    const results: ConvergenceExperimentResult[] = [];
    const failures: ScheduledFailure[] = [];
    let cursor = 0;
    let cancelled = 0;
    const worker = async () => {
      while (cursor < configurations.length) {
        if (signal.aborted) {
          cancelled += configurations.length - cursor;
          cursor = configurations.length;
          return;
        }
        const index = cursor++;
        const configuration = configurations[index];
        try {
          const result = await executor(configuration, signal);
          results.push(result);
          if (result.status === "cancelled") cancelled += 1;
        } catch (error) {
          failures.push({
            experimentId: configuration.experimentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.maximumConcurrency, configurations.length) },
        () => worker(),
      ),
    );
    results.sort((left, right) =>
      left.experimentId.localeCompare(right.experimentId),
    );
    failures.sort((left, right) =>
      left.experimentId.localeCompare(right.experimentId),
    );
    return {
      maximumConcurrency: this.maximumConcurrency,
      submitted: configurations.length,
      completed: results.length,
      cancelled,
      failures,
      results,
    };
  }
}
