import { executeResearchRun, type WorkerMessage, type WorkerRequest } from "./runtime";

const PROTOCOL = "PREFLOP_RESEARCH:";

function send(message: WorkerMessage) {
  process.stdout.write(`${PROTOCOL}${JSON.stringify(message)}\n`);
}

async function main() {
  const encoded = process.argv[2];
  if (!encoded) throw new Error("Missing worker request.");
  const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as WorkerRequest;
  await executeResearchRun(request, send);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
