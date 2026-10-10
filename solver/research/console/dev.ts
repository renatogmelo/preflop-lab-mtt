import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const node = process.execPath;
const children: ChildProcess[] = [];

function launch(command: string, args: string[]) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_RESEARCH_API_URL: process.env.NEXT_PUBLIC_RESEARCH_API_URL ?? "http://127.0.0.1:8788/api/research",
    },
  });
  children.push(child);
  child.once("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
    shutdown();
  });
  return child;
}

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
}

launch(node, ["--import", "tsx", "solver/research/console/server.ts"]);
launch(node, ["node_modules/vinext/dist/cli.js", "dev"]);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
