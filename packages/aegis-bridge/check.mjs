#!/usr/bin/env node
import { auditAegisAccounting } from "./bridge.mjs";
import { createRpc, VerificationError } from "../verifier/verifier.mjs";
try {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length && !["cryptolions", "greymass"].includes(args[0]))
  )
    throw new VerificationError(
      "Usage: node packages/aegis-bridge/check.mjs [cryptolions|greymass]",
    );
  const rpcName = args[0] ?? "cryptolions";
  console.log(
    JSON.stringify(
      await auditAegisAccounting({ rpc: createRpc(rpcName), rpcName }),
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      status:
        error instanceof VerificationError && error.unavailable
          ? "INCONCLUSIVE"
          : "INVALID",
      reason:
        error instanceof VerificationError
          ? error.message
          : "Aegis audit failed",
      executionAuthorized: false,
    }),
  );
  process.exitCode = 1;
}
