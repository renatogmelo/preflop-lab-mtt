import type { ResearchProgressEvent } from "./contracts";
import { captureResearchResult } from "./errors";
import { createResearchEngine, type ExperimentHandle, type ResearchEngineOptions } from "./engine";

export type SdkRunOptions = {
  onProgress?: (event: ResearchProgressEvent) => void;
};

export class PreflopResearchSdk {
  readonly engine;
  constructor(options: ResearchEngineOptions = {}) {
    this.engine = createResearchEngine(options);
  }

  capabilities() { return this.engine.getCapabilities(); }
  validate(configuration: unknown) { return captureResearchResult(() => this.engine.validateGame(configuration)); }
  compile(configuration: unknown) { return captureResearchResult(() => this.engine.compileGame(configuration)); }
  createExperiment(configuration: unknown) { return captureResearchResult(() => this.engine.createExperiment(configuration)); }
  status(runId: string) { return captureResearchResult(() => this.engine.getExperimentStatus(runId)); }
  cancel(runId: string) { return captureResearchResult(() => this.engine.cancelExperiment(runId)); }
  checkpoint(runId: string) { return captureResearchResult(() => this.engine.checkpointExperiment(runId)); }
  resume(runId: string) { return captureResearchResult(() => this.engine.resumeExperiment(runId)); }
  results(runId: string) { return captureResearchResult(() => this.engine.getExperimentResults(runId)); }
  verify(artifact: string) { return captureResearchResult(() => this.engine.verifyArtifact(artifact)); }
  doctor() { return captureResearchResult(() => this.engine.doctor()); }

  runExperiment(handle: ExperimentHandle, options: SdkRunOptions = {}) {
    return captureResearchResult(() => this.engine.runExperiment(handle, options));
  }

  async run(configuration: unknown, options: SdkRunOptions = {}) {
    return captureResearchResult(async () => {
      const handle = await this.engine.createExperiment(configuration);
      return this.engine.runExperiment(handle, options);
    });
  }
}

export function createResearchSdk(options: ResearchEngineOptions = {}) {
  return new PreflopResearchSdk(options);
}
