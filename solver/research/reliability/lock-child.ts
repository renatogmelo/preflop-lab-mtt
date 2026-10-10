import { acquireWriterLease } from "./manifest";

const prefix = "PHASE615LOCK:";
const encoded = process.argv[2];
if (!encoded) throw new Error("Missing lock payload.");
const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { target: string; holdMs: number; owner: string };
try {
  const lease = await acquireWriterLease(input.target, input.owner);
  process.stdout.write(`${prefix}${JSON.stringify({ status: "acquired", owner: input.owner, pid: process.pid })}\n`);
  await new Promise((resolve) => setTimeout(resolve, input.holdMs));
  await lease.release();
  process.stdout.write(`${prefix}${JSON.stringify({ status: "released", owner: input.owner, pid: process.pid })}\n`);
} catch (error) {
  process.stdout.write(`${prefix}${JSON.stringify({ status: "rejected", owner: input.owner, pid: process.pid, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : String(error) })}\n`);
}
