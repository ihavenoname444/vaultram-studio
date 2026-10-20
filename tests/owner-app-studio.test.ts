import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ABI, PrivateKey, Serializer, Transaction } from "@wharfkit/antelope";
import {
  OwnerRevoke,
  singleOwnerKey,
} from "../services/gateway/src/owner-revoke.ts";
import {
  API,
  Name,
  Transaction as VertTransaction,
} from "@wharfkit/antelope-vert";
import { Blockchain } from "@vaulta/vert";
import {
  AuthorityGateway,
  nativePayload,
} from "../services/gateway/src/authority.ts";
import {
  AppBinding,
  assertAppBinding,
  assertAppEffect,
} from "../packages/core/src/app-authority.ts";
import { compile, exampleSpec, JUNGLE4 } from "../packages/core/src/index.ts";

const dir = "contracts/build/owner-app/";
const available =
  existsSync(dir + "authority.wasm") && existsSync(dir + "authority.abi");
if (process.env.REQUIRE_OWNER_APP === "1" && !available)
  throw Error("Owner/app build required");
const hash = (x: Uint8Array) => createHash("sha256").update(x).digest("hex");

// Actual gateway transactions execute in the WASM VM. Network/finality responses
// are fixtures here; these tests are not claimed as live Jungle4 evidence.
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "owner-app-studio-"));
  const app = compile(exampleSpec),
    owner = "owner1111111",
    actor = "agent1111111";
  const ownerKey = PrivateKey.generate("K1");
  const ownerAccount = {
    account_name: owner,
    permissions: [
      {
        perm_name: "active",
        parent: "owner",
        required_auth: {
          threshold: 1,
          keys: [{ key: String(ownerKey.toPublic()), weight: 1 }],
          accounts: [],
          waits: [],
        },
      },
    ],
  };
  const abiBytes = readFileSync(dir + "authority.abi"),
    wasm = readFileSync(dir + "authority.wasm");
  const abi = ABI.from(JSON.parse(abiBytes.toString()));
  const c = {
    account: "authority111",
    actor,
    permission: "vrstudio",
    grantId: "1",
    space: "memory",
    appBinding: { appId: app.appId, owner, appHash: app.appHash.slice(2) },
    privateKey: String(PrivateKey.generate("K1")),
    codeHash: hash(wasm),
    abiHash: hash(Serializer.encode({ object: abi }).array),
    abiJsonHash: hash(abiBytes),
    rpc: "https://jungle4.greymass.com" as const,
    independent: "https://jungle4.cryptolions.io" as const,
  };
  const bc = new Blockchain();
  bc.createAccounts(owner, actor);
  const a = bc.getAccount(Name.from(actor))!;
  a.permissions.push(
    API.v1.AccountPermission.from({
      perm_name: c.permission,
      parent: "active",
      required_auth: a.permissions[1].required_auth,
    }),
  );
  const contract = bc.createAccount({
    name: c.account,
    abi: JSON.parse(abiBytes.toString()),
    wasm,
  });
  await contract.actions.init({ principal: owner, total: 100 }).send([
    { actor: c.account, permission: "active" },
    { actor: owner, permission: "active" },
  ]);
  await contract.actions
    .regapp({ id: app.appId, owner, app_hash: c.appBinding.appHash })
    .send(owner + "@active");
  await contract.actions
    .grant({
      id: 1,
      app_id: app.appId,
      actor,
      actor_permission: c.permission,
      space: c.space,
      budget: 10,
      expires: 2000000000,
      max_payload: 256,
    })
    .send(owner + "@active");
  const rows = (table: string): any[] =>
    contract.tables[table](contract.toBigInt()).getTableRows();
  const g = new AuthorityGateway(c, directory, abiBytes, "create");
  vi.spyOn(g, "pins").mockResolvedValue({ last_irreversible_block_num: 10 });
  vi.spyOn(g, "permission").mockResolvedValue();
  vi.spyOn(g, "table").mockImplementation(async (table) => rows(table));
  vi.spyOn(g.client.v1.chain, "get_info").mockResolvedValue({
    chain_id: JUNGLE4,
    getTransactionHeader: () => ({
      expiration: new Date(Date.now() + 120000).toISOString().slice(0, -1),
      ref_block_num: 1,
      ref_block_prefix: 2,
    }),
  } as any);
  const send = vi
    .spyOn(g.client.v1.chain, "send_transaction")
    .mockImplementation(async (signed: any) => {
      await bc.applyTransaction(
        VertTransaction.from(JSON.parse(JSON.stringify(signed.transaction))),
      );
      return {} as any; // no fabricated RAM trace
    });
  vi.spyOn(g, "rpc").mockImplementation(async (_base, method, body: any) => {
    if (method === "get_account") return ownerAccount;
    if (method === "get_transaction_status")
      return {
        state: "IRREVERSIBLE",
        block_number: 10,
        block_id: "b".repeat(64),
      };
    if (method === "get_block")
      return {
        block_num: 10,
        id: "b".repeat(64),
        transactions: [
          ...g.list().map((o) => o.txid),
          ...(g.db
            .prepare(
              "SELECT name FROM sqlite_master WHERE name='native_owner_ops'",
            )
            .get()
            ? (
                g.db
                  .prepare(
                    "SELECT request FROM native_owner_ops WHERE status!='PREPARED'",
                  )
                  .all() as any[]
              ).map((r) => JSON.parse(r.request).transactionId)
            : []),
        ].map((id) => ({ status: "executed", trx: { id } })),
      };
    throw Error("Unexpected test RPC");
  });
  return {
    g,
    directory,
    abiBytes,
    ownerKey,
    ownerAccount,
    app,
    c,
    contract,
    rows,
    send,
    cleanup: () => {
      g.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

describe.skipIf(!available)("owner/app Studio integration", () => {
  it.each(["native", "owner"])(
    "%s late failed reconciliation preserves concurrent finalization",
    async (kind) => {
      const t = await setup();
      try {
        const service = kind === "native" ? t.g : new OwnerRevoke(t.g);
        const r =
          kind === "native"
            ? await t.g.prepare({ appId: t.app.appId, text: "one effect" })
            : await (service as OwnerRevoke).prepare();
        if (kind === "native") await t.g.submit(r.id, (r as any).payloadHash);
        else
          await (service as OwnerRevoke).submit(r.id, [
            String(
              t.ownerKey.signDigest(
                Transaction.from((r as any).transaction).signingDigest(JUNGLE4),
              ),
            ),
          ]);
        const table = kind === "native" ? "native_ops" : "native_owner_ops";
        t.g.db
          .prepare(
            "UPDATE " +
              table +
              " SET status='UNKNOWN',evidence=NULL WHERE id=?",
          )
          .run(r.id);
        let rejectSlow!: (e: Error) => void;
        vi.mocked(t.g.pins).mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectSlow = reject;
            }),
        );
        const slow = service.reconcile(r.id);
        expect((await service.reconcile(r.id)).status).toBe("IRREVERSIBLE");
        rejectSlow(Error("late timeout"));
        expect(await slow).toMatchObject({
          status: "IRREVERSIBLE",
          verificationUnavailable: true,
        });
        expect(service.row(r.id).status).toBe("IRREVERSIBLE");
        expect(service.row(r.id).evidence).toBeTruthy();
        expect(t.send).toHaveBeenCalledTimes(1);
      } finally {
        t.cleanup();
      }
    },
  );
  it.each(["native", "owner"])(
    "%s late lost send response cannot erase independently reconciled finality",
    async (kind) => {
      const t = await setup();
      try {
        const service = kind === "native" ? t.g : new OwnerRevoke(t.g);
        const r =
          kind === "native"
            ? await t.g.prepare({ appId: t.app.appId, text: "one" })
            : await (service as OwnerRevoke).prepare();
        const execute = t.send.getMockImplementation()!;
        let lose!: (e: Error) => void;
        t.send.mockImplementationOnce(async (tx) => {
          await execute(tx);
          return new Promise((_resolve, reject) => {
            lose = reject;
          });
        });
        const pending =
          kind === "native"
            ? t.g.submit(r.id, (r as any).payloadHash)
            : (service as OwnerRevoke).submit(r.id, [
                String(
                  t.ownerKey.signDigest(
                    Transaction.from((r as any).transaction).signingDigest(
                      JUNGLE4,
                    ),
                  ),
                ),
              ]);
        await vi.waitFor(() => expect(lose).toBeTypeOf("function"));
        expect((await service.reconcile(r.id)).status).toBe("IRREVERSIBLE");
        vi.mocked(t.g.pins).mockRejectedValue(Error("stale/offline RPC"));
        lose(Error("response lost after execution"));
        const result = await pending;
        expect(result.status).toBe("IRREVERSIBLE");
        expect(result.lifecycle).toMatchObject({
          state: "FINALIZED",
          nextAction: "RECONCILE",
          submissionBlockCleared: false,
        });
        expect(service.row(r.id).evidence).toBeTruthy();
        expect(t.send).toHaveBeenCalledTimes(1);
      } finally {
        t.cleanup();
      }
    },
  );
  it.each(["UNKNOWN", "IN_BLOCK", "FORKED", "FAILED"])(
    "keeps ambiguous submission blocked on RPC status %s until corroborated finality",
    async (state) => {
      const t = await setup();
      try {
        const r = await t.g.prepare({ appId: t.app.appId, text: "one effect" });
        const rpc = vi.mocked(t.g.rpc),
          original = rpc.getMockImplementation()!;
        rpc.mockImplementation(async (base, method, body) =>
          method === "get_transaction_status"
            ? { state }
            : original(base, method, body),
        );
        const submitted = await t.g.submit(r.id, r.payloadHash);
        expect(submitted.lifecycle).toMatchObject({
          state: "SUBMITTED",
          nextAction: "RECONCILE",
          submissionBlockCleared: false,
          automaticRebroadcast: false,
        });
        expect(t.rows("effects")).toHaveLength(1);
        for (let i = 0; i < 3; i++) {
          expect((await t.g.submit(r.id, r.payloadHash)).status).not.toBe(
            "IRREVERSIBLE",
          );
          await t.g.reconcile(r.id);
        }
        await expect(
          t.g.prepare({ appId: t.app.appId, text: "second" }),
        ).rejects.toThrow("unresolved");
        rpc.mockImplementation(original);
        vi.mocked(t.g.pins).mockResolvedValueOnce({
          last_irreversible_block_num: 9,
        });
        expect((await t.g.reconcile(r.id)).status).toBe("UNKNOWN");
        expect((await t.g.reconcile(r.id)).lifecycle).toMatchObject({
          state: "FINALIZED",
          nextAction: "STOP",
          submissionBlockCleared: true,
        });
        rpc.mockRejectedValue(Error("stale observation"));
        expect((await t.g.reconcile(r.id)).lifecycle).toMatchObject({
          state: "FINALIZED",
          nextAction: "RECONCILE",
          submissionBlockCleared: false,
        });
        expect(t.send).toHaveBeenCalledTimes(1);
        expect(t.rows("effects")).toHaveLength(1);
      } finally {
        t.cleanup();
      }
    },
  );
  it("owner prepare rechecks unresolved requests after network awaits", async () => {
    const t = await setup();
    try {
      const owner = new OwnerRevoke(t.g),
        first = await owner.prepare();
      const head = await t.g.client.v1.chain.get_info();
      let release!: () => void;
      vi.mocked(t.g.client.v1.chain.get_info).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(head);
          }),
      );
      const pending = owner.prepare();
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      t.send.mockRejectedValue(Error("timeout"));
      // Signature validation/key lookup still succeeds; only finality observation fails.
      const rpc = vi.mocked(t.g.rpc),
        original = rpc.getMockImplementation()!;
      rpc.mockImplementation(async (base, method, body) => {
        if (method === "get_transaction_status") throw Error("offline");
        return original(base, method, body);
      });
      await owner.submit(first.id, [
        String(
          t.ownerKey.signDigest(
            Transaction.from(first.transaction).signingDigest(JUNGLE4),
          ),
        ),
      ]);
      release();
      await expect(pending).rejects.toThrow("unresolved");
      expect(owner.list()).toHaveLength(1);
    } finally {
      t.cleanup();
    }
  });
  it("actual WASM rejection has no effect but an RPC failure cannot release the uncertain journal", async () => {
    const t = await setup();
    try {
      const r = await t.g.prepare({
        appId: t.app.appId,
        text: "revoked during broadcast",
      });
      const execute = t.send.getMockImplementation()!;
      t.send.mockImplementationOnce(async (tx) => {
        await t.contract.actions
          .revoke({ grant_id: 1 })
          .send(t.c.appBinding.owner + "@active");
        return execute(tx); // actual WASM refuses the now-revoked grant
      });
      const result = await t.g.submit(r.id, r.payloadHash);
      expect(result.lifecycle).toMatchObject({
        state: "UNKNOWN",
        nextAction: "RECONCILE",
        submissionBlockCleared: false,
      });
      expect(t.rows("effects")).toHaveLength(0);
      expect(t.rows("reservations")).toHaveLength(0);
      await t.g.submit(r.id, r.payloadHash);
      await expect(
        t.g.prepare({ appId: t.app.appId, text: "new" }),
      ).rejects.toThrow("unresolved");
      expect(t.send).toHaveBeenCalledTimes(1);
    } finally {
      t.cleanup();
    }
  });
  it("owner can revoke even when operational permission is unhealthy", async () => {
    const t = await setup();
    try {
      vi.mocked(t.g.permission).mockRejectedValue(
        Error("Agent permission widened"),
      );
      await expect(t.g.state()).rejects.toThrow("widened");
      const owner = new OwnerRevoke(t.g),
        r = await owner.prepare();
      const signature = String(
        t.ownerKey.signDigest(
          Transaction.from(r.transaction).signingDigest(JUNGLE4),
        ),
      );
      expect((await owner.submit(r.id, [signature])).status).toBe(
        "IRREVERSIBLE",
      );
    } finally {
      t.cleanup();
    }
  });
  it("refuses owner authority that reuses the gateway operational key", async () => {
    const t = await setup();
    try {
      t.ownerAccount.permissions[0].required_auth.keys[0].key = String(
        PrivateKey.from(t.c.privateKey).toPublic(),
      );
      await expect(new OwnerRevoke(t.g).prepare()).rejects.toThrow(
        "must differ",
      );
      expect(t.send).not.toHaveBeenCalled();
    } finally {
      t.cleanup();
    }
  });
  it("external owner signs exact revoke; real WASM revokes, rejects subsequent agent execution and cannot replay through gateway", async () => {
    const t = await setup();
    try {
      const owner = new OwnerRevoke(t.g),
        r = await owner.prepare();
      expect(JSON.stringify(r)).not.toContain(String(t.ownerKey));
      const signed = [
        String(
          t.ownerKey.signDigest(
            Transaction.from(r.transaction).signingDigest(JUNGLE4),
          ),
        ),
      ];
      expect((await owner.submit(r.id, signed)).status).toBe("IRREVERSIBLE");
      expect(t.rows("grants")[0].revoked).toBe(true);
      await expect(
        t.g.prepare({ appId: t.app.appId, text: "after revoke" }),
      ).rejects.toThrow("revoked");
      expect((await owner.submit(r.id, signed)).status).toBe("IRREVERSIBLE");
      expect(t.send).toHaveBeenCalledTimes(1);
    } finally {
      t.cleanup();
    }
  });
  it("external owner can revoke when operational permission guard is unsafe", async () => {
    const t = await setup();
    try {
      vi.mocked(t.g.permission).mockRejectedValue(
        Error("Restricted native permission must have no children"),
      );
      const owner = new OwnerRevoke(t.g),
        r = await owner.prepare();
      const signatures = [
        String(
          t.ownerKey.signDigest(
            Transaction.from(r.transaction).signingDigest(JUNGLE4),
          ),
        ),
      ];
      expect((await owner.submit(r.id, signatures)).status).toBe(
        "IRREVERSIBLE",
      );
      expect(t.rows("grants")[0].revoked).toBe(true);
      expect(t.g.permission).not.toHaveBeenCalled();
    } finally {
      t.cleanup();
    }
  });
  it("rejects wrong signer, wrong chain, altered action, expiry and rotated/unsupported owner authority before broadcast", async () => {
    const t = await setup();
    try {
      const owner = new OwnerRevoke(t.g),
        r = await owner.prepare(),
        tx = Transaction.from(r.transaction);
      const sig = (key: PrivateKey, chain = JUNGLE4) => [
        String(key.signDigest(tx.signingDigest(chain))),
      ];
      await expect(
        owner.submit(r.id, sig(PrivateKey.generate("K1"))),
      ).rejects.toThrow("signature");
      await expect(
        owner.submit(r.id, sig(t.ownerKey, "a".repeat(64))),
      ).rejects.toThrow("signature");
      expect(() =>
        owner.validate({
          ...r,
          transaction: { ...r.transaction, actions: [] },
        }),
      ).toThrow("binding");
      t.ownerAccount.permissions[0].required_auth.keys[0].key = String(
        PrivateKey.generate("K1").toPublic(),
      );
      await expect(owner.submit(r.id, sig(t.ownerKey))).rejects.toThrow(
        "changed",
      );
      for (const patch of [
        { threshold: 2 },
        { waits: [{ wait_sec: 1, weight: 1 }] },
        {
          accounts: [
            { permission: { actor: "other", permission: "active" }, weight: 1 },
          ],
        },
      ]) {
        expect(() =>
          singleOwnerKey(
            {
              ...t.ownerAccount,
              permissions: [
                {
                  ...t.ownerAccount.permissions[0],
                  required_auth: {
                    ...t.ownerAccount.permissions[0].required_auth,
                    ...patch,
                  },
                },
              ],
            },
            t.c.appBinding.owner,
          ),
        ).toThrow("1-of-1");
      }
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 130000);
      try {
        await expect(owner.submit(r.id, sig(t.ownerKey))).rejects.toThrow(
          "expired",
        );
      } finally {
        clock.mockRestore();
      }
      expect(t.send).not.toHaveBeenCalled();
    } finally {
      t.cleanup();
    }
  });
  it("owner signature accepted before lost reply is reconciled without resend, even after restart", async () => {
    const t = await setup();
    let reopened: AuthorityGateway | undefined;
    try {
      const owner = new OwnerRevoke(t.g),
        r = await owner.prepare();
      const signature = [
        String(
          t.ownerKey.signDigest(
            Transaction.from(r.transaction).signingDigest(JUNGLE4),
          ),
        ),
      ];
      t.send.mockRejectedValue(Error("lost reply"));
      vi.mocked(t.g.rpc).mockImplementation(async (_u, method) => {
        if (method === "get_account") return t.ownerAccount;
        throw Error("offline");
      });
      expect((await owner.submit(r.id, signature)).status).toBe("UNKNOWN");
      reopened = new AuthorityGateway(t.c, t.directory, t.abiBytes);
      const again = new OwnerRevoke(reopened);
      vi.spyOn(reopened, "pins").mockRejectedValue(Error("offline"));
      const send = vi.spyOn(reopened.client.v1.chain, "send_transaction");
      expect((await again.submit(r.id, signature)).status).toBe("UNKNOWN");
      expect(send).not.toHaveBeenCalled();
      expect(t.send).toHaveBeenCalledTimes(1);
    } finally {
      reopened?.close();
      t.cleanup();
    }
  });
  it("restores a native export only into submission-locked reconciliation, ignoring claimed success", async () => {
    const t = await setup();
    const destination = mkdtempSync(join(tmpdir(), "native-restore-"));
    let restored: AuthorityGateway | undefined;
    try {
      const review = await t.g.prepare({
        appId: t.app.appId,
        text: "recover evidence",
      });
      const result = await t.g.submit(review.id, review.payloadHash);
      restored = new AuthorityGateway(t.c, destination, t.abiBytes, "create");
      vi.spyOn(restored, "pins").mockRejectedValue(Error("offline"));
      const send = vi.spyOn(restored.client.v1.chain, "send_transaction");
      const e = (result as any).evidence;
      expect((await restored.restoreExport(e)).status).toBe("UNKNOWN");
      await expect(
        restored.prepare({ appId: t.app.appId, text: "unsafe resume" }),
      ).rejects.toThrow("read-only");
      expect(send).not.toHaveBeenCalled();
      restored.close();
      restored = new AuthorityGateway(t.c, destination, t.abiBytes);
      vi.spyOn(restored, "pins").mockImplementation(t.g.pins);
      vi.spyOn(restored, "rpc").mockImplementation(t.g.rpc);
      vi.spyOn(restored, "table").mockImplementation(t.g.table);
      expect((await restored.reconcile(review.id)).status).toBe("IRREVERSIBLE");
      await expect(
        restored.prepare({ appId: t.app.appId, text: "still blocked" }),
      ).rejects.toThrow("read-only");
    } finally {
      restored?.close();
      t.cleanup();
      rmSync(destination, { recursive: true, force: true });
    }
  });
  it("derives the manifest from current grant state and never presents test writes as VaultRAM backing", async () => {
    const t = await setup();
    try {
      const before = await t.g.state();
      expect(before.manifest?.limits).toMatchObject({
        available: 10,
        consumed: 0,
        unit: "UNBACKED_TEST_WRITE",
      });
      expect(before.manifest?.backing).toEqual({
        status: "UNAVAILABLE",
        verified: false,
        position: null,
      });
      const review = await t.g.prepare({
        appId: t.app.appId,
        text: "test-only",
        requirement: "NATIVE_TESTNET_PROOF",
      });
      expect(review.manifest).toEqual(before.manifest);
      await t.g.submit(review.id, review.payloadHash);
      expect((await t.g.state()).manifest?.limits).toMatchObject({
        available: 9,
        consumed: 1,
      });
      await t.contract.actions
        .revoke({ grant_id: 1 })
        .send(t.c.appBinding.owner + "@active");
      expect((await t.g.state()).manifest?.limits.revoked).toBe(true);
    } finally {
      t.cleanup();
    }
  });
  it("fails closed on requested VaultRAM backing before RPC, journaling or broadcast", async () => {
    const t = await setup();
    try {
      await expect(
        t.g.prepare({
          appId: t.app.appId,
          text: "backed required",
          requirement: "VAULTRAM_BACKED",
        }),
      ).rejects.toThrow("backing unavailable");
      expect(t.g.table).not.toHaveBeenCalled();
      expect(t.g.list()).toHaveLength(0);
      expect(t.send).not.toHaveBeenCalled();
    } finally {
      t.cleanup();
    }
  });
  it("executes the gateway's signed typed app binding in WASM and checks owner/app evidence", async () => {
    const t = await setup();
    try {
      t.g.assertApp(t.app);
      const review = await t.g.prepare({
        appId: t.app.appId,
        text: "bounded native memory",
      });
      expect(JSON.parse(review.payload)).not.toHaveProperty("appId");
      const result = await t.g.submit(review.id, review.payloadHash);
      expect(result.status).toBe("IRREVERSIBLE");
      const e = (result as any).evidence;
      expect(e.version).toBe(2);
      expect(e.effect.owner).toBe(t.c.appBinding.owner);
      expect(String(e.effect.app_id)).toBe(t.app.appId);
      expect(e.app.app_hash).toBe(t.c.appBinding.appHash);
      expect(e.ram.bytes).toBeNull();
      expect(Number(t.rows("grants")[0].available)).toBe(9);
      await t.g.submit(review.id, review.payloadHash);
      expect(t.send).toHaveBeenCalledTimes(1);
      expect(t.rows("effects")).toHaveLength(1);
    } finally {
      t.cleanup();
    }
  });
  it("rejects wrong compiled app/hash and typed app before signing", async () => {
    const t = await setup();
    try {
      expect(() =>
        t.g.assertApp({ ...t.app, appHash: "0x" + "f".repeat(64) }),
      ).toThrow("Compiled app");
      expect(() => t.g.assertApp({ ...t.app, appId: "42" })).toThrow(
        "Compiled app",
      );
      await expect(
        t.g.prepare({ appId: "42", text: "cross app" }),
      ).rejects.toThrow("outside grant");
      vi.mocked(t.g.table).mockImplementation(async (table) =>
        table === "apps"
          ? [{ ...t.rows(table)[0], owner: t.c.actor }]
          : t.rows(table),
      );
      await expect(
        t.g.prepare({ appId: t.app.appId, text: "wrong registry" }),
      ).rejects.toThrow("binding mismatch");
      expect(t.g.list()).toHaveLength(0);
      expect(t.send).not.toHaveBeenCalled();
    } finally {
      t.cleanup();
    }
  });
  it("rechecks revocation at submission after review, without broadcasting", async () => {
    const t = await setup();
    try {
      const review = await t.g.prepare({
        appId: t.app.appId,
        text: "will revoke",
      });
      await t.contract.actions
        .revoke({ grant_id: 1 })
        .send(t.c.appBinding.owner + "@active");
      await expect(t.g.submit(review.id, review.payloadHash)).rejects.toThrow(
        "revoked",
      );
      expect(t.send).not.toHaveBeenCalled();
      expect(t.rows("effects")).toHaveLength(0);
    } finally {
      t.cleanup();
    }
  });
  it("refuses substituted app/owner/grant evidence instead of confirming success", async () => {
    const t = await setup();
    try {
      const review = await t.g.prepare({
        appId: t.app.appId,
        text: "verify attribution",
      });
      vi.mocked(t.g.table).mockImplementation(async (table) =>
        table === "effects"
          ? t.rows(table).map((e) => ({ ...e, owner: t.c.actor }))
          : t.rows(table),
      );
      expect((await t.g.submit(review.id, review.payloadHash)).status).toBe(
        "UNKNOWN",
      );
      expect(t.rows("effects")).toHaveLength(1);
      expect(t.send).toHaveBeenCalledTimes(1);
      vi.mocked(t.g.table).mockImplementation(async (table) => t.rows(table));
      expect((await t.g.reconcile(review.id)).status).toBe("IRREVERSIBLE");
      expect(t.send).toHaveBeenCalledTimes(1);
      const app = t.rows("apps")[0],
        grant = t.rows("grants")[0],
        effect = t.rows("effects")[0];
      for (const patch of [
        { id: "42" },
        { owner: t.c.actor },
        { app_hash: "f".repeat(64) },
      ])
        expect(() =>
          assertAppBinding(
            { ...app, ...patch },
            grant,
            t.c.appBinding,
            t.c.actor,
            t.c.permission,
          ),
        ).toThrow();
      for (const patch of [
        { app_id: "42" },
        { owner: t.c.actor },
        { actor: t.c.appBinding.owner },
        { actor_permission: "active" },
      ])
        expect(() =>
          assertAppBinding(
            app,
            { ...grant, ...patch },
            t.c.appBinding,
            t.c.actor,
            t.c.permission,
          ),
        ).toThrow();
      for (const patch of [
        { app_id: "42" },
        { owner: t.c.actor },
        { actor_permission: "active" },
      ])
        expect(() =>
          assertAppEffect(
            { ...effect, ...patch },
            t.c.appBinding,
            t.c.permission,
          ),
        ).toThrow();
    } finally {
      t.cleanup();
    }
  });
});

it("rejects uint64 overflow and noncanonical app IDs", () => {
  for (const appId of ["0", "01", "18446744073709551616", "-1", "42.0"])
    expect(() => nativePayload({ appId, text: "hello" })).toThrow();
  expect(() =>
    AppBinding.parse({
      appId: "1",
      owner: "owner1111111",
      appHash: "a".repeat(64),
      extra: true,
    }),
  ).toThrow();
});
