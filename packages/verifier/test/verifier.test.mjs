import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  verifyEvidence,
  createRpc,
  endpoints,
  VerificationError,
} from "../verifier.mjs";

const sample = JSON.parse(
  readFileSync(new URL("../examples/jungle4-lifecycle.json", import.meta.url)),
);
const profile = JSON.parse(
  readFileSync(new URL("../profile.json", import.meta.url)),
);
const fresh = () => structuredClone(sample);
function fixtureRpc(change = () => {}) {
  // Explicit RPC fixtures; no tests in this file claim live chain execution.
  return async (method, body) => {
    let result;
    if (method === "get_info")
      result = {
        chain_id: profile.chainId,
        last_irreversible_block_num: sample.revocation.block + 100,
      };
    else if (method === "get_code_hash")
      result = { code_hash: profile.codeHash };
    else if (method === "get_raw_abi") result = { abi_hash: profile.abiHash };
    else if (method === "get_block") {
      const r =
        body.block_num_or_id === sample.write.block
          ? sample.write
          : sample.revocation;
      result = {
        block_num: r.block,
        id: r.blockId,
        transactions: [{ status: "executed", trx: { id: r.transactionId } }],
      };
    } else if (method === "get_table_rows") {
      const rows = sample.denial.observation.after[0][body.table].filter(
        (r) => String(r.id) === body.lower_bound,
      );
      result = { rows: structuredClone(rows), more: false };
    } else throw Error("Unexpected method");
    change(result, method, body);
    return result;
  };
}
test("offline checks do not claim chain verification or Aegis validity", async () => {
  const r = await verifyEvidence(fresh());
  assert.equal(r.status, "OFFLINE_CHECKS_PASSED");
  assert.equal(r.aegisPolicyVerdict, "NOT_EVALUATED");
  assert.equal(
    r.claims.some((c) => c.level === "VERIFIED_RPC"),
    false,
  );
});
test("online checks bind included transactions and current rows to the pinned profile", async () => {
  const r = await verifyEvidence(fresh(), { rpc: fixtureRpc() });
  assert.equal(r.status, "PUBLIC_CHAIN_CHECKS_PASSED");
  assert.equal(r.claims.filter((c) => c.level === "VERIFIED_RPC").length, 2);
  assert.equal(
    r.claims.find((c) => c.claim === "RAM trace").level,
    "RECORDED_ONLY",
  );
  assert.equal(r.aegisPolicyVerdict, "NOT_EVALUATED");
});

const badBundles = [
  [
    "profile substitution",
    (b) => {
      b.profile = "production";
    },
  ],
  [
    "extra trusted-profile override",
    (b) => {
      b.codeHash = "f".repeat(64);
    },
  ],
  [
    "missing lifecycle member",
    (b) => {
      delete b.revocation;
    },
  ],
  [
    "payload replacement",
    (b) => {
      b.write.payload += "!";
    },
  ],
  [
    "grant substitution",
    (b) => {
      b.write.transaction.actions[0].data =
        b.denial.transaction.actions[0].data;
    },
  ],
  [
    "contract substitution",
    (b) => {
      b.write.transaction.actions[0].account = "eosio.token";
    },
  ],
  [
    "owner permission substitution",
    (b) => {
      b.revocation.transaction.actions[0].authorization[0].permission = "owner";
    },
  ],
  [
    "extra action",
    (b) => {
      b.write.transaction.actions.push(b.revocation.transaction.actions[0]);
    },
  ],
  [
    "unsigned write",
    (b) => {
      b.write.transaction.signatures = [];
    },
  ],
  [
    "wrong signer",
    (b) => {
      b.write.transaction.signatures = b.revocation.transaction.signatures;
    },
  ],
  [
    "wrong-chain signature material",
    (b) => {
      b.revocation.transaction.signatures = b.denial.transaction.signatures;
    },
  ],
  [
    "additional signature",
    (b) => {
      b.denial.transaction.signatures.push(...b.denial.transaction.signatures);
    },
  ],
  [
    "context-free data",
    (b) => {
      b.write.transaction.context_free_data = ["01"];
    },
  ],
  [
    "transaction extension",
    (b) => {
      b.write.transaction.transaction_extensions = [[0, "00"]];
    },
  ],
  [
    "delayed transaction",
    (b) => {
      b.revocation.transaction.delay_sec = 1;
    },
  ],
  [
    "extra raw transaction field",
    (b) => {
      b.write.transaction.secret = "ignored-by-SDK";
    },
  ],
  [
    "forged transaction ID",
    (b) => {
      b.write.transactionId = "f".repeat(64);
    },
  ],
  [
    "wrong block ID",
    (b) => {
      b.write.blockId = "f".repeat(64);
    },
  ],
  [
    "reordered blocks",
    (b) => {
      b.write.block = b.revocation.block;
      b.write.blockId = b.revocation.blockId;
    },
  ],
  [
    "unsafe identifier",
    (b) => {
      b.write.reservationId = "18446744073709551616";
    },
  ],
  [
    "reused reservation",
    (b) => {
      b.denial.reservationId = b.write.reservationId;
    },
  ],
  [
    "different rejection",
    (b) => {
      b.denial.observation.error.details[0].message =
        "assertion failure with message: grant expired";
    },
  ],
  [
    "changed state",
    (b) => {
      b.denial.observation.after[0].grants[0].consumed++;
    },
  ],
  [
    "backing promotion",
    (b) => {
      b.ramObservation.independentlyVerified = true;
    },
  ],
  [
    "mismatched RAM transaction",
    (b) => {
      b.ramObservation.transactionId = b.revocation.transactionId;
    },
  ],
];
for (const [label, change] of badBundles)
  test("rejects " + label, async () => {
    const b = fresh();
    change(b);
    await assert.rejects(verifyEvidence(b));
  });

const badRpc = [
  [
    "wrong chain",
    (r, m) => {
      if (m === "get_info") r.chain_id = "f".repeat(64);
    },
  ],
  [
    "no finality",
    (r, m) => {
      if (m === "get_info")
        r.last_irreversible_block_num = sample.write.block - 1;
    },
  ],
  [
    "wrong current code",
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
    "missing block transaction",
    (r, m) => {
      if (m === "get_block") r.transactions = [];
    },
  ],
  [
    "failed block status",
    (r, m) => {
      if (m === "get_block") r.transactions[0].status = "hard_fail";
    },
  ],
  [
    "block substitution",
    (r, m) => {
      if (m === "get_block") r.id = "f".repeat(64);
    },
  ],
  [
    "missing row",
    (r, m) => {
      if (m === "get_table_rows") r.rows = [];
    },
  ],
  [
    "ambiguous row",
    (r, m) => {
      if (m === "get_table_rows") r.more = true;
    },
  ],
  [
    "owner substitution",
    (r, m, b) => {
      if (b.table === "apps") r.rows[0].owner = "attacker";
    },
  ],
  [
    "grant expansion",
    (r, m, b) => {
      if (b.table === "grants") r.rows[0].budget++;
    },
  ],
  [
    "unrevoked grant",
    (r, m, b) => {
      if (b.table === "grants") r.rows[0].revoked = 0;
    },
  ],
  [
    "effect payload substitution",
    (r, m, b) => {
      if (b.table === "effects") r.rows[0].payload += "!";
    },
  ],
  [
    "wrong effect grant",
    (r, m, b) => {
      if (b.table === "effects") r.rows[0].grant_id = 2;
    },
  ],
  [
    "unconsumed reservation",
    (r, m, b) => {
      if (b.table === "reservations") r.rows[0].status = 0;
    },
  ],
];
for (const [label, change] of badRpc)
  test("rejects RPC " + label, async () => {
    await assert.rejects(verifyEvidence(fresh(), { rpc: fixtureRpc(change) }));
  });
test("invented internally consistent observations never become authenticated facts", async () => {
  const b = fresh();
  b.ramObservation.bytes = 999999;
  b.denial.observation.observedAt = "2030-01-01T00:00:00Z";
  const result = await verifyEvidence(b, { rpc: fixtureRpc() });
  assert.equal(
    result.claims.find((c) => c.claim === "RAM trace").level,
    "RECORDED_ONLY",
  );
  assert.equal(
    result.claims.find((c) => c.claim.startsWith("Historical post-revoke"))
      .level,
    "RECORDED_ONLY",
  );
});
test("RPC transport can only call pinned read-only methods", async () => {
  const calls = [];
  const rpc = createRpc("cryptolions", async (url, options) => {
    calls.push({ url, options });
    return new Response('{"ok":true}');
  });
  assert.deepEqual(await rpc("get_info", {}), { ok: true });
  assert.equal(calls[0].url, endpoints.cryptolions + "/v1/chain/get_info");
  assert.equal(calls[0].options.redirect, "error");
  await assert.rejects(rpc("send_transaction", {}));
  assert.equal(calls.length, 1);
  assert.throws(() => createRpc("https://attacker.invalid"));
});
test("network failures and oversized/malformed replies are inconclusive", async () => {
  for (const transport of [
    async () => {
      throw Error("secret remote error");
    },
    async () => new Response("not JSON"),
    async () => new Response("x".repeat(8_000_001)),
    async () => new Response("failure", { status: 503 }),
  ]) {
    await assert.rejects(
      createRpc("cryptolions", transport)("get_info", {}),
      (e) =>
        e instanceof VerificationError &&
        e.unavailable &&
        !e.message.includes("secret"),
    );
  }
});
test("CLI offline exit and invalid-option behavior", () => {
  const cwd = new URL("../", import.meta.url);
  const ok = spawnSync(
    process.execPath,
    ["verify.mjs", "examples/jungle4-lifecycle.json", "--offline"],
    { cwd, encoding: "utf8" },
  );
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).status, "OFFLINE_CHECKS_PASSED");
  const bad = spawnSync(
    process.execPath,
    [
      "verify.mjs",
      "examples/jungle4-lifecycle.json",
      "--rpc",
      "https://attacker.invalid",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).status, "INVALID");
});
