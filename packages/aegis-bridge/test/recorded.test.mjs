import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyRecordedAccounting } from "../verify-recorded.mjs";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../docs/evidence/owner-app-v2/aegis-accounting.json",
      import.meta.url,
    ),
  ),
).reports[0];
const fresh = () => structuredClone(fixture);
test("recomputes recorded report without authenticating any chain claim", async () => {
  const r = await verifyRecordedAccounting(fresh());
  assert.equal(r.status, "RECORDED_ACCOUNTING_CONSISTENT");
  assert.equal(r.result.accounted, 10000);
  assert.equal(r.chainStateAuthenticated, false);
  assert.equal(r.currentStateChecked, false);
  assert.equal(r.executionAuthorized, false);
});
for (const [label, change] of [
  ["inflated result", (r) => r.aegis.result.available++],
  ["fake V backing", (r) => (r.aegis.vaultRamBacking = "VERIFIED")],
  ["fake authorization", (r) => (r.aegis.executionAuthorized = true)],
  ["changed source", (r) => (r.aegis.source.commit = "a".repeat(40))],
  ["changed snapshot", (r) => r.observation.snapshot.root[0].available++],
  ["changed digest", (r) => (r.observation.observationDigest = "0".repeat(64))],
  ["wrong chain", (r) => (r.observation.chainId = "0".repeat(64))],
  ["extra certificate", (r) => (r.aegis.capacityCertificate = { valid: true })],
  ["missing field", (r) => delete r.aegis.missing],
  ["extra top-level claim", (r) => (r.authorized = true)],
])
  test("rejects " + label, async () => {
    const r = fresh();
    change(r);
    await assert.rejects(verifyRecordedAccounting(r));
  });
test("untrusted timestamp and finality claims are never promoted", async () => {
  const r = fresh();
  r.observation.checkedAt = "2099-01-01";
  r.observation.authenticatedCheckpoint = true;
  r.observation.window.end.lastIrreversibleBlock = 999999999;
  const result = await verifyRecordedAccounting(r);
  assert.equal(result.chainStateAuthenticated, false);
  assert.equal(result.currentStateChecked, false);
  assert.equal("checkedAt" in result, false);
  assert.equal("window" in result, false);
});
test("CLI returns nonzero and sanitized error for malformed input", () => {
  const dir = mkdtempSync(join(tmpdir(), "aegis-report-"));
  try {
    const p = join(dir, "input.json");
    writeFileSync(p, "{PRIVATE_SENTINEL");
    const r = spawnSync(
      process.execPath,
      [new URL("../verify-recorded.mjs", import.meta.url).pathname, p],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).status, "INVALID");
    assert.ok(!r.stdout.includes("PRIVATE_SENTINEL"));
    assert.ok(!r.stdout.includes(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
