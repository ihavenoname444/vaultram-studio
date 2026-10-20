import { describe, it, expect, vi } from "vitest";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { ABI, PrivateKey, Serializer, Transaction } from "@wharfkit/antelope";
import {
  API,
  Name,
  Transaction as VertTransaction,
} from "@wharfkit/antelope-vert";
import { Blockchain } from "@vaulta/vert";
import { compile, exampleSpec, JUNGLE4 } from "../packages/core/src/index.ts";
import { onboardingTransaction } from "../packages/core/src/onboarding.ts";
import { AuthorityGateway } from "../services/gateway/src/authority.ts";
import { OwnerRevoke } from "../services/gateway/src/owner-revoke.ts";
import { OwnerOnboarding } from "../services/gateway/src/owner-onboarding.ts";
import {
  ownerWalletTransaction,
  verifyOwnerWalletResult,
} from "../apps/studio/src/owner-wallet.ts";

const dir = "contracts/build/owner-app/";
const available =
  existsSync(dir + "authority.wasm") && existsSync(dir + "authority.abi");
if (process.env.REQUIRE_OWNER_APP === "1" && !available)
  throw Error("Owner/app WASM required");
const sha = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
// Real WASM executes exact signed transaction bodies. RPC/finality are fixtures.
async function setup(distinct = false) {
  const directory = mkdtempSync(join(tmpdir(), "owner-onboarding-"));
  const abiBytes = readFileSync(dir + "authority.abi"),
    wasm = readFileSync(dir + "authority.wasm");
  const abi = ABI.from(JSON.parse(abiBytes.toString()));
  const owner = "owner1111111",
    actor = "agent1111111",
    allocator = distinct ? "alloc1111111" : owner;
  const keys = new Map(
    [...new Set([owner, allocator])].map((a) => [a, PrivateKey.generate("K1")]),
  );
  const app = compile(exampleSpec);
  const c = {
    account: "authority111",
    actor,
    permission: "vrapp",
    grantId: "1",
    space: "memory",
    appBinding: { appId: app.appId, appHash: app.appHash.slice(2), owner },
    privateKey: String(PrivateKey.generate("K1")),
    codeHash: sha(wasm),
    abiHash: sha(Serializer.encode({ object: abi }).array),
    abiJsonHash: sha(abiBytes),
    rpc: "https://jungle4.greymass.com" as const,
    independent: "https://jungle4.cryptolions.io" as const,
  };
  const bc = new Blockchain();
  bc.createAccounts(...new Set([owner, allocator, actor]));
  const a = bc.getAccount(Name.from(actor))!;
  a.permissions.push(
    API.v1.AccountPermission.from({
      perm_name: "vrapp",
      parent: "active",
      required_auth: a.permissions[1].required_auth,
    }),
  );
  const contract = bc.createAccount({
    name: c.account,
    abi: JSON.parse(abiBytes.toString()),
    wasm,
  });
  await contract.actions.init({ principal: allocator, total: 100 }).send([
    { actor: c.account, permission: "active" },
    { actor: allocator, permission: "active" },
  ]);
  const rows = (table: string): any[] =>
    contract.tables[table](contract.toBigInt()).getTableRows();
  const included = new Set<string>();
  const send = vi.fn(async (signed: any) => {
    await bc.applyTransaction(
      VertTransaction.from(JSON.parse(JSON.stringify(signed.transaction))),
    );
    included.add(String(signed.id));
    return {} as any;
  });
  const rpc = vi.fn(async (_endpoint: string, method: string, body: any) => {
    if (method === "get_account")
      return {
        account_name: body.account_name,
        permissions: [
          {
            perm_name: "active",
            parent: "owner",
            required_auth: {
              threshold: 1,
              keys: [
                {
                  key: String(keys.get(body.account_name)!.toPublic()),
                  weight: 1,
                },
              ],
              accounts: [],
              waits: [],
            },
          },
        ],
      };
    if (method === "get_transaction_status")
      return {
        state: included.has(body.id) ? "IRREVERSIBLE" : "UNKNOWN",
        block_number: 10,
        block_id: "b".repeat(64),
      };
    if (method === "get_block")
      return {
        block_num: 10,
        id: "b".repeat(64),
        transactions: [...included].map((id) => ({
          status: "executed",
          trx: { id },
        })),
      };
    throw Error("Unexpected fixture RPC");
  });
  function wire(g: AuthorityGateway) {
    vi.spyOn(g, "pins").mockResolvedValue({ last_irreversible_block_num: 10 });
    vi.spyOn(g, "permission").mockResolvedValue();
    vi.spyOn(g, "table").mockImplementation(async (t) => rows(t));
    vi.spyOn(g, "rpc").mockImplementation(rpc);
    vi.spyOn(g.client.v1.chain, "send_transaction").mockImplementation(send);
    vi.spyOn(g.client.v1.chain, "get_info").mockResolvedValue({
      chain_id: JUNGLE4,
      getTransactionHeader: () => ({
        expiration: new Date(Date.now() + 120000).toISOString().slice(0, 19),
        ref_block_num: 1,
        ref_block_prefix: 2,
      }),
    } as any);
  }
  let g = new AuthorityGateway(c, directory, abiBytes, "create");
  wire(g);
  new OwnerRevoke(g);
  let service = new OwnerOnboarding(g, directory);
  const sigs = (r: any) =>
    r.signers.map((s: any) =>
      String(
        keys
          .get(s.actor)!
          .signDigest(Transaction.from(r.transaction).signingDigest(JUNGLE4)),
      ),
    );
  const input = (name = "New independently approved app") => ({
    spec: { ...exampleSpec, name },
    budget: 5,
    maxPayload: 256,
    hours: 24,
  });
  return {
    get g() {
      return g;
    },
    get service() {
      return service;
    },
    c,
    keys,
    input,
    sigs,
    rows,
    send,
    wire,
    rpc,
    directory,
    restart() {
      service.close();
      g.close();
      g = new AuthorityGateway(c, directory, abiBytes);
      wire(g);
      new OwnerRevoke(g);
      service = new OwnerOnboarding(g, directory);
    },
    cleanup() {
      service.close();
      g.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
describe.skipIf(!available)(
  "external app/grant onboarding: actual WASM",
  () => {
    it.each([false, true])(
      "atomic app/grant requires exact owner and allocator approvals (distinct=%s)",
      async (distinct) => {
        const t = await setup(distinct);
        try {
          const r = await t.service.prepare(t.input());
          expect(r.signers).toHaveLength(distinct ? 2 : 1);
          expect(JSON.stringify(r)).not.toContain(
            String(t.keys.get(t.c.appBinding.owner)),
          );
          const tx = ownerWalletTransaction(r);
          expect(tx.actions).toHaveLength(2);
          for (const s of r.signers) {
            const signer = { actor: s.actor, permission: "active" };
            const result = {
              chain: { id: JUNGLE4 },
              signer,
              resolved: { chainId: JUNGLE4, signer, transaction: tx },
              signatures: [
                t.keys.get(s.actor)!.signDigest(tx.signingDigest(JUNGLE4)),
              ],
            };
            expect(verifyOwnerWalletResult(r, result, s.actor)).toBe(
              String(result.signatures[0]),
            );
          }
          if (distinct)
            await expect(
              t.service.submit(r.id, t.sigs(r).slice(0, 1)),
            ).rejects.toThrow("mismatch");
          expect((await t.service.submit(r.id, t.sigs(r))).status).toBe(
            "IRREVERSIBLE",
          );
          expect(t.rows("apps")).toHaveLength(1);
          expect(t.rows("grants")[0].budget).toBe(5);
          expect((await t.service.submit(r.id, t.sigs(r))).status).toBe(
            "IRREVERSIBLE",
          );
          expect(t.send).toHaveBeenCalledTimes(1);
          const ctx = await t.service.context(r.id);
          t.wire(ctx.gateway);
          const write = await ctx.gateway.prepare({
            appId: ctx.app.appId,
            text: "Approved native app",
          });
          expect(
            (await ctx.gateway.submit(write.id, write.payloadHash)).status,
          ).toBe("IRREVERSIBLE");
          const revoke = await ctx.owner.prepare();
          const sig = String(
            t.keys
              .get(r.owner)!
              .signDigest(
                Transaction.from(revoke.transaction).signingDigest(JUNGLE4),
              ),
          );
          expect((await ctx.owner.submit(revoke.id, [sig])).status).toBe(
            "IRREVERSIBLE",
          );
          await expect(
            ctx.gateway.prepare({ appId: ctx.app.appId, text: "After revoke" }),
          ).rejects.toThrow("revoked");
        } finally {
          t.cleanup();
        }
      },
    );
    it("rejects altered spec/limits/actions and missing or wrong signatures before sending", async () => {
      const t = await setup(true);
      try {
        const r = await t.service.prepare(t.input());
        for (const patch of [
          { spec: { ...r.spec, name: "Substitution" } },
          { budget: 100 },
          { owner: "other1111111" },
          { allocator: "other1111111" },
          { grantId: "42" },
          { expires: Number.MAX_SAFE_INTEGER },
        ]) {
          expect(() => onboardingTransaction({ ...r, ...patch })).toThrow();
        }
        const extra = structuredClone(r);
        extra.transaction.actions.push(extra.transaction.actions[0]);
        expect(() => t.service.validate(extra)).toThrow();
        await expect(
          t.service.submit(r.id, [t.sigs(r)[0], t.sigs(r)[0]]),
        ).rejects.toThrow("Both exact");
        const tx = Transaction.from({
          ...r.transaction,
          expiration: new Date(Date.now() - 1000).toISOString().slice(0, 19),
        });
        const expired = {
          ...r,
          transaction: JSON.parse(JSON.stringify(tx)),
          transactionId: String(tx.id),
          signingDigest: String(tx.signingDigest(JUNGLE4)),
        };
        t.g.db
          .prepare("UPDATE native_onboard_ops SET request=? WHERE id=?")
          .run(JSON.stringify(expired), r.id);
        await expect(t.service.submit(r.id, t.sigs(expired))).rejects.toThrow(
          "expired",
        );
        expect(t.send).not.toHaveBeenCalled();
      } finally {
        t.cleanup();
      }
    });
    it("rejects key rotation, root change, operational-key reuse and insufficient capacity", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input());
        const signatures = t.sigs(r);
        t.keys.set(r.owner, PrivateKey.generate("K1"));
        await expect(t.service.submit(r.id, signatures)).rejects.toThrow(
          "authority changed",
        );
        t.keys.set(r.owner, PrivateKey.from(t.c.privateKey));
        await expect(t.service.prepare(t.input("Another app"))).rejects.toThrow(
          "must differ",
        );
        t.keys.set(r.owner, PrivateKey.generate("K1"));
        vi.mocked(t.g.table).mockImplementation(async (table) =>
          table === "root"
            ? [
                {
                  principal: "changed11111",
                  total: 100,
                  available: 0,
                  registered: 0,
                },
              ]
            : t.rows(table),
        );
        await expect(t.service.submit(r.id, signatures)).rejects.toThrow(
          "Allocator",
        );
        await expect(t.service.prepare(t.input("No room"))).rejects.toThrow(
          "capacity",
        );
        expect(t.send).not.toHaveBeenCalled();
      } finally {
        t.cleanup();
      }
    });
    it("onboarding late send failure preserves independently finalized evidence", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input());
        const execute = t.send.getMockImplementation()!;
        let lose!: (e: Error) => void;
        t.send.mockImplementationOnce(async (tx) => {
          await execute(tx);
          return new Promise((_resolve, reject) => {
            lose = reject;
          });
        });
        const pending = t.service.submit(r.id, t.sigs(r));
        await vi.waitFor(() => expect(lose).toBeTypeOf("function"));
        expect((await t.service.reconcile(r.id)).status).toBe("IRREVERSIBLE");
        vi.mocked(t.g.pins).mockRejectedValue(Error("offline"));
        lose(Error("lost response"));
        expect((await pending).lifecycle).toMatchObject({
          state: "FINALIZED",
          nextAction: "RECONCILE",
          submissionBlockCleared: false,
        });
        expect(t.service.row(r.id).evidence).toBeTruthy();
        expect(t.send).toHaveBeenCalledTimes(1);
      } finally {
        t.cleanup();
      }
    });
    it("onboarding prepare cannot create another request after an overlapping ambiguous submission", async () => {
      const t = await setup();
      try {
        const first = await t.service.prepare(t.input("first"));
        const head = await t.g.client.v1.chain.get_info();
        let release!: () => void;
        vi.mocked(t.g.client.v1.chain.get_info).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve(head);
            }),
        );
        const pending = t.service.prepare(t.input("second"));
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        t.send.mockRejectedValue(Error("timeout"));
        const original = t.rpc.getMockImplementation()!;
        t.rpc.mockImplementation(async (base, method, body) => {
          if (method === "get_transaction_status") throw Error("offline");
          return original(base, method, body);
        });
        expect((await t.service.submit(first.id, t.sigs(first))).status).toBe(
          "UNKNOWN",
        );
        release();
        await expect(pending).rejects.toThrow("unresolved");
        expect(t.service.list()).toHaveLength(1);
        expect(t.send).toHaveBeenCalledTimes(1);
      } finally {
        t.cleanup();
      }
    });
    it("retains UNKNOWN across restart and never resends a lost response", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input()),
          signatures = t.sigs(r);
        t.send.mockRejectedValueOnce(Error("Disconnected before acceptance"));
        expect((await t.service.submit(r.id, signatures)).status).toBe(
          "UNKNOWN",
        );
        await expect(
          t.service.prepare(t.input("Blocked by unknown")),
        ).rejects.toThrow("unresolved");
        await expect(t.service.context(r.id)).rejects.toThrow("Fresh verified");
        t.restart();
        expect((await t.service.submit(r.id, signatures)).status).toBe(
          "UNKNOWN",
        );
        expect(t.send).toHaveBeenCalledTimes(1);
      } finally {
        t.cleanup();
      }
    });
    it("does not activate historical success when fresh verification is unavailable", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input());
        await t.service.submit(r.id, t.sigs(r));
        vi.mocked(t.g.pins).mockRejectedValueOnce(Error("offline"));
        await expect(t.service.context(r.id)).rejects.toThrow("Fresh verified");
      } finally {
        t.cleanup();
      }
    });
    it("a slow failed reconciliation cannot downgrade a concurrent finalized result", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input());
        await t.service.submit(r.id, t.sigs(r));
        t.g.db
          .prepare(
            "UPDATE native_onboard_ops SET status='UNKNOWN',evidence=NULL WHERE id=?",
          )
          .run(r.id);
        let rejectSlow!: (e: Error) => void;
        vi.mocked(t.g.pins).mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectSlow = reject;
            }),
        );
        const slow = t.service.reconcile(r.id);
        expect((await t.service.reconcile(r.id)).status).toBe("IRREVERSIBLE");
        rejectSlow(Error("late RPC failure"));
        expect(await slow).toMatchObject({
          status: "IRREVERSIBLE",
          verificationUnavailable: true,
        });
        expect(t.service.row(r.id).status).toBe("IRREVERSIBLE");
      } finally {
        t.cleanup();
      }
    });
    it("rechecks the saved finalized block when transaction status is no longer retained", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input());
        await t.service.submit(r.id, t.sigs(r));
        const original = t.rpc.getMockImplementation()!;
        t.rpc.mockImplementation(async (endpoint, method, body) => {
          if (method === "get_transaction_status")
            throw Error("Status expired");
          return original(endpoint, method, body);
        });
        expect((await t.service.context(r.id)).app.spec.name).toBe(r.spec.name);
        t.rpc.mockImplementation(async (endpoint, method, body) => {
          if (method === "get_block")
            return { block_num: 10, id: "b".repeat(64), transactions: [] };
          return original(endpoint, method, body);
        });
        await expect(t.service.context(r.id)).rejects.toThrow("Fresh verified");
      } finally {
        t.cleanup();
      }
    });
    it("parent recovery lock acquired during onboarding preflight prevents broadcast", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input());
        let release!: () => void;
        vi.spyOn(t.g, "operationalChecks").mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        );
        const pending = t.service.submit(r.id, t.sigs(r));
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        t.g.db
          .prepare(
            "INSERT OR REPLACE INTO native_safety(id,recovery_locked) VALUES(1,1)",
          )
          .run();
        release();
        await expect(pending).rejects.toThrow();
        expect(t.send).not.toHaveBeenCalled();
        expect(t.service.row(r.id).status).toBe("PREPARED");
      } finally {
        t.cleanup();
      }
    });
    it("parent recovery lock acquired while activating an app cannot be bypassed", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input());
        await t.service.submit(r.id, t.sigs(r));
        let release!: () => void;
        vi.mocked(t.g.pins).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve({ last_irreversible_block_num: 10 });
            }),
        );
        const pending = t.service.context(r.id).then(() => "activated");
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        t.g.db
          .prepare(
            "INSERT OR REPLACE INTO native_safety(id,recovery_locked) VALUES(1,1)",
          )
          .run();
        release();
        await expect(pending).rejects.toThrow(
          "Recovery journal is read-only for submission",
        );
        expect(t.send).toHaveBeenCalledTimes(1);
      } finally {
        t.cleanup();
      }
    });
    it("recovery lock blocks preparation, submission and activation", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input());
        t.g.db
          .prepare("INSERT OR REPLACE INTO native_safety VALUES(1,1)")
          .run();
        await expect(t.service.prepare(t.input("Locked"))).rejects.toThrow(
          "read-only",
        );
        await expect(t.service.submit(r.id, t.sigs(r))).rejects.toThrow(
          "read-only",
        );
        await expect(t.service.context(r.id)).rejects.toThrow("read-only");
        expect(t.send).not.toHaveBeenCalled();
      } finally {
        t.cleanup();
      }
    });
    it("two approved apps keep separate journals after restart; missing child is never recreated", async () => {
      const t = await setup();
      try {
        const r1 = await t.service.prepare(t.input("First new app"));
        await t.service.submit(r1.id, t.sigs(r1));
        const r2 = await t.service.prepare(t.input("Second new app"));
        await t.service.submit(r2.id, t.sigs(r2));
        t.restart();
        const a = await t.service.context(r1.id),
          b = await t.service.context(r2.id);
        expect(a.gateway.c.grantId).not.toBe(b.gateway.c.grantId);
        expect(a.app.appId).not.toBe(b.app.appId);
        t.wire(a.gateway);
        t.wire(b.gateway);
        const write = await a.gateway.prepare({
          appId: a.app.appId,
          text: "first only",
        });
        await expect(
          b.gateway.submit(write.id, write.payloadHash),
        ).rejects.toThrow();
        expect(
          (await a.gateway.submit(write.id, write.payloadHash)).status,
        ).toBe("IRREVERSIBLE");
        t.restart();
        rmSync(join(t.directory, "native-contexts", r1.id, "authority.sqlite"));
        await expect(t.service.context(r1.id)).rejects.toThrow("missing");
        expect(
          existsSync(
            join(t.directory, "native-contexts", r1.id, "authority.sqlite"),
          ),
        ).toBe(false);
        expect((await t.service.context(r2.id)).app.appId).toBe(b.app.appId);
      } finally {
        t.cleanup();
      }
    });
    it("refuses duplicate app specs and detects signature/status and missing-table corruption", async () => {
      const t = await setup();
      try {
        const r = await t.service.prepare(t.input());
        await t.service.submit(r.id, t.sigs(r));
        await expect(t.service.prepare(t.input())).rejects.toThrow(
          "already exists",
        );
        t.g.db
          .prepare("UPDATE native_onboard_ops SET status='PREPARED' WHERE id=?")
          .run(r.id);
        expect(() => new OwnerOnboarding(t.g, t.directory)).toThrow(
          "signature/status",
        );
        t.g.db.exec("DROP TABLE native_onboard_ops");
        expect(() => t.restart()).toThrow("incomplete");
      } finally {
        // restart closes the old handle before failing, so only remove fixture files.
        rmSync(t.directory, { recursive: true, force: true });
      }
    });
  },
);

describe.skipIf(!available)("onboarding operational permission gate", () => {
  for (const side of ["rpc", "independent"] as const) {
    it(
      "does not prepare authority when " + side + " reports unsafe operator",
      async () => {
        const t = await setup();
        try {
          vi.mocked(t.g.permission).mockImplementation(async (endpoint) => {
            if (endpoint === t.c[side]) throw Error("unsafe operator");
          });
          await expect(t.service.prepare(t.input())).rejects.toThrow(
            "unsafe operator",
          );
          expect(t.service.list()).toHaveLength(0);
          expect(t.send).not.toHaveBeenCalled();
        } finally {
          t.cleanup();
        }
      },
    );
    it(
      "does not submit owner-approved grant when " + side + " becomes unsafe",
      async () => {
        const t = await setup();
        try {
          const r = await t.service.prepare(t.input()),
            sigs = t.sigs(r);
          vi.mocked(t.g.permission).mockImplementation(async (endpoint) => {
            if (endpoint === t.c[side]) throw Error("unsafe operator");
          });
          await expect(t.service.submit(r.id, sigs)).rejects.toThrow(
            "unsafe operator",
          );
          expect(t.service.row(r.id).status).toBe("PREPARED");
          expect(t.send).not.toHaveBeenCalled();
          expect(t.rows("grants")).toHaveLength(0);
        } finally {
          t.cleanup();
        }
      },
    );
  }
});
