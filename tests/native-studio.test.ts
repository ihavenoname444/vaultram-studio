import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ABI, Serializer, PrivateKey } from "@wharfkit/antelope";
import {
  AuthorityGateway,
  nativePayload,
  assertGrant,
} from "../services/gateway/src/authority.ts";
import { JUNGLE4 } from "../packages/core/src/index.ts";
const available = existsSync("contracts/build/authority/authority.abi");
if (process.env.REQUIRE_AUTHORITY === "1" && !available)
  throw Error("Authority ABI required");
const abiBytes = available
  ? readFileSync("contracts/build/authority/authority.abi")
  : Buffer.from("{}");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function configured(dir: string) {
  return new AuthorityGateway(
    {
      account: "authority111",
      actor: "agent1111111",
      permission: "vrstudio",
      grantId: "1",
      space: "memory",
      privateKey: String(PrivateKey.generate("K1")),
      codeHash: "a".repeat(64),
      abiHash: hash(
        Serializer.encode({ object: ABI.from(JSON.parse(abiBytes.toString())) })
          .array,
      ),
      abiJsonHash: hash(abiBytes),
      rpc: "https://jungle4.greymass.com",
      independent: "https://jungle4.cryptolions.io",
    },
    dir,
    abiBytes,
  );
}
const grant = {
  id: 1,
  actor: "agent1111111",
  space: "memory",
  available: 5,
  expires: 2000000000,
  max_payload: 256,
  revoked: 0,
};
function prepareMocks(g: AuthorityGateway) {
  vi.spyOn(g, "pins").mockResolvedValue({});
  vi.spyOn(g, "permission").mockResolvedValue();
  vi.spyOn(g, "table").mockResolvedValue([grant]);
  vi.spyOn(g.client.v1.chain, "get_info").mockResolvedValue({
    chain_id: JUNGLE4,
    getTransactionHeader: () => ({
      expiration: new Date(Date.now() + 120000).toISOString().slice(0, -1),
      ref_block_num: 1,
      ref_block_prefix: 2,
    }),
  } as any);
}
describe.skipIf(!available)("native Studio safety", () => {
  it("counts UTF-8 payload bytes and binds the application", () => {
    expect(
      JSON.parse(nativePayload({ appId: "42", text: "hello" })).appId,
    ).toBe("42");
    expect(() => nativePayload({ appId: "42", text: "🦁".repeat(60) })).toThrow(
      "256",
    );
    expect(() =>
      nativePayload({ appId: "42", text: "hi", actor: "forged" }),
    ).toThrow();
  });
  it("fails closed on actor, namespace, expiry, revocation and exhaustion", () => {
    const c = { actor: grant.actor, space: "memory", grantId: "1" };
    expect(() => assertGrant(grant, c, 100)).not.toThrow();
    for (const patch of [
      { actor: "forged" },
      { space: "treasury" },
      { expires: 100 },
      { revoked: 1 },
      { available: 0 },
      { id: 2 },
    ])
      expect(() => assertGrant({ ...grant, ...patch }, c, 100)).toThrow();
  });
  it("persists before broadcast and never resends after timeout or restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-studio-"));
    let g = configured(dir);
    try {
      prepareMocks(g);
      const review = await g.prepare({ appId: "42", text: "lost response" });
      const broadcast = vi
        .spyOn(g.client.v1.chain, "send_transaction")
        .mockImplementation(async () => {
          expect(g.row(review.id).status).toBe("PENDING");
          throw Error("timeout after accepting");
        });
      vi.spyOn(g, "rpc").mockRejectedValue(Error("Unavailable"));
      expect((await g.submit(review.id, review.payloadHash)).status).toBe(
        "UNKNOWN",
      );
      expect((await g.submit(review.id, review.payloadHash)).status).toBe(
        "UNKNOWN",
      );
      expect(broadcast).toHaveBeenCalledTimes(1);
      await expect(g.prepare({ appId: "42", text: "second" })).rejects.toThrow(
        "unresolved",
      );
      const originalConfig = g.c;
      g.close();
      g = new AuthorityGateway(originalConfig, dir, abiBytes);
      prepareMocks(g);
      vi.spyOn(g, "rpc").mockRejectedValue(Error("Unavailable"));
      const afterRestart = vi.spyOn(g.client.v1.chain, "send_transaction");
      expect((await g.submit(review.id, review.payloadHash)).status).toBe(
        "UNKNOWN",
      );
      expect(afterRestart).not.toHaveBeenCalled();
    } finally {
      g.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects substituted review hashes and cannot broadcast an expired review", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-studio-"));
    const g = configured(dir);
    try {
      prepareMocks(g);
      const r = await g.prepare({ appId: "42", text: "review" });
      const send = vi.spyOn(g.client.v1.chain, "send_transaction");
      await expect(g.submit(r.id, "b".repeat(64))).rejects.toThrow(
        "Reviewed payload",
      );
      const future = Date.now() + 130000;
      const clock = vi.spyOn(Date, "now").mockReturnValue(future);
      try {
        await expect(g.submit(r.id, r.payloadHash)).rejects.toThrow("expired");
      } finally {
        clock.mockRestore();
      }
      expect(send).not.toHaveBeenCalled();
    } finally {
      g.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects a journal from another deployment and tampered signed actions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-studio-"));
    const g = configured(dir);
    try {
      prepareMocks(g);
      const r = await g.prepare({ appId: "42", text: "binding" });
      expect(
        () =>
          new AuthorityGateway(
            { ...g.c, account: "another11111" },
            dir,
            abiBytes,
          ),
      ).toThrow("configuration mismatch");
      const row = g.row(r.id),
        tx = JSON.parse(row.transaction_json);
      tx.actions[0].account = "another11111";
      g.db
        .prepare("UPDATE native_ops SET transaction_json=? WHERE id=?")
        .run(JSON.stringify(tx), r.id);
      await expect(g.submit(r.id, r.payloadHash)).rejects.toThrow(
        "binding mismatch",
      );
    } finally {
      g.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("requires correct chain and code pins before accepting RPC state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-studio-"));
    const g = configured(dir);
    try {
      vi.spyOn(g, "rpc").mockResolvedValue({ chain_id: "wrong" });
      await expect(g.pins(g.c.rpc)).rejects.toThrow("Wrong authority chain");
      vi.mocked(g.rpc).mockImplementation(async (_u, m) =>
        m === "get_info" ? { chain_id: JUNGLE4 } : { code_hash: "wrong" },
      );
      await expect(g.pins(g.c.rpc)).rejects.toThrow("code pin");
    } finally {
      g.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
