import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Action, SignedTransaction, ABI, Serializer } from "@wharfkit/antelope";
import {
  compile,
  validateSignedIntent,
  type SignedReceipt,
} from "../packages/core/src/index.ts";
import { verifyReceipt } from "../services/gateway/src/receipt.ts";
import { Jungle, actionData } from "../services/gateway/src/chain.ts";
const [file, keyFile] = process.argv.slice(2);
if (!file || !keyFile)
  throw new Error(
    "Usage: pnpm verify evidence.json independently-pinned-receipt-public.pem. Live: set VERIFY_RPC, VERIFY_CODE_HASH, VERIFY_RELAYER, VERIFY_ABI_PATH.",
  );
const evidence = JSON.parse(readFileSync(file, "utf8"));
const attestation: SignedReceipt = evidence.attestation;
if (!attestation || !verifyReceipt(attestation, readFileSync(keyFile, "utf8")))
  throw new Error("INVALID receipt signature or public-key pin");
const receipt = attestation.receipt;
const app = compile(evidence.app.spec);
// Historical verification: signature and policy binding, not permission to execute now.
const verified = await validateSignedIntent(
  evidence.intent,
  evidence.signature,
  app,
  evidence.intent.runtime,
  evidence.intent.expires - 1,
);
if (
  receipt.intentHash !== verified.hash ||
  receipt.appId !== app.appId ||
  receipt.owner !== verified.intent.owner ||
  receipt.action !== verified.intent.action
)
  throw new Error("INVALID receipt-to-intent binding");
if (receipt.mode === "SIMULATED") {
  if (
    receipt.transactionId !== null ||
    receipt.blockNum !== null ||
    receipt.ram.delta !== null ||
    receipt.status !== "SIMULATED"
  )
    throw new Error("INVALID simulation claims");
  console.log(
    "VALID_SIGNATURES / SIMULATED: EOA intent and pinned Ed25519 receipt verified. No blockchain execution claimed.",
  );
} else if (receipt.mode === "JUNGLE4") {
  const { VERIFY_RPC, VERIFY_CODE_HASH, VERIFY_RELAYER, VERIFY_ABI_PATH } =
    process.env;
  if (!VERIFY_RPC || !VERIFY_CODE_HASH || !VERIFY_RELAYER || !VERIFY_ABI_PATH)
    throw new Error(
      "UNKNOWN: live verification requires independent RPC, code hash, relayer and local ABI pins",
    );
  if (verified.intent.runtimeCodeHash !== "0x" + VERIFY_CODE_HASH)
    throw new Error("INVALID: signed runtime pin mismatch");
  if (
    !receipt.transactionId ||
    !receipt.blockNum ||
    !evidence.prepared?.transaction
  )
    throw new Error("UNKNOWN: inclusion evidence incomplete");
  const tx = SignedTransaction.from(evidence.prepared.transaction);
  if (String(tx.id) !== receipt.transactionId)
    throw new Error("INVALID transaction digest");
  const abi = JSON.parse(readFileSync(VERIFY_ABI_PATH, "utf8"));
  const abiHash = createHash("sha256")
    .update(Serializer.encode({ object: ABI.from(abi) }).array)
    .digest("hex");
  if (
    evidence.deployment &&
    (evidence.deployment.chainId !== verified.intent.destination ||
      evidence.deployment.runtime !== verified.intent.runtime ||
      evidence.deployment.codeHash !== VERIFY_CODE_HASH ||
      evidence.deployment.abiHash !== abiHash ||
      evidence.deployment.runtimeVersion !== verified.intent.runtimeVersion ||
      evidence.deployment.policy !== verified.intent.policy ||
      evidence.deployment.abiHashSigned !== false)
  )
    throw new Error("INVALID deployment manifest or ABI pin");
  if (
    receipt.ram.executionTrace &&
    receipt.ram.executionTrace.payer !== VERIFY_RELAYER
  )
    throw new Error("INVALID trace payer");
  const expected = Action.from(
    {
      account: verified.intent.runtime,
      name: "execute",
      authorization: [{ actor: VERIFY_RELAYER, permission: "relay" }],
      data: actionData(verified.intent, verified.payload, verified.hash),
    },
    abi,
  );
  if (
    tx.actions.length !== 1 ||
    JSON.stringify(tx.actions[0]) !== JSON.stringify(expected) ||
    tx.context_free_actions.length !== 0
  )
    throw new Error(
      "INVALID: transaction does not encode exactly the signed intent",
    );
  const chain = new Jungle(
    VERIFY_RPC,
    verified.intent.runtime,
    VERIFY_RELAYER,
    "",
    VERIFY_CODE_HASH,
    "relay",
    abiHash,
  );
  if (!(await chain.finality(receipt.transactionId, receipt.blockNum)))
    throw new Error(
      "UNKNOWN: transaction not found in an irreversible block at independent RPC",
    );
  console.log(
    "VERIFIED_VIA_RPC: signatures, intent-to-transaction binding, code pin and irreversible inclusion match. RPC trust remains; historical RAM attribution is not proven.",
  );
} else throw new Error("INVALID evidence mode");
