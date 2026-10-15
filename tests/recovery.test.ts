import { afterEach, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../services/gateway/src/server.ts";
import { Jungle } from "../services/gateway/src/chain.ts";
import { JUNGLE4 } from "../packages/core/src/index.ts";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it.each([
  "reserved",
  "prepared",
  "before_accept",
  "after_accept",
  "before_receipt",
])(
  "survives SIGKILL at %s without rebroadcasting or releasing an uncertain nonce",
  async (stage) => {
    const directory = mkdtempSync(join(tmpdir(), "vaultram-crash-"));
    const env = {
      VAULTA_RPC: "https://unused.example",
      VAULTA_RUNTIME: "runtime11111",
      VAULTA_RELAYER: "relayacct111",
      VAULTA_RELAYER_PRIVATE_KEY: "unused-fake-chain-only",
      VAULTA_CODE_HASH: "ab".repeat(32),
      VAULTA_ABI_HASH: "cd".repeat(32),
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    let s: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", "tests/fixtures/crash-worker.ts", directory, stage],
        { env: { ...process.env, ...env }, encoding: "utf8", timeout: 10000 },
      );
      expect(child.signal, child.stderr).toBe("SIGKILL");
      const { hash, intent } = JSON.parse(
        readFileSync(directory + "/expected.json", "utf8"),
      );
      const accepted = existsSync(directory + "/fake-chain.json");
      vi.spyOn(Jungle.prototype, "check").mockResolvedValue({
        chain_id: JUNGLE4,
      });
      vi.spyOn(Jungle.prototype, "nextNonce").mockResolvedValue(
        accepted ? "2" : "1",
      );
      vi.spyOn(Jungle.prototype, "inclusionBlock").mockResolvedValue(
        accepted ? 101 : null,
      );
      vi.spyOn(Jungle.prototype, "finality").mockResolvedValue(accepted);
      const broadcast = vi
        .spyOn(Jungle.prototype, "broadcast")
        .mockRejectedValue(new Error("MUST NOT REBROADCAST"));
      s = await createServer({ directory, mode: "JUNGLE4" });
      const persisted = s.store.get(hash)!;
      expect(persisted.intent).toEqual(intent);
      expect(Boolean(persisted.prepared)).toBe(stage !== "reserved");
      const headers = { host: "127.0.0.1", "x-vaultram-token": s.token };
      const reconciled = await s.server.inject({
        method: "POST",
        url: "/api/reconcile",
        headers,
        payload: { hash },
      });
      expect(reconciled.statusCode).toBe(200);
      expect(reconciled.json().status).toBe(
        accepted
          ? "IRREVERSIBLE"
          : stage === "reserved"
            ? "RESERVED"
            : "UNKNOWN",
      );
      const repeated = await s.server.inject({
        method: "POST",
        url: "/api/execute",
        headers,
        payload: { intent, signature: persisted.signature },
      });
      expect(repeated.statusCode).toBe(200);
      expect(broadcast).not.toHaveBeenCalled();
      if (accepted)
        vi.spyOn(Jungle.prototype, "nextNonce").mockResolvedValue("1");
      const next = await s.server.inject({
        method: "POST",
        url: "/api/intent",
        headers,
        payload: {
          appId: intent.appId,
          owner: intent.owner,
          sourceChainId: 1,
          payload: {
            action: "createagent",
            id: "2",
            name: "Next",
            description: "Public",
          },
        },
      });
      expect(next.statusCode).toBe(400);
      expect(next.json().error).toContain(
        accepted ? "behind local" : "unresolved",
      );
      expect(() =>
        s!.store.reserve("different", intent, persisted.signature),
      ).toThrow();
      if (accepted)
        expect(
          JSON.parse(readFileSync(directory + "/fake-chain.json", "utf8"))
            .writes,
        ).toBe(1);
    } finally {
      await s?.server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
