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
  it("refuses to display current authority if the independent RPC observes widened permission links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-studio-"));
    const g = configured(dir);
    try {
      vi.spyOn(g, "pins").mockResolvedValue({});
      const tables = vi.spyOn(g, "table");
      const rpc = vi.spyOn(g, "rpc").mockResolvedValue({
        permissions: [
          {
            perm_name: g.c.permission,
            parent: "active",
            required_auth: {
              threshold: 1,
              keys: [
                {
                  key: String(PrivateKey.from(g.c.privateKey).toPublic()),
                  weight: 1,
                },
              ],
              accounts: [],
              waits: [],
            },
            linked_actions: ["reserve", "consume", "grant"].map((action) => ({
              account: g.c.account,
              action,
            })),
          },
        ],
      });
      await expect(g.state()).rejects.toThrow("permission links mismatch");
      expect(rpc).toHaveBeenCalledWith(g.c.independent, "get_account", {
        account_name: g.c.actor,
      });
      expect(tables).not.toHaveBeenCalled();
    } finally {
      g.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
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
      { available: undefined },
      { expires: "not-a-time" },
      { max_payload: 257 },
      { revoked: "false" },
    ])
      expect(() => assertGrant({ ...grant, ...patch }, c, 100)).toThrow();
  });
  it("blocks an already prepared second operation after an ambiguous first submission", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-studio-"));
    const g = configured(dir);
    try {
      prepareMocks(g);
      const a = await g.prepare({ appId: "42", text: "first" });
      const b = await g.prepare({
        appId: "42",
        text: "prepared before timeout",
      });
      const send = vi
        .spyOn(g.client.v1.chain, "send_transaction")
        .mockRejectedValue(Error("timeout"));
      vi.spyOn(g, "rpc").mockRejectedValue(Error("unavailable"));
      await g.submit(a.id, a.payloadHash);
      await expect(g.submit(b.id, b.payloadHash)).rejects.toThrow("unresolved");
      expect(send).toHaveBeenCalledTimes(1);
      expect(g.row(b.id).status).toBe("PREPARED");
    } finally {
      g.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("atomically prevents competing prepared submissions across journal connections", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-studio-"));
    const g = configured(dir),
      other = new AuthorityGateway(g.c, dir, abiBytes);
    try {
      prepareMocks(g);
      prepareMocks(other);
      const a = await g.prepare({ appId: "42", text: "first" });
      const b = await other.prepare({ appId: "42", text: "second" });
      const sendA = vi
        .spyOn(g.client.v1.chain, "send_transaction")
        .mockRejectedValue(Error("timeout"));
      const sendB = vi
        .spyOn(other.client.v1.chain, "send_transaction")
        .mockRejectedValue(Error("timeout"));
      vi.spyOn(g, "rpc").mockRejectedValue(Error("unavailable"));
      vi.spyOn(other, "rpc").mockRejectedValue(Error("unavailable"));
      const results = await Promise.allSettled([
        g.submit(a.id, a.payloadHash),
        other.submit(b.id, b.payloadHash),
      ]);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(sendA.mock.calls.length + sendB.mock.calls.length).toBe(1);
    } finally {
      other.close();
      g.close();
      rmSync(dir, { recursive: true, force: true });
    }
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
  it("rejects broadened native permissions, extra links and indirect authority reuse", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-studio-"));
    const g = configured(dir);
    const pub = String(PrivateKey.from(g.c.privateKey).toPublic());
    const permission = {
      perm_name: "vrstudio",
      parent: "active",
      required_auth: {
        threshold: 1,
        keys: [{ key: pub, weight: 1 }],
        accounts: [],
        waits: [],
      },
      linked_actions: ["reserve", "consume"].map((action) => ({
        account: g.c.account,
        action,
      })),
    };
    const read = vi.spyOn(g, "rpc");
    try {
      read.mockResolvedValue({ permissions: [permission] });
      await expect(g.permission()).resolves.toBeUndefined();
      for (const patch of [
        { parent: "owner" },
        { required_auth: { ...permission.required_auth, threshold: 0 } },
        {
          required_auth: {
            ...permission.required_auth,
            keys: [
              { key: String(PrivateKey.generate("K1").toPublic()), weight: 1 },
            ],
          },
        },
        {
          required_auth: {
            ...permission.required_auth,
            waits: [{ wait_sec: 1, weight: 1 }],
          },
        },
        {
          linked_actions: [
            ...permission.linked_actions,
            { account: "eosio.token", action: "transfer" },
          ],
        },
      ]) {
        read.mockResolvedValue({ permissions: [{ ...permission, ...patch }] });
        await expect(g.permission()).rejects.toThrow();
      }
      for (const auth of [
        permission.required_auth,
        {
          threshold: 1,
          keys: [],
          waits: [],
          accounts: [
            {
              permission: { actor: g.c.actor, permission: g.c.permission },
              weight: 1,
            },
          ],
        },
      ]) {
        read.mockResolvedValue({
          permissions: [
            permission,
            { perm_name: "active", required_auth: auth },
          ],
        });
        await expect(g.permission()).rejects.toThrow();
      }
    } finally {
      g.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
