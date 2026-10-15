import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../services/gateway/src/server.ts";
import { compile, exampleSpec } from "../packages/core/src/index.ts";
it("independent CLI accepts exported signatures and rejects altered receipts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vaultram-verify-"));
  const s = await createServer({ directory: dir, mode: "SIMULATED" });
  try {
    const app = compile(exampleSpec);
    s.store.putApp(app);
    s.store.deploy(app.appId);
    const headers = { host: "127.0.0.1", "x-vaultram-token": s.token };
    const result = await s.server.inject({
      method: "POST",
      url: "/api/simulate",
      headers,
      payload: {
        appId: app.appId,
        payload: {
          action: "createagent",
          id: "1",
          name: "Ephemeral test agent",
          description: "Generated inside this test only.",
        },
      },
    });
    expect(result.statusCode).toBe(200);
    const record = result.json();
    const evidence = (
      await s.server.inject({
        method: "GET",
        url: "/api/export/" + record.hash,
        headers,
      })
    ).json();
    const file = join(dir, "evidence.json"),
      key = join(dir, "public.pem");
    writeFileSync(file, JSON.stringify(evidence));
    writeFileSync(key, record.receipt.publicKey);
    const run = (path: string) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/verify.ts", path, key],
        { encoding: "utf8" },
      );
    expect(run(file).status).toBe(0);
    evidence.attestation.receipt.owner = "0x" + "ff".repeat(20);
    writeFileSync(file, JSON.stringify(evidence));
    expect(run(file).status).not.toBe(0);
  } finally {
    await s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
