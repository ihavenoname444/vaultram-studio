import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { inspectNativeState, auditNativeState } from "../native-state.mjs";
import { VerificationError, createRpc } from "../verifier.mjs";
const sample = JSON.parse(
  readFileSync(
    new URL("../examples/jungle4-external-lifecycle.json", import.meta.url),
  ),
).denial.observation.after[0];
const profile = JSON.parse(
  readFileSync(new URL("../profile-external.json", import.meta.url)),
);
const fresh = () => structuredClone(sample);
function fixture(change = () => {}) {
  let round = 0;
  return async (method, body) => {
    let r;
    if (method === "get_info") {
      round++;
      r = {
        chain_id: profile.chainId,
        head_block_num: 300000100,
        last_irreversible_block_num: 300000000,
      };
    } else if (method === "get_code_hash") r = { code_hash: profile.codeHash };
    else if (method === "get_raw_abi") r = { abi_hash: profile.abiHash };
    else if (method === "get_table_rows") {
      assert.equal(body.code, profile.contract);
      assert.equal(body.scope, profile.contract);
      assert.equal(body.limit, 10001);
      assert.equal(body.lower_bound, undefined);
      r = {
        rows: structuredClone(sample[body.table]),
        more: false,
        next_key: "",
      };
    } else assert.fail("Unexpected RPC method");
    change(r, method, body, round);
    return r;
  };
}
test("whole ledger accounts for every grant and retained effect using public fixture", () => {
  const r = inspectNativeState(fresh());
  assert.deepEqual(r.counts, {
    apps: 3,
    grants: 3,
    reservations: 3,
    effects: 2,
  });
  assert.equal(
    r.accounting.rootAvailable + r.accounting.allocated,
    r.accounting.rootTotal,
  );
  assert.equal(r.accounting.rootTotal, 10000);
  assert.equal(r.accounting.unit, "UNBACKED_TEST_WRITE");
  assert.equal(r.accounting.grantCounters.reserved, 1);
  assert.equal(r.accounting.grantCounters.consumed, 2);
});
test("normalized digest ignores row/key order and exact numeric-string representation", () => {
  const a = fresh(),
    b = fresh();
  for (const [k, rows] of Object.entries(b))
    b[k] = rows.reverse().map((r) =>
      Object.fromEntries(
        Object.entries(r)
          .reverse()
          .map(([key, value]) => [
            key,
            typeof value === "number" && !["status", "revoked"].includes(key)
              ? String(value)
              : value,
          ]),
      ),
    );
  assert.equal(
    inspectNativeState(a).observationDigest,
    inspectNativeState(b).observationDigest,
  );
});
test("two complete equal reads yield observations, not Aegis/backing/finalized-state proof", async () => {
  let reads = 0;
  const r = await auditNativeState({
    rpc: fixture((r, m) => {
      if (m === "get_table_rows") reads++;
    }),
  });
  assert.equal(reads, 10);
  assert.equal(r.status, "STABLE_CURRENT_RPC_OBSERVATION");
  assert.equal(r.aegisPolicyVerdict, "NOT_EVALUATED");
  assert.equal(r.backing.status, "UNAVAILABLE");
  assert.ok(r.trust.some((x) => x.includes("not an atomic")));
  assert.ok(r.trust.some((x) => x.includes("not proven to belong")));
  assert.equal(r.snapshot.root[0].available, 9894);
});
const mutations = [
  ["extra table", (s) => (s.capacity = [])],
  ["missing table", (s) => delete s.effects],
  ["missing root", (s) => (s.root = [])],
  ["duplicate root", (s) => s.root.push(s.root[0])],
  ["root principal substitution", (s) => (s.root[0].principal = "eosio")],
  ["root total expansion", (s) => s.root[0].total++],
  ["root available amplification", (s) => s.root[0].available++],
  ["registered count mismatch", (s) => s.root[0].registered++],
  [
    "hidden overallocated grant",
    (s) =>
      s.grants.push({
        ...s.grants[0],
        id: "456",
        available: 1,
        budget: 1,
        reserved: 0,
        consumed: 0,
        quarantined: 0,
      }),
  ],
  ["duplicate grant", (s) => s.grants.push(s.grants[0])],
  ["missing grant", (s) => s.grants.pop()],
  ["duplicate app", (s) => s.apps.push(s.apps[0])],
  ["orphan grant app", (s) => (s.grants[0].app_id = "987654")],
  ["grant owner substitution", (s) => (s.grants[0].owner = "eosio")],
  ["unsafe numeric id", (s) => (s.grants[0].id = 9007199254740992)],
  ["overflow id", (s) => (s.grants[0].id = "18446744073709551616")],
  ["noncanonical id", (s) => (s.apps[0].id = "01")],
  ["empty app hash", (s) => (s.apps[0].app_hash = "0".repeat(64))],
  [
    "privileged agent permission",
    (s) => (s.grants[0].actor_permission = "active"),
  ],
  ["bad native name", (s) => (s.grants[0].actor = "not-an-account")],
  ["negative count", (s) => (s.grants[0].available = -1)],
  ["fractional count", (s) => (s.grants[0].available = 0.5)],
  ["grant counter inflation", (s) => s.grants[0].available++],
  ["invalid revoked flag", (s) => (s.grants[0].revoked = "false")],
  ["invalid payload quota", (s) => (s.grants[0].max_payload = 257)],
  ["orphan reservation", (s) => (s.reservations[0].grant_id = "7890")],
  ["duplicate reservation", (s) => s.reservations.push(s.reservations[0])],
  [
    "duplicate cross-grant obligation",
    (s) => (s.reservations[1].obligation = s.reservations[0].obligation),
  ],
  [
    "duplicate cross-grant nullifier",
    (s) => (s.reservations[1].nullifier = s.reservations[0].nullifier),
  ],
  [
    "duplicate allocated effect id",
    (s) => (s.reservations[1].effect_id = s.reservations[0].effect_id),
  ],
  ["invalid reservation status", (s) => (s.reservations[0].status = 3)],
  [
    "status counter mismatch",
    (s) => (s.reservations[0].status = (s.reservations[0].status + 1) % 3),
  ],
  ["missing consumed effect", (s) => s.effects.pop()],
  ["duplicate effect", (s) => s.effects.push(s.effects[0])],
  ["orphan effect", (s) => (s.effects[0].reservation = "7890")],
  [
    "effect bound to another app",
    (s) =>
      (s.effects[0].app_id = s.apps.find(
        (a) => String(a.id) !== String(s.effects[0].app_id),
      ).id),
  ],
  ["effect owner substitution", (s) => (s.effects[0].owner = "eosio")],
  ["effect actor substitution", (s) => (s.effects[0].actor = "eosio")],
  ["effect namespace substitution", (s) => (s.effects[0].space = "other")],
  ["effect payload substitution", (s) => (s.effects[0].payload += "!")],
  ["extra row field", (s) => (s.apps[0].verified = true)],
];
for (const [name, mutate] of mutations)
  test("native audit rejects " + name, () => {
    const s = fresh();
    mutate(s);
    assert.throws(() => inspectNativeState(s));
  });
test("quarantine retains consumed capacity but must have no effect", () => {
  const s = fresh();
  const r = s.reservations.find((x) => x.status === 0);
  const g = s.grants.find((g) => String(g.id) === String(r.grant_id));
  r.status = 2;
  g.reserved--;
  g.quarantined++;
  const v = inspectNativeState(s);
  assert.equal(v.accounting.grantCounters.quarantined, 1);
  s.effects.push({
    ...s.effects[0],
    id: r.effect_id,
    reservation: r.id,
    grant_id: g.id,
  });
  assert.throws(() => inspectNativeState(s));
});
for (const [name, mutate] of [
  ["truncated table", (r) => (r.more = true)],
  ["ambiguous next key", (r) => (r.next_key = "123")],
  ["missing completion flag", (r) => delete r.more],
  ["too many rows", (r) => (r.rows = Array(10001).fill(r.rows[0]))],
])
  test("native audit fails closed on " + name, async () =>
    assert.rejects(() =>
      auditNativeState({
        rpc: fixture((r, m, b) => {
          if (m === "get_table_rows" && b.table === "apps") mutate(r);
        }),
      }),
    ),
  );
test("changing observations are inconclusive and never silently retried", async () => {
  let n = 0;
  await assert.rejects(
    () =>
      auditNativeState({
        rpc: fixture((r, m, b) => {
          if (m === "get_table_rows" && b.table === "root" && ++n === 2)
            r.rows[0].available--;
        }),
      }),
    (e) => e instanceof VerificationError && e.unavailable === true,
  );
  assert.equal(n, 2);
});
for (const [name, change] of [
  [
    "wrong chain",
    (r, m) => {
      if (m === "get_info") r.chain_id = "f".repeat(64);
    },
  ],
  [
    "wrong code",
    (r, m) => {
      if (m === "get_code_hash") r.code_hash = "f".repeat(64);
    },
  ],
  [
    "wrong ABI",
    (r, m) => {
      if (m === "get_raw_abi") r.abi_hash = "f".repeat(64);
    },
  ],
  [
    "unavailable finality",
    (r, m) => {
      if (m === "get_info") delete r.last_irreversible_block_num;
    },
  ],
  [
    "regressed finality",
    (r, m, b, round) => {
      if (m === "get_info" && round === 2) r.last_irreversible_block_num--;
    },
  ],
  [
    "regressed head",
    (r, m, b, round) => {
      if (m === "get_info" && round === 2) r.head_block_num--;
    },
  ],
  [
    "ending code changed",
    (r, m, b, round) => {
      if (m === "get_code_hash" && round === 2) r.code_hash = "f".repeat(64);
    },
  ],
  [
    "ending ABI changed",
    (r, m, b, round) => {
      if (m === "get_raw_abi" && round === 2) r.abi_hash = "f".repeat(64);
    },
  ],
])
  test("native audit rejects " + name, async () =>
    assert.rejects(
      () => auditNativeState({ rpc: fixture(change) }),
      VerificationError,
    ),
  );
test("no fabricated empty state without RPC and network outage remains inconclusive", async () => {
  await assert.rejects(() => auditNativeState(), VerificationError);
  await assert.rejects(
    () =>
      auditNativeState({
        rpc: async () => {
          throw new VerificationError("Unavailable", true);
        },
      }),
    (e) => e.unavailable === true,
  );
});
test("native audit CLI rejects arbitrary endpoint and file inputs without transport", () => {
  for (const args of [
    ["--rpc", "https://evil.test"],
    ["--profile", "fake"],
    ["--private-key", "not-a-key"],
  ]) {
    const r = spawnSync(process.execPath, ["audit-state.mjs", ...args], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).status, "INVALID");
    assert.ok(!r.stdout.includes("not-a-key"));
  }
});
test("audit uses unchanged transport allowlist, never a submission method", async () => {
  let calls = 0;
  const rpc = createRpc("cryptolions", async () => {
    calls++;
    throw Error("not needed");
  });
  await assert.rejects(() => rpc("send_transaction", {}));
  assert.equal(calls, 0);
});

test("audits valid independent app/owner/grant and distinct reservation identifiers", () => {
  const s = fresh();
  s.apps.push({ id: "900", owner: "alice", app_hash: "a".repeat(64) });
  s.root[0].registered++;
  s.root[0].available -= 2;
  s.grants.push({
    id: "901",
    app_id: "900",
    owner: "alice",
    actor: "bob",
    actor_permission: "worker",
    space: "notes",
    budget: 2,
    available: 1,
    reserved: 1,
    quarantined: 0,
    consumed: 0,
    expires: 1,
    max_payload: 64,
    revoked: true,
  });
  s.reservations.push({
    id: "902",
    grant_id: "901",
    obligation: "903",
    nullifier: "904",
    effect_id: "905",
    payload_hash: "b".repeat(64),
    status: 0,
  });
  const r = inspectNativeState(s);
  assert.deepEqual(r.counts, {
    apps: 4,
    grants: 4,
    reservations: 4,
    effects: 2,
  });
  assert.equal(r.accounting.rootAvailable + r.accounting.allocated, 10000);
  assert.equal(r.accounting.grantCounters.reserved, 2);
});
