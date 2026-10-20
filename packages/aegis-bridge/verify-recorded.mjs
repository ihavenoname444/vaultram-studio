#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { inspectAegisAccounting } from "./bridge.mjs";
import { VerificationError } from "../verifier/verifier.mjs";
const profile = JSON.parse(
  readFileSync(new URL("../verifier/profile-external.json", import.meta.url)),
);
export async function verifyRecordedAccounting(report) {
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    Object.keys(report).length !== 2 ||
    !report.observation ||
    !report.aegis
  )
    throw new VerificationError(
      "Expected one exported observation and Aegis report",
    );
  const o = report.observation;
  if (
    o.profile !== profile.id ||
    o.chainId !== profile.chainId ||
    o.contract !== profile.contract ||
    o.codeHash !== profile.codeHash ||
    o.abiHash !== profile.abiHash
  )
    throw new VerificationError(
      "Recorded deployment does not match reviewed profile",
    );
  const expected = await inspectAegisAccounting(o.snapshot);
  if (
    o.observationDigest !== expected.observationDigest ||
    !isDeepStrictEqual(report.aegis, expected)
  )
    throw new VerificationError(
      "Recorded Aegis report differs from recomputed result",
    );
  // Do not copy RPC labels, timestamp, head/LIB claims or any asserted proof
  // into this result. Offline input cannot authenticate its origin/freshness.
  return {
    version: 1,
    status: "RECORDED_ACCOUNTING_CONSISTENT",
    observationDigest: expected.observationDigest,
    result: expected.result,
    unit: expected.unit,
    executionAuthorized: false,
    aegisPolicyVerdict: "NOT_EVALUATED",
    vaultRamBacking: "UNAVAILABLE",
    chainStateAuthenticated: false,
    currentStateChecked: false,
    trust:
      "Only accounting consistency of supplied data was checked. Source, observation time, RPC responses, finality and current chain state were not authenticated.",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 3)
      throw new VerificationError(
        "Usage: node packages/aegis-bridge/verify-recorded.mjs EXPORTED_REPORT.json",
      );
    const path = process.argv[2],
      stat = statSync(path);
    if (!stat.isFile() || stat.size > 2_000_000)
      throw new VerificationError(
        "Report must be a regular JSON file of at most 2 MB",
      );
    console.log(
      JSON.stringify(
        await verifyRecordedAccounting(JSON.parse(readFileSync(path, "utf8"))),
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        status: "INVALID",
        reason:
          error instanceof VerificationError
            ? error.message
            : "Recorded report could not be checked",
        executionAuthorized: false,
      }),
    );
    process.exitCode = 1;
  }
}
