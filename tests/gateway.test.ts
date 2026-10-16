import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createServer } from "../services/gateway/src/server.ts";
import {
  typedData,
  makeIntent,
  compile,
  exampleSpec,
} from "../packages/core/src/index.ts";
import { verifyReceipt } from "../services/gateway/src/receipt.ts";
const wallet = privateKeyToAccount(("0x" + "33".repeat(32)) as `0x${string}`);
const payload = {
  action: "createagent",
  id: "1",
  name: "Agent",
  description: "Description",
} as const;
describe("persistent gateway", () => {
  it("persists across restarts, deduplicates concurrent signed requests and protects scopes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "vaultram-test-"));
    let s = await createServer({ directory, mode: "SIMULATED" });
    const headers = () => ({
      host: "127.0.0.1:8787",
      "x-vaultram-token": s.token,
    });
    const post = (url: string, body: unknown) =>
      s.server.inject({
        method: "POST",
        url,
        headers: headers(),
        payload: body as object,
      });
    try {
      const app = compile(exampleSpec);
      s.store.putApp(app);
      s.store.deploy(app.appId);
      const intent = makeIntent(
        app,
        payload,
        wallet.address,
        "1",
        "vaultdemo111",
      );
      const signature = await wallet.signTypedData(typedData(intent));
      const responses = await Promise.all([
        post("/api/execute", { intent, signature }),
        post("/api/execute", { intent, signature }),
      ]);
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(s.store.rows(app.appId)).toHaveLength(1);
      const record = responses[0].json();
      expect(record.receipt.receipt.transactionId).toBeNull();
      expect(record.receipt.receipt.ram.delta).toBeNull();
      expect(record.status).toBe("SIMULATED");
      const key = record.receipt.publicKey;
      expect(verifyReceipt(record.receipt, key)).toBe(true);
      expect(
        verifyReceipt(
          {
            ...record.receipt,
            receipt: { ...record.receipt.receipt, status: "IRREVERSIBLE" },
          },
          key,
        ),
      ).toBe(false);
      const different = makeIntent(
        app,
        { ...payload, id: "2" },
        wallet.address,
        "1",
        "vaultdemo111",
      );
      expect(
        (
          await post("/api/execute", {
            intent: different,
            signature: await wallet.signTypedData(typedData(different)),
          })
        ).statusCode,
      ).toBe(400);
      await s.server.close();
      s = await createServer({ directory, mode: "SIMULATED" });
      expect(s.store.rows(app.appId)).toHaveLength(1);
      expect(s.store.nextNonce(app.appId, wallet.address.toLowerCase())).toBe(
        "2",
      );
      expect(s.store.receipts()).toHaveLength(1);
      const stranger = privateKeyToAccount(
        ("0x" + "44".repeat(32)) as `0x${string}`,
      );
      const attack = makeIntent(
        app,
        { action: "setstate", id: "1", status: "paused" },
        stranger.address,
        "1",
        "vaultdemo111",
      );
      expect(
        (
          await post("/api/execute", {
            intent: attack,
            signature: await stranger.signTypedData(typedData(attack)),
          })
        ).statusCode,
      ).toBe(400);
      expect(s.store.rows(app.appId)[0].status).toBe("active");
      expect(s.store.nextNonce(app.appId, stranger.address.toLowerCase())).toBe(
        "1",
      );
      const child = makeIntent(
        app,
        {
          action: "writemem",
          id: "2",
          agentId: "1",
          content: "Hello public memory",
        },
        wallet.address,
        "2",
        "vaultdemo111",
      );
      expect(
        (
          await post("/api/execute", {
            intent: child,
            signature: await wallet.signTypedData(typedData(child)),
          })
        ).statusCode,
      ).toBe(200);
      const update = makeIntent(
        app,
        { action: "setstate", id: "1", status: "paused" },
        wallet.address,
        "3",
        "vaultdemo111",
      );
      expect(
        (
          await post("/api/execute", {
            intent: update,
            signature: await wallet.signTypedData(typedData(update)),
          })
        ).statusCode,
      ).toBe(200);
      expect(s.store.rows(app.appId).find((r) => r.id === "1")?.status).toBe(
        "paused",
      );
      expect(
        (
          await s.server.inject({
            method: "POST",
            url: "/api/deploy",
            headers: { host: "127.0.0.1" },
            payload: { appId: app.appId },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await s.server.inject({
            method: "GET",
            url: "/api/config",
            headers: { host: "evil.example" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await s.server.inject({
            method: "GET",
            url: "/api/config",
            headers: { host: "127.0.0.1", origin: "https://evil.example" },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await s.server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("fails closed if live configuration is missing", async () => {
    await expect(
      createServer({
        directory: mkdtempSync(join(tmpdir(), "vaultram-live-")),
        mode: "JUNGLE4",
      }),
    ).rejects.toThrow("requires");
  });
});
