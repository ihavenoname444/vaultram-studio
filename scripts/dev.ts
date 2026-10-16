import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const children: ChildProcess[] = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
function start(args: string[]) {
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
start(["--import", "tsx", "services/gateway/src/server.ts"]);
// The live gateway checks remote deployment pins before listening. Do not offer
// the UI until it is ready, or its initial configuration request can fail.
const deadline = Date.now() + 45000;
let ready = false;
while (!stopping && Date.now() < deadline) {
  try {
    const r = await fetch(
      `http://127.0.0.1:${process.env.VAULTRAM_PORT ?? 8787}/api/config`,
      { signal: AbortSignal.timeout(1000) },
    );
    await r.arrayBuffer();
    if (r.ok) {
      ready = true;
      break;
    }
  } catch {
    /* Gateway is still starting. */
  }
  await delay(200);
}
if (!stopping) {
  if (!ready) {
    console.error("Gateway did not become ready; UI startup cancelled.");
    stop(1);
  } else
    start([
      "node_modules/vite/bin/vite.js",
      "--config",
      "apps/studio/vite.config.ts",
    ]);
}
