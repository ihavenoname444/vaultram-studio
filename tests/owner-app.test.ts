import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Blockchain, type Account } from "@vaulta/vert";
import {
  TimePointSec,
  Action,
  Transaction,
  API,
  Name,
} from "@wharfkit/antelope-vert";
const dir = "contracts/build/owner-app/";
const available =
  existsSync(dir + "authority.wasm") && existsSync(dir + "authority.abi");
if (process.env.REQUIRE_OWNER_APP === "1" && !available)
  throw Error("Authority WASM required");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
describe.skipIf(!available)("owner/app v2: actual WASM", () => {
  let bc: Blockchain, c: Account;
  const principal = "principal111",
    actor = "agent1111111",
    other = "agent2222222";
  const table = (t: string): any[] => c.tables[t](c.toBigInt()).getTableRows();
  const snapshot = () =>
    JSON.stringify(
      ["root", "apps", "grants", "reservations", "effects"].map(table),
    );
  const call = (action: string, data: object, signer = actor) =>
    c.actions[action](data).send(
      signer + (signer === actor || signer === other ? "@vrstudio" : "@active"),
    );
  const grant = (id = 1, budget = 3, patch = {}) =>
    call(
      "grant",
      {
        id,
        actor,
        actor_permission: "vrstudio",
        app_id: 42,
        space: "memory",
        budget,
        expires: 100,
        max_payload: 256,
        ...patch,
      },
      principal,
    );
  const reserve = (id: number, grant_id = 1, patch = {}, signer = actor) =>
    call(
      "reserve",
      {
        grant_id,
        app_id: 42,
        id,
        space: "memory",
        obligation: id,
        nullifier: id,
        effect_id: id,
        payload_hash: hash("public"),
        ...patch,
      },
      signer,
    );
  function conserved() {
    const root = table("root")[0],
      gs = table("grants"),
      rs = table("reservations"),
      es = table("effects");
    let sum = BigInt(root.available),
      consumed = 0;
    for (const g of gs) {
      const states = ["available", "reserved", "quarantined", "consumed"];
      const amount = states.reduce((n, k) => n + BigInt(g[k]), 0n);
      expect(amount).toBe(BigInt(g.budget));
      sum += amount;
      for (const [field, state] of [
        ["reserved", 0],
        ["consumed", 1],
        ["quarantined", 2],
      ] as const)
        expect(Number(g[field])).toBe(
          rs.filter(
            (r) =>
              String(r.grant_id) === String(g.id) && Number(r.status) === state,
          ).length,
        );
      consumed += Number(g.consumed);
    }
    expect(sum).toBe(BigInt(root.total));
    expect(consumed).toBe(es.length);
  }
  async function rejected(run: () => Promise<unknown>, message?: string) {
    const before = snapshot();
    await expect(run()).rejects.toThrow(message);
    expect(snapshot()).toBe(before);
    conserved();
  }
  beforeEach(async () => {
    bc = new Blockchain();
    bc.createAccounts(principal, actor, other);
    for (const name of [principal, actor, other]) {
      const a = bc.getAccount(Name.from(name))!;
      for (const perm_name of ["vrstudio", "other"])
        a.permissions.push(
          API.v1.AccountPermission.from({
            perm_name,
            parent: "active",
            required_auth: a.permissions[1].required_auth,
          }),
        );
    }
    c = bc.createAccount({
      name: "authority111",
      abi: JSON.parse(readFileSync(dir + "authority.abi", "utf8")),
      wasm: readFileSync(dir + "authority.wasm"),
    });
    await c.actions.init({ principal, total: 10000 }).send([
      { actor: "authority111", permission: "active" },
      { actor: principal, permission: "active" },
    ]);
    await call(
      "regapp",
      { id: 42, owner: principal, app_hash: "a".repeat(64) },
      principal,
    );
  });
  it("requires both initialization signatures and permanently fixes the root", async () => {
    const fresh = bc.createAccount({
      name: "fresh1111111",
      abi: c.abi!,
      wasm: c.wasm!,
    });
    await expect(
      fresh.actions.init({ principal, total: 10 }).send("fresh1111111@active"),
    ).rejects.toThrow();
    await expect(
      fresh.actions.init({ principal, total: 10 }).send(principal + "@active"),
    ).rejects.toThrow();
    await rejected(
      () =>
        c.actions.init({ principal, total: 10001 }).send([
          { actor: "authority111", permission: "active" },
          { actor: principal, permission: "active" },
        ]),
      "initialized",
    );
  });
  it("moves root capacity rather than copying it; rejects 10001 and unsigned grants", async () => {
    await rejected(() =>
      call("grant", {
        id: 1,
        actor,
        actor_permission: "vrstudio",
        app_id: 42,
        space: "memory",
        budget: 1,
        expires: 100,
        max_payload: 256,
      }),
    );
    await grant(1, 6000);
    await grant(2, 4000, { actor: other });
    await rejected(() => grant(3, 1), "root budget");
    conserved();
  });
  it("atomically appends exactly one bounded effect and rejects lost-response retry", async () => {
    await grant();
    await reserve(1);
    await call("consume", { id: 1, payload: "public" });
    expect(table("effects")[0].payload).toBe("public");
    conserved();
    await rejected(
      () => call("consume", { id: 1, payload: "public" }),
      "not available",
    );
  });
  it("rolls back the reservation too when the second action in one transaction fails", async () => {
    await grant();
    const make = (name: string, data: object) =>
      Action.from(
        {
          account: String(c.name),
          name,
          authorization: [{ actor, permission: "vrstudio" }],
          data,
        },
        c.abi!,
      );
    const transaction = (payload: string) =>
      Transaction.from({
        expiration: 0,
        ref_block_num: 0,
        ref_block_prefix: 0,
        actions: [
          make("reserve", {
            grant_id: 1,
            app_id: 42,
            id: 1,
            space: "memory",
            obligation: 1,
            nullifier: 1,
            effect_id: 1,
            payload_hash: hash("public"),
          }),
          make("consume", { id: 1, payload }),
        ],
      });
    await rejected(
      () => bc.applyTransaction(transaction("substituted")),
      "binding",
    );
    expect(table("reservations")).toHaveLength(0);
    expect(Number(table("grants")[0].available)).toBe(3);
    await bc.applyTransaction(transaction("public"));
    expect(table("effects")).toHaveLength(1);
    expect(Number(table("grants")[0].available)).toBe(2);
    conserved();
  });
  it("rejects direct actor bypass, namespace substitution and payload substitution", async () => {
    await grant();
    await rejected(() => reserve(1, 1, {}, other));
    await rejected(() => reserve(1, 1, { space: "treasury" }), "namespace");
    await reserve(1);
    await rejected(() => call("consume", { id: 1, payload: "public" }, other));
    await rejected(
      () => call("consume", { id: 1, payload: "changed" }),
      "binding",
    );
    expect(c.actions.transfer).toBeUndefined();
    expect(c.actions.release).toBeUndefined();
  });
  it("retains all reservation, obligation, nullifier and effect tombstones", async () => {
    await grant(1, 8);
    await reserve(1);
    await call("consume", { id: 1, payload: "public" });
    await rejected(() => reserve(1), "reservation id");
    for (const field of ["obligation", "nullifier", "effect_id"])
      await rejected(() => reserve(2, 1, { [field]: 1 }), "used");
  });
  it("prevents budget oversubscription across competing ordered reservations", async () => {
    await grant(1, 1);
    await reserve(1);
    await rejected(() => reserve(2), "exhausted");
    await call("consume", { id: 1, payload: "public" });
    await rejected(() => reserve(3), "exhausted");
  });
  it("hostile operational signer bypasses Studio: arbitrary in-scope content succeeds, expansion fails", async () => {
    await grant(1, 1);
    // This is a residual-risk test: there is no separate user-intent check.
    const payload = "attacker-authored public record";
    await rejected(() => reserve(1, 1, { app_id: 43 }), "app binding");
    await rejected(() => reserve(1, 1, { space: "treasury" }), "namespace");
    await reserve(1, 1, { payload_hash: hash(payload) });
    await call("consume", { id: 1, payload });
    expect(table("effects")[0].payload).toBe(payload);
    await rejected(() => reserve(2), "exhausted");
    await rejected(() => call("consume", { id: 1, payload }), "not available");
    conserved();
  });
  it("shared operational signer can use both explicitly granted apps, never enlarge either grant", async () => {
    bc.createAccounts(owner);
    await grant(1, 1);
    await c.actions.regapp(appB).send(coauth);
    await c.actions.grant({ ...grantB, budget: 1 }).send(coauth);
    await reserve(1);
    await reserve(2, 2, { app_id: 43 });
    await call("consume", { id: 1, payload: "public" });
    await call("consume", { id: 2, payload: "public" });
    await rejected(() => reserve(3), "exhausted");
    await rejected(() => reserve(3, 2, { app_id: 43 }), "exhausted");
    expect(table("effects")).toHaveLength(2);
    conserved();
  });
  it("blocks reserved work after principal revocation and cannot reverse completed effects", async () => {
    await grant();
    await reserve(1);
    await call("consume", { id: 1, payload: "public" });
    await reserve(2);
    await rejected(() => call("revoke", { grant_id: 1 }));
    await call("revoke", { grant_id: 1 }, principal);
    await rejected(
      () => call("consume", { id: 2, payload: "public" }),
      "revoked",
    );
    await rejected(() => reserve(3), "revoked");
    expect(table("effects")).toHaveLength(1);
    expect(Number(table("grants")[0].reserved)).toBe(1);
  });
  it("checks expiry at reservation and at execution, including exact deadline", async () => {
    await grant(1, 3, { expires: 10 });
    await reserve(1);
    bc.setTime(TimePointSec.from("1970-01-01T00:00:10"));
    await rejected(() => reserve(2), "expired");
    await rejected(
      () => call("consume", { id: 1, payload: "public" }),
      "expired",
    );
    await call("quarantine", { id: 1 }, principal);
    conserved();
  });
  it("never releases quarantined units, including principal attempts", async () => {
    await grant(1, 2);
    await reserve(1);
    await rejected(() => call("quarantine", { id: 1 }, other));
    await call("quarantine", { id: 1 }, principal);
    await rejected(
      () => call("consume", { id: 1, payload: "public" }),
      "not available",
    );
    await rejected(
      () => call("quarantine", { id: 1 }, principal),
      "not available",
    );
    await rejected(() => reserve(1), "used");
    conserved();
  });
  it("rejects malformed, oversized and overflowing values without state changes", async () => {
    await rejected(() => grant(1, 0), "budget");
    await rejected(
      () => grant(1, 1, { budget: "18446744073709551615" }),
      "budget",
    );
    await rejected(() => grant(1, 1, { max_payload: 257 }), "payload limit");
    await grant();
    await rejected(() => grant(), "grant id");
    await rejected(() => reserve(0), "invalid reservation");
    await reserve(1, 1, { payload_hash: hash("x".repeat(257)) });
    await rejected(
      () => call("consume", { id: 1, payload: "x".repeat(257) }),
      "payload size",
    );
  });
  it("conserves capacity through a deterministic adversarial mixed sequence", async () => {
    await grant(1, 20);
    await grant(2, 20, { actor: other });
    for (let id = 1; id <= 40; id++) {
      const g = id % 2 ? 1 : 2,
        a = g === 1 ? actor : other;
      await reserve(id, g, {}, a);
      conserved();
      await call(
        id % 3 ? "consume" : "quarantine",
        id % 3 ? { id, payload: "public" } : { id },
        id % 3 ? a : principal,
      );
      conserved();
      await rejected(
        () => call("consume", { id, payload: "public" }, a),
        "not available",
      );
    }
  });
  const owner = "owner2222222";
  const coauth = [
    { actor: principal, permission: "active" },
    { actor: owner, permission: "active" },
  ];
  const appB = { id: 43, owner, app_hash: "b".repeat(64) };
  const grantB = {
    id: 2,
    app_id: 43,
    actor,
    actor_permission: "vrstudio",
    space: "memory",
    budget: 3,
    expires: 100,
    max_payload: 256,
  };
  it("requires real owner consent for registration and allocation, with immutable full spec hash", async () => {
    bc.createAccounts(owner);
    await rejected(() => call("regapp", appB, principal));
    await rejected(() => c.actions.regapp(appB).send(owner + "@active"));
    await c.actions.regapp(appB).send(coauth);
    await rejected(
      () => c.actions.regapp({ ...appB, owner: principal }).send(coauth),
      "app id used",
    );
    await rejected(() => call("grant", grantB, principal));
    await rejected(() => c.actions.grant(grantB).send(owner + "@active"));
    await c.actions.grant(grantB).send(coauth);
    expect(table("grants")[0].owner).toBe(owner);
    expect(table("apps").find((a) => Number(a.id) === 43).app_hash).toBe(
      appB.app_hash,
    );
    conserved();
  });
  it("cannot cross applications even with the same actor, and cannot reattribute via opaque payload", async () => {
    bc.createAccounts(owner);
    await grant();
    await c.actions.regapp(appB).send(coauth);
    await c.actions.grant(grantB).send(coauth);
    await rejected(() => reserve(1, 1, { app_id: 43 }), "app binding");
    await rejected(() => reserve(1, 2, { app_id: 42 }), "app binding");
    await rejected(
      () => reserve(1, 1, { app_id: "18446744073709551615" }),
      "app binding",
    );
    const lie = JSON.stringify({
      appId: "43",
      owner,
      text: "untrusted metadata",
    });
    await reserve(1, 1, { payload_hash: hash(lie) });
    await call("consume", { id: 1, payload: lie });
    expect(table("effects")[0]).toMatchObject({
      app_id: 42,
      owner: principal,
      actor_permission: "vrstudio",
    });
    await reserve(2, 2, { app_id: 43 });
    await call("consume", { id: 2, payload: "public" });
    expect(table("effects")[1]).toMatchObject({ app_id: 43, owner });
    conserved();
  });
  it("rejects the actor's other permission and prevents delegated grant or owner revocation", async () => {
    await grant();
    const d = {
      grant_id: 1,
      app_id: 42,
      id: 1,
      space: "memory",
      obligation: 1,
      nullifier: 1,
      effect_id: 1,
      payload_hash: hash("public"),
    };
    await rejected(() => c.actions.reserve(d).send(actor + "@other"));
    await rejected(() => c.actions.reserve(d).send(actor + "@active"));
    await reserve(1);
    await rejected(() =>
      c.actions.consume({ id: 1, payload: "public" }).send(actor + "@other"),
    );
    await rejected(() => call("revoke", { grant_id: 1 }));
    await rejected(() =>
      c.actions.revoke({ grant_id: 1 }).send(principal + "@vrstudio"),
    );
    await rejected(() =>
      c.actions
        .grant({ ...grantB, id: 2, app_id: 42 })
        .send(actor + "@vrstudio"),
    );
  });
  it("only the app owner revokes; allocator cannot impersonate another owner", async () => {
    bc.createAccounts(owner);
    await c.actions.regapp(appB).send(coauth);
    await c.actions.grant(grantB).send(coauth);
    await reserve(1, 2, { app_id: 43 });
    await rejected(() => call("revoke", { grant_id: 2 }, principal));
    await c.actions.revoke({ grant_id: 2 }).send(owner + "@active");
    await rejected(
      () => call("consume", { id: 1, payload: "public" }),
      "revoked",
    );
    await c.actions.quarantine({ id: 1 }).send(owner + "@active");
    conserved();
  });
  it("rejects invalid registry and permission bindings", async () => {
    await rejected(() =>
      call(
        "regapp",
        { id: 0, owner: principal, app_hash: "a".repeat(64) },
        principal,
      ),
    );
    await rejected(() =>
      call(
        "regapp",
        { id: 43, owner: principal, app_hash: "0".repeat(64) },
        principal,
      ),
    );
    await rejected(() => grant(1, 1, { app_id: 999 }), "unknown app");
    for (const actor_permission of ["", "active", "owner"])
      await rejected(
        () => grant(1, 1, { actor_permission }),
        "restricted actor permission",
      );
  });
});
