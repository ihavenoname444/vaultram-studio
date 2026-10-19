import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ABI, PrivateKey, Serializer } from "@wharfkit/antelope";
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
  const g = new AuthorityGateway(c, directory, abiBytes);
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
        transactions: g
          .list()
          .map((o) => ({ status: "executed", trx: { id: o.txid } })),
      };
    throw Error("Unexpected test RPC");
  });
  return {
    g,
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
