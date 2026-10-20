import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { inspectAegisAccounting, auditAegisAccounting } from "../bridge.mjs";
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const sample = read("../../verifier/examples/jungle4-external-lifecycle.json")
  .denial.observation.after[0];
const profile = read("../../verifier/profile-external.json");
const fresh = () => structuredClone(sample);
function rpc(change = () => {}) {
  return async (method, body) => {
    let r;
    if (method === "get_info")
      r = {
        chain_id: profile.chainId,
        head_block_num: 300000100,
        last_irreversible_block_num: 300000000,
      };
    else if (method === "get_code_hash") r = { code_hash: profile.codeHash };
    else if (method === "get_raw_abi") r = { abi_hash: profile.abiHash };
    else if (method === "get_table_rows") {
      assert.equal(body.code, profile.contract);
      r = {
        rows: structuredClone(sample[body.table]),
        more: false,
        next_key: "",
      };
    } else assert.fail("Mutation/unexpected RPC method: " + method);
    change(r, method, body);
    return r;
  };
}
test("actual upstream kernel conserves full real recorded ledger, without granting authority or capacity", async () => {
  const r = await inspectAegisAccounting(fresh());
  assert.deepEqual(r.result, {
    root_authorized: 10000,
    available: 9997,
    reserved: 1,
    quarantined: 0,
    consumed: 2,
    released: 0,
    accounted: 10000,
    conserved: true,
  });
  assert.equal(r.source.commit, "01bcce77bce0bd13ae2bb10d691f5c6c4a7c6038");
  assert.equal(r.executionAuthorized, false);
  assert.equal(r.aegisPolicyVerdict, "NOT_EVALUATED");
  assert.equal(r.vaultRamBacking, "UNAVAILABLE");
  assert.equal(r.unit, "UNBACKED_TEST_WRITE");
});
test("preserves quarantined value without making it available", async () => {
  const s = fresh(),
    r = s.reservations.find((r) => r.status === 0),
    g = s.grants.find((g) => String(g.id) === String(r.grant_id));
  r.status = 2;
  g.reserved--;
  g.quarantined++;
  const a = await inspectAegisAccounting(s);
  assert.equal(a.result.quarantined, 1);
  assert.equal(a.result.reserved, 0);
  assert.equal(a.result.available, 9997);
});
for (const [label, mutate] of [
  ["missing grant", (s) => s.grants.pop()],
  ["root overissue", (s) => s.root[0].available++],
  ["missing effect", (s) => s.effects.pop()],
  ["duplicate reservation", (s) => s.reservations.push(s.reservations[0])],
  ["unknown reservation status", (s) => (s.reservations[0].status = 9)],
  ["invented capacity", (s) => (s.capacityCertificate = { valid: true })],
  ["false effect linkage", (s) => (s.effects[0].grant_id = "999")],
])
  test("rejects " + label + " before reporting conservation", async () => {
    const s = fresh();
    mutate(s);
    await assert.rejects(inspectAegisAccounting(s));
  });
test("read-only fresh observation binds exact normalized digest", async () => {
  const r = await auditAegisAccounting({ rpc: rpc(), rpcName: "fixture" });
  assert.equal(r.observation.observationDigest, r.aegis.observationDigest);
  assert.equal(r.observation.status, "STABLE_CURRENT_RPC_OBSERVATION");
});
test("wrong code pin cannot be reported as success", async () => {
  await assert.rejects(
    auditAegisAccounting({
      rpc: rpc((r, m) => {
        if (m === "get_code_hash") r.code_hash = "0".repeat(64);
      }),
    }),
  );
});
test("incomplete pagination cannot be reported as success", async () => {
  await assert.rejects(
    auditAegisAccounting({
      rpc: rpc((r, m) => {
        if (m === "get_table_rows") r.more = true;
      }),
    }),
  );
});
test("transport failure does not synthesize a fixture or successful report", async () => {
  await assert.rejects(
    auditAegisAccounting({
      rpc: async () => {
        throw Error("offline");
      },
    }),
  );
});
test("source and license are exact pinned bytes", () => {
  const p = read("../provenance.json");
  for (const [file, hash] of Object.entries(p.files))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL("../" + file, import.meta.url)))
        .digest("hex"),
      hash,
    );
});
test("tampered vendor is rejected before code executes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aegis-pin-"));
  try {
    mkdirSync(join(dir, "aegis-bridge/vendor"), { recursive: true });
    symlinkSync(
      new URL("../../verifier/", import.meta.url).pathname,
      join(dir, "verifier"),
    );
    for (const file of ["bridge.mjs", "provenance.json"])
      copyFileSync(
        new URL("../" + file, import.meta.url),
        join(dir, "aegis-bridge", file),
      );
    writeFileSync(
      join(dir, "aegis-bridge/vendor/authority-kernel.js"),
      'throw new Error("UNVERIFIED_CODE_EXECUTED")',
    );
    const isolated = await import(
      pathToFileURL(join(dir, "aegis-bridge/bridge.mjs"))
    );
    await assert.rejects(
      isolated.inspectAegisAccounting(fresh()),
      /Pinned Aegis source mismatch/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
