#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { auditAegisAccounting } from "./bridge.mjs";
import {
  verifyEvidence,
  createRpc,
  VerificationError,
} from "../verifier/verifier.mjs";
const profile = JSON.parse(
  readFileSync(new URL("../verifier/profile-external.json", import.meta.url)),
);
export async function verifyObservedFlow(bundle, { rpc, rpcName } = {}) {
  if (typeof rpc !== "function")
    throw new VerificationError("Flow verification requires read-only RPC");
  // Reject malformed or altered signed consent before any network request.
  await verifyEvidence(bundle, { profileName: "external-v2" });
  const before = await auditAegisAccounting({ rpc, rpcName });
  const snapshot = before.observation.snapshot;
  let watermark = before.observation.window.end;
  const selectedIds = {
    apps: profile.app.appId,
    grants: profile.grantId,
    reservations: bundle.write.reservationId,
    effects: bundle.write.reservationId,
  };
  const boundRpc = async (method, body) => {
    if (method !== "get_table_rows") {
      if (
        !["get_info", "get_code_hash", "get_raw_abi", "get_block"].includes(
          method,
        )
      )
        throw new VerificationError("Unexpected lifecycle RPC method");
      const response = await rpc(method, body);
      if (method === "get_info") {
        const head = response.head_block_num,
          lib = response.last_irreversible_block_num;
        if (
          !Number.isSafeInteger(head) ||
          !Number.isSafeInteger(lib) ||
          head < lib ||
          head < watermark.headBlock ||
          lib < watermark.lastIrreversibleBlock
        )
          throw new VerificationError(
            "Lifecycle verification window regressed or malformed",
            true,
          );
        watermark = { headBlock: head, lastIrreversibleBlock: lib };
      }
      return response;
    }
    if (
      body.code !== profile.contract ||
      body.scope !== profile.contract ||
      !["apps", "grants", "reservations", "effects"].includes(body.table) ||
      body.json !== true ||
      body.lower_bound !== selectedIds[body.table] ||
      body.limit !== 1 ||
      body.lower_bound !== body.upper_bound
    )
      throw new VerificationError("Unexpected lifecycle state query");
    const rows = snapshot[body.table]
      .filter((row) => row.id === body.lower_bound)
      .map((row) => {
        const copy = { ...row };
        if (body.table === "grants") {
          copy.expires = Number(copy.expires);
          if (!Number.isSafeInteger(copy.expires))
            throw new VerificationError("Unsafe grant expiry");
        }
        return copy;
      });
    return { rows, more: false };
  };
  // Existing signature, exact action, state binding and inclusion checks are
  // reused; current-row checks consume the SAME ledger as Aegis accounting.
  const lifecycle = await verifyEvidence(bundle, {
    profileName: "external-v2",
    rpc: boundRpc,
    rpcName,
  });
  const after = await auditAegisAccounting({ rpc, rpcName });
  if (before.aegis.observationDigest !== after.aegis.observationDigest)
    throw new VerificationError(
      "Whole ledger changed across lifecycle verification",
      true,
    );
  const a = watermark,
    b = after.observation.window.start;
  if (
    b.headBlock < a.headBlock ||
    b.lastIrreversibleBlock < a.lastIrreversibleBlock
  )
    throw new VerificationError("Outer verification window regressed", true);
  return {
    version: 1,
    status: "OBSERVED_LIFECYCLE_ACCOUNTING_MATCH",
    profile: profile.id,
    checkedAt: after.observation.checkedAt,
    rpc: rpcName ?? "CALLER_SUPPLIED",
    binding: {
      appId: profile.app.appId,
      appHash: profile.app.appHash,
      owner: profile.app.owner,
      grantId: profile.grantId,
      reservationId: bundle.write.reservationId,
      registrationTransaction: bundle.registration.transactionId,
      writeTransaction: bundle.write.transactionId,
      revocationTransaction: bundle.revocation.transactionId,
      observationDigest: after.aegis.observationDigest,
    },
    lifecycle,
    accounting: after,
    window: {
      before: before.observation.window,
      after: after.observation.window,
    },
    executionAuthorized: false,
    authenticatedCheckpoint: false,
    completeAuthorityHistory: false,
    aegisPolicyVerdict: "NOT_EVALUATED",
    vaultRamBacking: "UNAVAILABLE",
    trust:
      "Lifecycle current-row checks use the same complete RPC-observed ledger as Aegis accounting. Equal observations before/after are not atomic or consensus-authenticated. Historical code/permission continuity and complete intervening history are not established. Denial and RAM trace remain recorded-only. No V capacity or fresh execution authority is granted.",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [path, name = "cryptolions", ...extra] = process.argv.slice(2);
    if (!path || extra.length || !["cryptolions", "greymass"].includes(name))
      throw new VerificationError(
        "Usage: node packages/aegis-bridge/verify-flow.mjs PROOF.json [cryptolions|greymass]",
      );
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 2_000_000)
      throw new VerificationError(
        "Evidence must be a regular JSON file of at most 2 MB",
      );
    const result = await verifyObservedFlow(
      JSON.parse(readFileSync(path, "utf8")),
      { rpc: createRpc(name), rpcName: name },
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const unavailable = error instanceof VerificationError && error.unavailable;
    console.log(
      JSON.stringify({
        status: unavailable ? "INCONCLUSIVE" : "INVALID",
        reason:
          error instanceof VerificationError
            ? error.message
            : "Flow verification failed",
        executionAuthorized: false,
        aegisPolicyVerdict: "NOT_EVALUATED",
        vaultRamBacking: "UNAVAILABLE",
      }),
    );
    process.exitCode = unavailable ? 2 : 1;
  }
}
