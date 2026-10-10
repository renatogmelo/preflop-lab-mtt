import { hashValue } from "../../core/stable";
import { ReliabilityError } from "./errors";
import { writeJsonAtomic } from "./manifest";

export const RELIABILITY_ARTIFACT_SCHEMA = "phase6.15-reliability-artifact-v1";

export type ReliabilityArtifactEnvelope<T extends Record<string, unknown>> = T & {
  schemaVersion: typeof RELIABILITY_ARTIFACT_SCHEMA;
  runIdentity: string;
  configurationIdentity: string;
  createdAt: string;
  completionStatus: "complete" | "failed";
  failureDetails: readonly unknown[];
  contentChecksum: string;
};

export function sealReliabilityArtifact<T extends Record<string, unknown>>(
  payload: T & {
    runIdentity: string;
    configurationIdentity: string;
    createdAt: string;
    completionStatus: "complete" | "failed";
    failureDetails: readonly unknown[];
  },
): ReliabilityArtifactEnvelope<T> {
  if (payload.completionStatus === "complete" && payload.failureDetails.some((failure) => (failure as { unexpected?: boolean })?.unexpected)) {
    throw new ReliabilityError("ARTIFACT_INCOMPLETE", "Artifact with unexpected failures cannot be classified as complete.");
  }
  const unsigned = { schemaVersion: RELIABILITY_ARTIFACT_SCHEMA, ...payload };
  return { ...unsigned, contentChecksum: hashValue(unsigned) } as ReliabilityArtifactEnvelope<T>;
}

export function verifyReliabilityArtifact(value: ReliabilityArtifactEnvelope<Record<string, unknown>>) {
  const { contentChecksum, ...unsigned } = value;
  if (value.schemaVersion !== RELIABILITY_ARTIFACT_SCHEMA || hashValue(unsigned) !== contentChecksum) {
    throw new ReliabilityError("ARTIFACT_INCOMPLETE", "Reliability artifact checksum or schema is invalid.");
  }
  return true;
}

export async function publishReliabilityArtifact(path: string, artifact: ReliabilityArtifactEnvelope<Record<string, unknown>>) {
  verifyReliabilityArtifact(artifact);
  return writeJsonAtomic(path, artifact);
}
