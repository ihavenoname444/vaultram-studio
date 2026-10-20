#!/usr/bin/env node
import { createRpc, VerificationError } from "./verifier.mjs";
import { auditNativeState } from "./native-state.mjs";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(
    "Usage: node audit-state.mjs [--rpc cryptolions|greymass]\nRead-only audit of all native test-write accounting; not Aegis acceptance or V backing.",
  );
} else {
  try {
    const name =
      args.length === 0
        ? "cryptolions"
        : args.length === 2 && args[0] === "--rpc"
          ? args[1]
          : null;
    if (!["cryptolions", "greymass"].includes(name))
      throw new VerificationError("Invalid native audit CLI options");
    console.log(
      JSON.stringify(
        await auditNativeState({ rpc: createRpc(name), rpcName: name }),
        null,
        2,
      ),
    );
  } catch (error) {
    const unavailable = error instanceof VerificationError && error.unavailable;
    console.log(
      JSON.stringify(
        {
          status: unavailable ? "INCONCLUSIVE" : "INVALID",
          reason:
            error instanceof VerificationError
              ? error.message
              : "Malformed native state or unsupported encoding",
          aegisPolicyVerdict: "NOT_EVALUATED",
        },
        null,
        2,
      ),
    );
    process.exitCode = unavailable ? 2 : 1;
  }
}
