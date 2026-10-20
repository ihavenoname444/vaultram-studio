import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  auditNativeState,
  inspectNativeState,
} from "../verifier/native-state.mjs";
import { VerificationError } from "../verifier/verifier.mjs";
const provenance = JSON.parse(
  readFileSync(new URL("./provenance.json", import.meta.url)),
);
const sourceUrl = new URL("./vendor/authority-kernel.js", import.meta.url);
const sha = (v) => createHash("sha256").update(v).digest("hex");
async function kernel() {
  const bytes = readFileSync(sourceUrl);
  if (sha(bytes) !== provenance.files["vendor/authority-kernel.js"])
    throw new VerificationError("Pinned Aegis source mismatch");
  // Execute the exact verified, self-contained upstream bytes, not a second file
  // read or a caller-supplied path. No fixtures/defaultState or dynamic providers.
  return import("data:text/javascript;base64," + bytes.toString("base64"));
}
export async function inspectAegisAccounting(raw) {
  const checked = inspectNativeState(raw);
  const s = checked.snapshot;
  const holders = Object.fromEntries([
    ["root", { available: s.root[0].available }],
    ...s.grants.map((g) => ["grant:" + g.id, { available: g.available }]),
  ]);
  const reservations = Object.fromEntries(
    s.reservations.map((r) => [
      "reservation:" + r.id,
      { amount: 1, status: ["RESERVED", "CONSUMED", "QUARANTINED"][r.status] },
    ]),
  );
  const { conservationReport } = await kernel();
  const result = conservationReport({
    root_authorized: s.root[0].total,
    holders,
    reservations,
  });
  const c = checked.accounting;
  if (
    result.conserved !== true ||
    result.root_authorized !== c.rootTotal ||
    result.accounted !== c.rootTotal ||
    result.available !== c.rootAvailable + c.grantCounters.available ||
    result.reserved !== c.grantCounters.reserved ||
    result.quarantined !== c.grantCounters.quarantined ||
    result.consumed !== c.grantCounters.consumed ||
    result.released !== 0
  )
    throw new VerificationError("Aegis/native accounting mismatch");
  return {
    version: 1,
    check: "AEGIS_REFERENCE_CONSERVATION",
    scope: "NATIVE_TEST_WRITE_ACCOUNTING_ONLY",
    source: {
      repository: provenance.repository,
      commit: provenance.commit,
      version: provenance.version,
      module: "src/authority-kernel.js",
      sha256: provenance.files["vendor/authority-kernel.js"],
      function: "conservationReport",
    },
    observationDigest: checked.observationDigest,
    unit: "UNBACKED_TEST_WRITE",
    result,
    executionAuthorized: false,
    aegisPolicyVerdict: "NOT_EVALUATED",
    vaultRamBacking: "UNAVAILABLE",
    missing: [
      "AUTHENTICATED_AUTHORITY_HISTORY",
      "ACCEPTED_UNIVERSE_ROOT_AND_POLICY_BINDINGS",
      "VERIFIED_VAULTRAM_CAPACITY_INTERFACE",
      "UNIQUE_RESOURCE_ENCUMBRANCE",
      "COMPLETE_MEDIATION_AND_CUSTODY_ISOLATION",
    ],
    trust:
      "Accounting projection only. Includes revoked/expired available balances; neither executable authority nor an authenticated Aegis state/checkpoint. No V, RAM-byte or certificate conversion.",
  };
}
export async function auditAegisAccounting(options) {
  const observation = await auditNativeState(options);
  const aegis = await inspectAegisAccounting(observation.snapshot);
  if (aegis.observationDigest !== observation.observationDigest)
    throw new VerificationError("Aegis observation binding mismatch");
  return { observation, aegis };
}
