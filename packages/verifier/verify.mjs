#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { verifyEvidence, createRpc, VerificationError } from "./verifier.mjs";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(
    "Usage: node verify.mjs PROOF.json [--offline | --rpc cryptolions|greymass]\nDefault: fresh read-only checks via CryptoLions. No wallets or private keys.",
  );
  process.exit(args.includes("--help") ? 0 : 1);
}
try {
  const [path, ...flags] = args;
  const offline = flags.length === 1 && flags[0] === "--offline";
  const selected =
    flags.length === 0
      ? "cryptolions"
      : flags.length === 2 && flags[0] === "--rpc"
        ? flags[1]
        : null;
  if (!offline && !["cryptolions", "greymass"].includes(selected))
    throw new VerificationError("Invalid CLI options");
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 2_000_000)
    throw new VerificationError(
      "Evidence must be a regular JSON file of at most 2 MB",
    );
  const bundle = JSON.parse(readFileSync(path, "utf8"));
  const result = await verifyEvidence(bundle, {
    rpc: offline ? undefined : createRpc(selected),
    rpcName: offline ? undefined : selected,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Never echo input JSON, arbitrary RPC text, local paths, or raw exceptions.
  const unavailable = error instanceof VerificationError && error.unavailable;
  console.log(
    JSON.stringify(
      {
        status: unavailable ? "INCONCLUSIVE" : "INVALID",
        reason:
          error instanceof VerificationError
            ? error.message
            : "Malformed evidence or unsupported encoding",
        aegisPolicyVerdict: "NOT_EVALUATED",
      },
      null,
      2,
    ),
  );
  process.exitCode = unavailable ? 2 : 1;
}
