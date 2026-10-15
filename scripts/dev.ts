import { spawn } from "node:child_process";
const children = [
  spawn("pnpm", ["exec", "tsx", "services/gateway/src/server.ts"], {
    stdio: "inherit",
  }),
  spawn("pnpm", ["exec", "vite", "--config", "apps/studio/vite.config.ts"], {
    stdio: "inherit",
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
