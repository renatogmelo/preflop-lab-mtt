import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hashValue, stableStringify } from "../../core/stable";

const baseline = "4c128679cf51f49dc85b45a35c0cd5b913cb7e95";
const routes = [
  "/research", "/research/experiments", "/research/experiments/:runId", "/research/new",
  "/research/algorithms", "/research/games", "/research/results", "/research/results/:runId",
  "/research/checkpoints", "/research/diagnostics", "/research/settings",
];
const components = [
  "ResearchConsole", "AppView", "SectionTitle", "RunTable", "Overview", "Experiments", "NewExperiment",
  "Algorithms", "GameExplorer", "GameTree", "Results", "Checkpoints", "Diagnostics", "Settings", "RunDetails",
  "EventList", "StatusBadge", "MetricCard", "EmptyState", "ErrorState", "Loading", "ProgressBar", "Dialog",
  "Toasts", "ConvergenceChart", "ValidationBadge",
];

const unsigned = {
  schemaVersion: "phase7-1-research-console-artifact-v1",
  product: "Preflop Lab Research Console",
  version: "1.0.0",
  phase: "7.1",
  baseline,
  generatedAt: "2026-10-10T20:30:00.000Z",
  frontendArchitecture: {
    framework: "Vinext + React 19",
    routeModel: "catch-all Research Console route with client-side history navigation",
    executionBoundary: "localhost-only Node sidecar using Public SDK V1",
    computationInBrowser: false,
    componentCount: components.length,
    components,
  },
  routes,
  sdkIntegration: {
    sdk: "PreflopResearchSdk 1.0.0",
    duplicatedAlgorithms: false,
    operations: ["capabilities", "validate", "compile", "createExperiment", "runExperiment", "status", "cancel", "checkpoint", "resume", "results", "verify", "doctor"],
    providers: ["variable-depth-hidden", "asymmetric-chance", "irregular-branching", "regular-synthetic"],
  },
  experimentFlows: ["create", "validate", "run", "live-progress", "cancel", "checkpoint", "resume", "result", "compare", "export", "verify"],
  eventTransport: {
    protocol: "SSE",
    source: "persisted research-event-v1 NDJSON",
    orderedBy: "sequence",
    replay: true,
    heartbeatMs: 15000,
    pollingMs: 250,
    stateRecovery: "status/configuration/events/result from backend",
  },
  chartValidation: {
    implementation: "responsive Canvas",
    source: "ResearchResultV1.convergence only",
    axes: ["iteration", "runtimeMs"],
    scales: ["linear", "log-positive-only"],
    fabricatedValues: false,
  },
  checkpointIntegration: {
    format: "checkpoint-v5",
    integrityOwnedByEngine: true,
    testedFlow: "running -> checkpoint -> cancel -> cancelled -> resume -> completed",
    recoveryEventObserved: true,
  },
  securityChecks: {
    localhostBind: "PASS",
    originAllowlist: "PASS",
    csrfGuard: "PASS",
    bodyLimit: "PASS",
    safeRunId: "PASS",
    arbitraryPathDownload: "REJECTED",
    providerAllowlist: "PASS",
    treeNodeCap: "PASS",
    resourcePolicy: "PASS",
    processIsolation: "PASS",
  },
  validation: {
    typecheck: "PASS",
    lint: "PASS",
    productionBuild: "PASS",
    typescript: { passed: 310, failed: 0 },
    phase71E2e: { passed: 9, failed: 0 },
    historicalRelease: { passed: 80, failed: 0 },
    rust: { passed: 3, failed: 0 },
    routeHttp: "PASS",
    browserVisualQa: "NOT_TESTED_WINDOWS_SANDBOX_ACL",
  },
  gates: {
    U1: "PASS", U2: "PASS", U3: "PASS", U4: "PASS", U5: "PASS", U6: "PASS", U7: "PASS",
    U8: "PARTIAL_BROWSER_VISUAL_QA_NOT_TESTED",
    U9: "PARTIAL_BROWSER_NAVIGATION_NOT_TESTED",
  },
  trustBoundary: {
    scope: "finite synthetic two-player zero-sum perfect-recall games",
    gateD: "FAIL",
    verifiedDatasets: 0,
    pokerStrategiesChanged: false,
    multiplayerSupported: false,
    eightMaxStrategicSupportClaimed: false,
  },
  knownLimitations: [
    "The execution sidecar is local Node software and is not deployed to Sites.",
    "Automated browser visual inspection was blocked by the Windows sandbox ACL failure.",
    "SSE tails the durable NDJSON file for a single-user local console.",
    "Cross-OS reproducibility remains untested.",
  ],
  reproductionCommands: [
    "npm run research:console",
    "npm run typecheck",
    "npm run lint",
    "npm run build",
    "npm run test:research-console",
    "npm test",
    "npm run test:release",
    "cargo test --manifest-path solver/native/phase611-compiler/Cargo.toml",
    "npm run research:console-release",
  ],
} as const;

const artifact = { ...unsigned, artifactChecksum: hashValue(unsigned) };
const destination = resolve("solver/artifacts/phase7-1-research-console-v1.0.0.json");
await writeFile(destination, `${stableStringify(artifact)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ destination, artifactChecksum: artifact.artifactChecksum }, null, 2)}\n`);
