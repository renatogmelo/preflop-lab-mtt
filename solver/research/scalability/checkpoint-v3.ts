import { hashValue } from "../../core/stable";
import type { SolverCheckpoint } from "../../core/types";

export const RESEARCH_CHECKPOINT_VERSION = 3;
export const STRUCTURAL_REPRESENTATION_VERSION = "indexed-f64-v1";

export type ResearchCheckpointV3 = {
  schemaVersion: 3;
  structuralRepresentationVersion: string;
  gameHash: string;
  algorithmConfigurationHash: string;
  solverVersion: string;
  iteration: number;
  solver: SolverCheckpoint;
  semanticHash: string;
};

export function semanticSolverCheckpoint(checkpoint: SolverCheckpoint) {
  return {
    ...checkpoint,
    createdAt: undefined,
    convergenceHistory: checkpoint.convergenceHistory.map((point) => ({ ...point, elapsedMs: undefined })),
  };
}

export function createResearchCheckpointV3(checkpoint: SolverCheckpoint): ResearchCheckpointV3 {
  const semantic = semanticSolverCheckpoint(checkpoint);
  return {
    schemaVersion: RESEARCH_CHECKPOINT_VERSION,
    structuralRepresentationVersion: STRUCTURAL_REPRESENTATION_VERSION,
    gameHash: checkpoint.gameDefinitionHash,
    algorithmConfigurationHash: checkpoint.configurationHash,
    solverVersion: checkpoint.solverVersion,
    iteration: checkpoint.iteration,
    solver: checkpoint,
    semanticHash: hashValue(semantic),
  };
}

export function validateResearchCheckpointV3(checkpoint: ResearchCheckpointV3) {
  const issues: string[] = [];
  if (checkpoint.schemaVersion !== RESEARCH_CHECKPOINT_VERSION) issues.push("schema-version");
  if (checkpoint.structuralRepresentationVersion !== STRUCTURAL_REPRESENTATION_VERSION) issues.push("representation-version");
  if (checkpoint.gameHash !== checkpoint.solver.gameDefinitionHash) issues.push("game-hash");
  if (checkpoint.algorithmConfigurationHash !== checkpoint.solver.configurationHash) issues.push("configuration-hash");
  if (checkpoint.iteration !== checkpoint.solver.iteration) issues.push("iteration");
  if (checkpoint.semanticHash !== hashValue(semanticSolverCheckpoint(checkpoint.solver))) issues.push("semantic-hash");
  return { valid: issues.length === 0, issues };
}
