import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { verifyEvidence, VerificationError } from "../verifier.mjs";
const sample = JSON.parse(
  readFileSync(
    new URL("../examples/jungle4-external-lifecycle.json", import.meta.url),
  ),
);
const legacy = JSON.parse(
  readFileSync(new URL("../examples/jungle4-lifecycle.json", import.meta.url)),
);
const profile = JSON.parse(
  readFileSync(new URL("../profile-external.json", import.meta.url)),
);
const fresh = () => structuredClone(sample);
const verify = (b, options = {}) =>
  verifyEvidence(b, { profileName: "external-v2", ...options });
function fixtureRpc(change = () => {}) {
  return async (method, body) => {
    let r;
    if (method === "get_info")
      r = {
        chain_id: profile.chainId,
        last_irreversible_block_num: sample.revocation.block + 100,
      };
    else if (method === "get_code_hash") r = { code_hash: profile.codeHash };
    else if (method === "get_raw_abi") r = { abi_hash: profile.abiHash };
    else if (method === "get_block") {
      const v = [sample.registration, sample.write, sample.revocation].find(
        (x) => x.block === body.block_num_or_id,
      );
      assert.ok(v);
      r = {
        block_num: v.block,
        id: v.blockId,
        transactions: [{ status: "executed", trx: { id: v.transactionId } }],
      };
    } else if (method === "get_table_rows")
      r = {
        rows: structuredClone(
          sample.denial.observation.after[0][body.table].filter(
            (x) => String(x.id) === body.lower_bound,
          ),
        ),
        more: false,
      };
    else assert.fail("Unexpected method");
    change(r, method, body);
    return r;
  };
}
const snapshotChange = (b, fn) => {
  const s = b.denial.observation.before[0];
  fn(s);
  b.denial.observation.before = [structuredClone(s), structuredClone(s)];
  b.denial.observation.after = structuredClone(b.denial.observation.before);
};
test("v2 recomputes AppSpec hash and checks signed registration without chain claims offline", async () => {
  const r = await verify(fresh());
  assert.equal(r.version, 2);
  assert.equal(r.status, "OFFLINE_CHECKS_PASSED");
  assert.equal(r.aegisPolicyVerdict, "NOT_EVALUATED");
  assert.equal(
    r.claims.find((x) => x.claim.startsWith("AppSpec")).level,
    "VERIFIED_LOCAL",
  );
  assert.ok(!r.claims.some((x) => x.level === "VERIFIED_RPC"));
});
test("v2 RPC fixtures include all three successful transactions and retain observation limits", async () => {
  const r = await verify(fresh(), { rpc: fixtureRpc() });
  assert.equal(r.status, "PUBLIC_CHAIN_CHECKS_PASSED");
  assert.deepEqual(r.claims.find((x) => x.blocks).blocks, [
    sample.registration.block,
    sample.write.block,
    sample.revocation.block,
  ]);
  for (const term of ["RAM trace", "Historical post-revoke"])
    assert.equal(
      r.claims.find((x) => x.claim.startsWith(term)).level,
      "RECORDED_ONLY",
    );
  assert.equal(r.aegisPolicyVerdict, "NOT_EVALUATED");
});
test("reviewer must explicitly select external profile; no evidence-controlled downgrade", async () => {
  await assert.rejects(() => verifyEvidence(fresh()), VerificationError);
  await assert.rejects(() => verify(legacy), VerificationError);
  await assert.rejects(
    () => verifyEvidence(fresh(), { profileName: "https://evil.test/profile" }),
    VerificationError,
  );
});
test("AppSpec object key order does not change canonical identity", async () => {
  const b = fresh();
  b.registration.spec = Object.fromEntries(
    Object.entries(b.registration.spec).reverse(),
  );
  assert.equal((await verify(b)).status, "OFFLINE_CHECKS_PASSED");
});
const mutations = [
  ["missing registration", (b) => delete b.registration],
  ["version downgrade", (b) => (b.version = 1)],
  ["legacy profile", (b) => (b.profile = legacy.profile)],
  ["mixed old write", (b) => (b.write = legacy.write)],
  ["mixed old revoke", (b) => (b.revocation = legacy.revocation)],
  ["mutated spec name", (b) => (b.registration.spec.name += "!")],
  ["unknown spec field", (b) => (b.registration.spec.hidden = true)],
  [
    "unicode byte overflow",
    (b) => (b.registration.spec.name = "🚀".repeat(20)),
  ],
  ["unsupported template", (b) => (b.registration.spec.template = "anything")],
  ["changed spec action order", (b) => b.registration.spec.actions.reverse()],
  [
    "unsigned registration",
    (b) => (b.registration.transaction.signatures = []),
  ],
  [
    "wrong registration signature",
    (b) =>
      (b.registration.transaction.signatures = b.write.transaction.signatures),
  ],
  [
    "extra registration signature",
    (b) =>
      b.registration.transaction.signatures.push(
        ...b.registration.transaction.signatures,
      ),
  ],
  [
    "reordered registration actions",
    (b) => b.registration.transaction.actions.reverse(),
  ],
  [
    "extra registration action",
    (b) =>
      b.registration.transaction.actions.push(
        b.revocation.transaction.actions[0],
      ),
  ],
  [
    "owner authority substitution",
    (b) =>
      (b.registration.transaction.actions[0].authorization[0].permission =
        "owner"),
  ],
  [
    "allocator authorization substitution",
    (b) =>
      b.registration.transaction.actions[1].authorization.push({
        actor: "eosio",
        permission: "active",
      }),
  ],
  [
    "changed grant bytes",
    (b) =>
      (b.registration.transaction.actions[1].data =
        b.registration.transaction.actions[1].data.slice(0, -2) + "01"),
  ],
  [
    "changed registration transaction id",
    (b) => (b.registration.transactionId = "f".repeat(64)),
  ],
  [
    "registration after write",
    (b) => {
      b.registration.block = b.write.block;
      b.registration.blockId = b.write.blockId;
    },
  ],
  [
    "changed registration block hash",
    (b) => (b.registration.blockId = "f".repeat(64)),
  ],
  [
    "hidden raw transaction field",
    (b) => (b.registration.transaction.secret = "ignored"),
  ],
  ["delayed registration", (b) => (b.registration.transaction.delay_sec = 1)],
  [
    "context-free registration",
    (b) => (b.registration.transaction.context_free_data = ["01"]),
  ],
  [
    "grant exhausted at rejection",
    (b) =>
      snapshotChange(b, (s) => {
        const g = s.grants.find((x) => String(x.id) === profile.grantId);
        g.consumed += g.available;
        g.available = 0;
      }),
  ],
  [
    "grant expired at observation",
    (b) =>
      (b.denial.observation.observedAt = new Date(
        profile.grant.expires * 1000,
      ).toISOString()),
  ],
  [
    "wrong recorded app owner",
    (b) =>
      snapshotChange(
        b,
        (s) =>
          (s.apps.find((x) => String(x.id) === profile.app.appId).owner =
            "eosio"),
      ),
  ],
  [
    "prior reservation identifier",
    (b) =>
      snapshotChange(b, (s) =>
        s.reservations.push({ id: b.denial.reservationId }),
      ),
  ],
  [
    "prior obligation identifier",
    (b) =>
      snapshotChange(b, (s) =>
        s.reservations.push({ id: "2", obligation: b.denial.reservationId }),
      ),
  ],
  [
    "prior effect identifier",
    (b) =>
      snapshotChange(b, (s) => s.effects.push({ id: b.denial.reservationId })),
  ],
  [
    "promoted RAM observation",
    (b) => (b.ramObservation.independentlyVerified = true),
  ],
  ["injected policy verdict", (b) => (b.aegisPolicyVerdict = "VALID")],
];
for (const [name, mutate] of mutations)
  test("v2 rejects " + name, async () => {
    const b = fresh();
    mutate(b);
    await assert.rejects(() => verify(b));
  });
for (const [name, change] of [
  ["missing registration transaction", (r) => (r.transactions = [])],
  ["nonexecuted registration", (r) => (r.transactions[0].status = "soft_fail")],
  [
    "wrong registration transaction",
    (r) => (r.transactions[0].trx.id = sample.write.transactionId),
  ],
  ["wrong registration block", (r) => (r.id = sample.write.blockId)],
])
  test("v2 rejects RPC " + name, async () => {
    await assert.rejects(
      () =>
        verify(fresh(), {
          rpc: fixtureRpc((r, m, b) => {
            if (
              m === "get_block" &&
              b.block_num_or_id === sample.registration.block
            )
              change(r);
          }),
        }),
      VerificationError,
    );
  });
test("v2 rejects insufficient finality", async () => {
  await assert.rejects(
    () =>
      verify(fresh(), {
        rpc: fixtureRpc((r, m) => {
          if (m === "get_info")
            r.last_irreversible_block_num = sample.registration.block - 1;
        }),
      }),
    VerificationError,
  );
});
test("historical checks still pass after grant expiry; fabricated observation never gains provenance", async () => {
  const b = fresh();
  b.ramObservation.bytes = 999;
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ["2030-01-01T00:00:00Z"]));
    }
    static now() {
      return RealDate.parse("2030-01-01T00:00:00Z");
    }
  };
  try {
    const r = await verify(b, { rpc: fixtureRpc() });
    assert.equal(r.status, "PUBLIC_CHAIN_CHECKS_PASSED");
    assert.equal(
      r.claims.find((x) => x.claim === "RAM trace").level,
      "RECORDED_ONLY",
    );
  } finally {
    globalThis.Date = RealDate;
  }
});
test("v2 network failure remains inconclusive", async () => {
  await assert.rejects(
    () =>
      verify(fresh(), {
        rpc: async () => {
          throw new VerificationError("Unavailable", true);
        },
      }),
    (e) => e.unavailable === true,
  );
});
test("CLI explicitly selects new profile and fails closed without it", () => {
  const cwd = new URL("..", import.meta.url);
  const run = (args) =>
    spawnSync(
      process.execPath,
      ["verify.mjs", "examples/jungle4-external-lifecycle.json", ...args],
      { cwd, encoding: "utf8" },
    );
  const good = run(["--profile", "external-v2", "--offline"]);
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).version, 2);
  for (const args of [
    ["--offline"],
    ["--profile", "bad", "--offline"],
    ["--profile", "external-v2", "--offline", "--profile", "legacy"],
  ])
    assert.equal(run(args).status, 1);
});
