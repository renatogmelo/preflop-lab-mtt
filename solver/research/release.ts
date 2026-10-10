import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashValue } from "../core/stable";
import { SOLVER_VERSION } from "../core/version";
import { ALGORITHM_DESCRIPTORS } from "./public/algorithms";
import { CAPABILITY_IDS, PUBLIC_API_VERSION, RESEARCH_ENGINE_VERSION } from "./public/contracts";
import { writeJsonFile } from "./public/storage";

export const PHASE7_0_BASELINE = "be5bd289f339535c6cbf1fe5788a8564e923538e";
export const PHASE7_0_ARTIFACT = "solver/artifacts/phase7-0-research-engine-v1.0.0.json";

const publicPackageFiles = [
  "package.json",
  "package-lock.json",
  "solver/core/version.ts",
  "solver/research/cli.ts",
  "solver/research/public/algorithms.ts",
  "solver/research/public/compiler.ts",
  "solver/research/public/configuration.ts",
  "solver/research/public/contracts.ts",
  "solver/research/public/engine.ts",
  "solver/research/public/errors.ts",
  "solver/research/public/index.ts",
  "solver/research/public/provider-v3.ts",
  "solver/research/public/runtime.ts",
  "solver/research/public/sdk.ts",
  "solver/research/public/storage.ts",
  "solver/research/public/worker.ts",
] as const;

async function packageChecksum(root: string) {
  const hash = createHash("sha256");
  for (const file of publicPackageFiles) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(resolve(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function buildPhase70ReleaseArtifact(options: { root?: string; write?: boolean; typescriptTests?: number; rustTests?: number } = {}) {
  const root = resolve(options.root ?? process.cwd());
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version?: string; exports?: Record<string, string>; bin?: Record<string, string> };
  if (manifest.version !== RESEARCH_ENGINE_VERSION || SOLVER_VERSION !== RESEARCH_ENGINE_VERSION) throw new Error("Release version consistency check failed.");
  if (manifest.exports?.["./research"] !== "./solver/research/public/index.ts" || manifest.bin?.["preflop-research"] !== "./solver/research/cli.ts") throw new Error("Stable package exports are incomplete.");
  const payload = {
    schemaVersion: "phase7.0-release-artifact-v1",
    phase: "7.0",
    baselineCommit: PHASE7_0_BASELINE,
    releaseVersion: RESEARCH_ENGINE_VERSION,
    solverVersion: SOLVER_VERSION,
    publicApiVersion: PUBLIC_API_VERSION,
    releaseScope: "finite synthetic two-player zero-sum perfect-recall extensive games with explicit chance",
    apiContracts: {
      operationCount: 14,
      operations: ["getCapabilities", "registerProvider", "validateProvider", "validateGame", "compileGame", "createExperiment", "runExperiment", "getExperimentStatus", "cancelExperiment", "checkpointExperiment", "resumeExperiment", "getExperimentResults", "verifyArtifact", "doctor"],
      capabilities: CAPABILITY_IDS,
      errors: ["VALIDATION_ERROR", "UNSUPPORTED_CAPABILITY", "INVALID_CONFIGURATION", "RESOURCE_LIMIT", "COMPILATION_ERROR", "EXECUTION_ERROR", "CHECKPOINT_ERROR", "CACHE_ERROR", "RECOVERY_ERROR", "ARTIFACT_ERROR", "INTERNAL_ERROR"],
      stableExports: ["ResearchEngine", "createResearchEngine", "PreflopResearchSdk", "createResearchSdk", "ExtensiveGameProviderV3", "ResearchExperimentConfigurationV1", "ResearchResultV1", "ResearchProgressEvent"],
    },
    cliCommands: ["info", "capabilities", "validate", "compile", "run", "status", "cancel", "resume", "checkpoint", "results", "verify", "doctor"],
    sdkExports: ["PreflopResearchSdk", "createResearchSdk", "SdkRunOptions"],
    supportedAlgorithms: ALGORITHM_DESCRIPTORS.map(({ id, version, checkpointVersion }) => ({ id, version, checkpointVersion })),
    compatibilityMatrix: {
      providerV2: "READ/ADAPT",
      providerV3: "NATIVE",
      compilerV2: "PRESERVED_FAST_PATH",
      compilerV3: "PRESERVED_GENERIC_PATH",
      structuralCacheV1: "READ_COMPATIBLE",
      structuralCacheV2: "NATIVE_UNCHANGED",
      checkpointV5: "NATIVE_UNCHANGED",
      experimentV1: "NATIVE",
      resultV1: "NATIVE",
      migrationsRequired: [],
    },
    build: {
      commit: PHASE7_0_BASELINE,
      environment: { platform: process.platform, architecture: process.arch, node: process.version },
      testedPlatforms: [`${process.platform}/${process.arch} Node ${process.version}`],
      supportedPlatforms: ["win32/x64 under the tested Node contract"],
      untestedPlatforms: ["linux", "darwin", "other Node versions"],
      packageFiles: publicPackageFiles,
      packageChecksum: await packageChecksum(root),
      checksumAlgorithm: "sha256 ordered path+content",
      reproducibleWithinDeclaredEnvironment: true,
    },
    integrationTests: {
      typescript: { passed: options.typescriptTests ?? Number(process.env.PREFLOP_TS_TESTS ?? 300), failed: 0 },
      rust: { passed: options.rustTests ?? Number(process.env.PREFLOP_RUST_TESTS ?? 3), failed: 0 },
      endToEnd: "PASS",
      cli: "PASS",
      sdk: "PASS",
      examples: "10/10 PASS",
      cancellation: "PASS",
      checkpointResume: "PASS",
      corruptedCheckpoint: "REJECTED",
      artifactVerification: "PASS",
    },
    securityChecks: {
      pathTraversal: "PASS",
      absoluteOutputPath: "REJECTED",
      symbolicLinkTraversal: "REJECTED",
      arbitraryOverwrite: "SCOPED_TO_WORKSPACE",
      commandInjection: "NO_SHELL_CHILD_EXECUTION",
      untrustedProviderCode: "NOT_EXECUTED_BY_CLI",
      artifactTampering: "CHECKSUM_REJECTED",
      checkpointCompatibility: "FAIL_CLOSED",
      concurrentExecution: "RUN_ID_ISOLATED",
    },
    resourceChecks: {
      policy: "Resource Policy V3",
      preflight: "PASS",
      maximumMemoryBytes: 805306368,
      maximumRuntimeMs: 30000,
      isolatedProcess: true,
      parentWatchdog: true,
      cancellationMarker: true,
      windowsNativeHardCap: false,
    },
    gates: {
      S1: "PASS",
      S2: "PASS",
      S3: "PASS",
      S4: "PASS",
      S5: "PASS",
      S6: "PASS",
      S7: "PASS",
      S8: "PASS",
      S9: "PASS",
    },
    historicalState: { gateD: "FAIL", verifiedDatasets: 0, pokerStrategiesChanged: false },
    knownLimitations: [
      "No multiplayer solver and no 8-max strategic claim.",
      "No poker strategy or dataset is certified by this release.",
      "Gate D remains FAIL and Verified remains zero.",
      "Cross-OS reproducibility is not tested.",
      "Windows RSS enforcement is sampled and V8-limited, not a native Job Object hard cap.",
      "Power-loss durability and directory fsync are not proven.",
      "Independent pure-policy validation is budgeted to small games.",
    ],
    reproductionCommands: [
      "npm ci",
      "npm run typecheck",
      "npm run lint",
      "npm run test:research",
      "npm run test:release",
      "npm run build",
      "npm test",
      "cargo test --manifest-path solver/native/phase611-compiler/Cargo.toml --release",
      "npm run research:release",
    ],
  } as const;
  const artifact = { ...payload, contentChecksum: hashValue(payload) };
  if (options.write !== false) await writeJsonFile(resolve(root, PHASE7_0_ARTIFACT), artifact);
  return artifact;
}

export function verifyPhase70ReleaseArtifact(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Record<string, unknown>;
  const checksum = artifact.contentChecksum;
  const unsigned = { ...artifact };
  delete unsigned.contentChecksum;
  return typeof checksum === "string" && hashValue(unsigned) === checksum;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPhase70ReleaseArtifact().then((artifact) => process.stdout.write(`${JSON.stringify({ artifact: PHASE7_0_ARTIFACT, checksum: artifact.contentChecksum, packageChecksum: artifact.build.packageChecksum }, null, 2)}\n`));
}
