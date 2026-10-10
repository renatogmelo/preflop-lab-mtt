import { performance } from "node:perf_hooks";
import { compileGenericGame } from "../generic/compiler-v3";
import { IrregularBranchingProvider } from "../generic/synthetic-families";

const prefix = "PHASE615SCALE:";
const encoded = process.argv[2];
if (!encoded) throw new Error("Missing scale payload.");
const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
  id: string;
  seed: number;
  maximumDepth: number;
  maximumBranching: number;
  maximumNodes: number;
};
const started = performance.now();
try {
  const compilation = compileGenericGame(new IrregularBranchingProvider({
    id: input.id,
    seed: input.seed,
    maximumDepth: input.maximumDepth,
    minimumTerminalDepth: 2,
    maximumBranching: input.maximumBranching,
  }), { maximumNodes: input.maximumNodes, growthPolicy: "segmented", segmentSize: 65_536, processingChunkSize: 8_192 });
  const memory = process.memoryUsage();
  process.stdout.write(`${prefix}${JSON.stringify({
    status: "completed",
    nodes: compilation.tree.kind.length,
    informationSets: compilation.tree.informationSetActionCount.length,
    structuralHash: compilation.structuralHash,
    runtimeMs: performance.now() - started,
    rssObservedBytes: memory.rss,
    heapUsedObservedBytes: memory.heapUsed,
    topologyBytes: compilation.topologyBytes,
    registryBytes: compilation.registryBytes,
  })}\n`);
} catch (error) {
  process.stdout.write(`${prefix}${JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : String(error), runtimeMs: performance.now() - started, rssObservedBytes: process.memoryUsage().rss })}\n`);
}
