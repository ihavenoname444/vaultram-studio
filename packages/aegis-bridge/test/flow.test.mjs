import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyObservedFlow } from "../verify-flow.mjs";
const sample = JSON.parse(
  readFileSync(
    new URL(
      "../../verifier/examples/jungle4-external-lifecycle.json",
      import.meta.url,
    ),
  ),
);
const profile = JSON.parse(
  readFileSync(
    new URL("../../verifier/profile-external.json", import.meta.url),
  ),
);
const fresh = () => structuredClone(sample);
function fixture(change = () => {}) {
  let infoCount = 0;
  const calls = [];
  const rpc = async (method, body) => {
    calls.push({ method, body });
    let r;
    if (method === "get_info") {
      infoCount++;
      r = {
        chain_id: profile.chainId,
        head_block_num: 300000100,
        last_irreversible_block_num: 300000000,
      };
    } else if (method === "get_code_hash") r = { code_hash: profile.codeHash };
    else if (method === "get_raw_abi") r = { abi_hash: profile.abiHash };
    else if (method === "get_table_rows") {
      assert.equal(
        body.lower_bound,
        undefined,
        "Must not use separate filtered current state",
      );
      r = {
        rows: structuredClone(sample.denial.observation.after[0][body.table]),
        more: false,
        next_key: "",
      };
    } else if (method === "get_block") {
      const x = [sample.registration, sample.write, sample.revocation].find(
        (x) => x.block === body.block_num_or_id,
      );
      assert.ok(x);
      r = {
        block_num: x.block,
        id: x.blockId,
        transactions: [{ status: "executed", trx: { id: x.transactionId } }],
      };
    } else assert.fail("Unexpected/mutating method " + method);
    change(r, method, body, infoCount);
    return r;
  };
  return { rpc, calls };
}
test("binds actual signed lifecycle and complete accounting with no writes or upgraded claims", async () => {
  const f = fixture(),
    r = await verifyObservedFlow(fresh(), { rpc: f.rpc, rpcName: "fixture" });
  assert.equal(r.status, "OBSERVED_LIFECYCLE_ACCOUNTING_MATCH");
  assert.equal(
    r.binding.registrationTransaction,
    sample.registration.transactionId,
  );
  assert.equal(
    r.binding.observationDigest,
    r.accounting.aegis.observationDigest,
  );
  assert.equal(r.accounting.aegis.result.accounted, 10000);
  assert.equal(r.executionAuthorized, false);
  assert.equal(r.authenticatedCheckpoint, false);
  assert.equal(r.completeAuthorityHistory, false);
  assert.equal(r.aegisPolicyVerdict, "NOT_EVALUATED");
  assert.equal(r.vaultRamBacking, "UNAVAILABLE");
  assert.equal(
    r.lifecycle.claims.find((c) => c.claim.startsWith("Historical post-revoke"))
      .level,
    "RECORDED_ONLY",
  );
  assert.equal(f.calls.filter((c) => c.method === "get_table_rows").length, 20);
});
test("rejects altered owner consent before any RPC", async () => {
  const b = fresh();
  b.registration.spec.name = "Forged";
  const f = fixture();
  await assert.rejects(verifyObservedFlow(b, { rpc: f.rpc }));
  assert.equal(f.calls.length, 0);
});
test("requires online mode rather than upgrading offline checks", async () => {
  await assert.rejects(verifyObservedFlow(fresh()), /requires read-only RPC/);
});
test("wrong full-ledger app owner cannot hide behind otherwise valid inclusion", async () => {
  const f = fixture((r, m, b) => {
    if (m === "get_table_rows" && b.table === "apps")
      r.rows.find((x) => String(x.id) === profile.app.appId).owner =
        "other1111111";
  });
  await assert.rejects(verifyObservedFlow(fresh(), { rpc: f.rpc }));
});
test("balanced but unrevoked grant fails lifecycle binding", async () => {
  const f = fixture((r, m, b) => {
    if (m === "get_table_rows" && b.table === "grants")
      r.rows.find((x) => String(x.id) === profile.grantId).revoked = false;
  });
  await assert.rejects(verifyObservedFlow(fresh(), { rpc: f.rpc }));
});
test("wrong consumed payload fails exact signed-payload binding", async () => {
  const f = fixture((r, m, b) => {
    if (m === "get_table_rows" && b.table === "effects")
      r.rows.find((x) => String(x.id) === sample.write.reservationId).payload =
        "altered";
  });
  await assert.rejects(verifyObservedFlow(fresh(), { rpc: f.rpc }));
});
test("reverted inclusion cannot pass accounting alone", async () => {
  const f = fixture((r, m) => {
    if (m === "get_block") r.transactions[0].status = "soft_fail";
  });
  await assert.rejects(verifyObservedFlow(fresh(), { rpc: f.rpc }));
});
test("unrelated valid grant change between audits is inconclusive, no retry", async () => {
  const f = fixture((r, m, b, n) => {
    if (n >= 5 && m === "get_table_rows" && b.table === "grants") {
      const g = r.rows.find((g) => String(g.id) !== profile.grantId);
      g.revoked = !g.revoked;
    }
  });
  await assert.rejects(
    verifyObservedFlow(fresh(), { rpc: f.rpc }),
    (e) => e.unavailable === true && /changed/.test(e.message),
  );
  assert.equal(f.calls.filter((c) => c.method === "get_table_rows").length, 20);
});
test("outer head/LIB regression cannot hide within individually monotone audits", async () => {
  const f = fixture((r, m, b, n) => {
    if (m === "get_info" && n >= 5) {
      r.head_block_num -= 1;
      r.last_irreversible_block_num -= 1;
    }
  });
  await assert.rejects(
    verifyObservedFlow(fresh(), { rpc: f.rpc }),
    (e) => e.unavailable === true && /regressed/.test(e.message),
  );
});
test("final audit provider loss cannot return earlier success", async () => {
  const f = fixture((r, m, b, n) => {
    if (n >= 5) throw Error("offline");
  });
  await assert.rejects(verifyObservedFlow(fresh(), { rpc: f.rpc }));
});
test("post-lifecycle code swap is rejected", async () => {
  const f = fixture((r, m, b, n) => {
    if (n >= 5 && m === "get_code_hash") r.code_hash = "0".repeat(64);
  });
  await assert.rejects(verifyObservedFlow(fresh(), { rpc: f.rpc }));
});
test("lifecycle RPC cannot regress between whole-ledger audits", async () => {
  const f = fixture((r, m, b, n) => {
    if (m === "get_info" && n === 3) {
      r.head_block_num--;
      r.last_irreversible_block_num--;
    }
  });
  await assert.rejects(
    verifyObservedFlow(fresh(), { rpc: f.rpc }),
    (e) => e.unavailable === true && /regressed/.test(e.message),
  );
});
