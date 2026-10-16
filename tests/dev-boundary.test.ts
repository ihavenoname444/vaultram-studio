import { it, expect } from "vitest";
import { createServer } from "vite";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

it("serves the Studio but blocks private files, raw imports, symlinks and cross-origin reads", async () => {
  // Synthetic canaries only: never request an actual credential over HTTP.
  mkdirSync(".data", { recursive: true });
  const dir = mkdtempSync(resolve(".data/http-canary-"));
  const canary = randomUUID();
  const secret = join(dir, "operator.json");
  const alias = resolve("apps/studio/canary-" + canary + ".json");
  const publicAlias = resolve(
    "apps/studio/public/public-canary-" + canary + ".json",
  );
  writeFileSync(secret, canary);
  symlinkSync(secret, alias);
  symlinkSync(secret, publicAlias);
  const server = await createServer({
    configFile: resolve("apps/studio/vite.config.ts"),
    logLevel: "silent",
    server: { port: 0, open: false, watch: null },
  });
  try {
    await server.listen();
    const port = (server.httpServer!.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const index = await fetch(base);
    expect(index.status).toBe(200);
    expect(index.headers.get("x-frame-options")).toBe("DENY");
    expect(index.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    for (const path of [
      "/@fs/" + secret,
      "/@fs/" + secret + "?raw",
      "/@fs/" + secret + "?url",
      "/canary-" + canary + ".json",
      "/canary-" + canary + ".json?raw",
      "/public-canary-" + canary + ".json",
      "/@fs/" + secret.replace(".data", "%2edata"),
    ]) {
      const r = await fetch(base + path);
      const body = await r.text();
      expect(body.trim(), path).not.toBe(canary);
      expect(body).not.toContain(`export default "${canary}"`);
      expect(r.status, path).toBe(403);
    }
    for (const origin of ["https://evil.example", "http://localhost:45678"]) {
      const r = await fetch(base + "/src/main.tsx", { headers: { origin } });
      expect(r.status).toBe(200);
      expect(r.headers.get("access-control-allow-origin")).toBeNull();
    }
  } finally {
    await server.close();
    rmSync(alias, { force: true });
    rmSync(publicAlias, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
