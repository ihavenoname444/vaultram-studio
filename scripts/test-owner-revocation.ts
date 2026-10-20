// Explicit, one-shot Jungle4 denial test. Reads only the restricted agent config.
// An existing journal prevents resend, including after an uncertain outcome.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import {
  ABI,
  Action,
  APIClient,
  FetchProvider,
  PrivateKey,
  PublicKey,
  Transaction,
  SignedTransaction,
} from "@wharfkit/antelope";
import { AuthorityConfig } from "../services/gateway/src/authority.ts";
import { readPrivateJson } from "../services/gateway/src/private-file.ts";
import { JUNGLE4 } from "../packages/core/src/index.ts";
import { assertAppBinding } from "../packages/core/src/app-authority.ts";
import { assertNativeBlock } from "../packages/core/src/native-evidence.ts";
import { assertRevokedRejection } from "./lib/revocation-evidence.ts";

const [receiptPath, output] = process.argv.slice(2);
if (!receiptPath || !output || existsSync(output))
  throw Error("Provide owner receipt and a NEW evidence journal path");
const c = AuthorityConfig.parse(
  readPrivateJson(".data/owner-app-studio/config.json"),
);
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const abiText = readFileSync("contracts/build/owner-app/authority.abi", "utf8");
const build = JSON.parse(
  readFileSync("contracts/build/owner-app/build.json", "utf8"),
);
if (
  c.account !== "vralzuwmebbx" ||
  c.grantId !== "1" ||
  !c.appBinding ||
  c.codeHash !==
    "fadd779a8decc9c09e78cde0369c4aa7fff611ea7a39e36af9ce560564b75557" ||
  sha(abiText) !== c.abiJsonHash ||
  sha(abiText) !== build.abiSha256 ||
  sha(readFileSync("contracts/build/owner-app/authority.wasm")) !==
    c.codeHash ||
  sha(readFileSync("contracts/owner-app/authority.cpp")) !== build.sourceSha256
)
  throw Error("Reviewed demo build/configuration mismatch");
const abi = ABI.from(JSON.parse(abiText));
const key = PrivateKey.from(c.privateKey);
const ownerTx = SignedTransaction.from(receipt.signedTransaction);
const revoke = Action.from(
  {
    account: c.account,
    name: "revoke",
    authorization: [{ actor: c.appBinding.owner, permission: "active" }],
    data: { grant_id: c.grantId },
  },
  abi,
);
if (
  receipt.request.chainId !== JUNGLE4 ||
  receipt.request.transactionId !== String(ownerTx.id) ||
  ownerTx.actions.length !== 1 ||
  JSON.stringify(ownerTx.actions[0]) !== JSON.stringify(revoke) ||
  ownerTx.signatures.length !== 1 ||
  ownerTx.context_free_actions.length !== 0 ||
  ownerTx.context_free_data.length !== 0 ||
  ownerTx.transaction_extensions.length !== 0 ||
  !ownerTx.signatures[0]
    .recoverDigest(ownerTx.transaction.signingDigest(JUNGLE4))
    .equals(PublicKey.from(receipt.request.publicKey)) ||
  receipt.request.publicKey !==
    "PUB_K1_6MVHLMgzwt7hh4MdSwS8jJXJpKfnJ5o9RtQGFMjJSNczGmeRxe"
)
  throw Error("Owner revocation receipt/signature mismatch");

async function rpc(endpoint: string, method: string, body: object = {}) {
  const r = await fetch(endpoint + "/v1/chain/" + method, {
    method: "POST",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error("RPC verification unavailable: " + method);
  return r.json();
}
async function snapshot(endpoint: string) {
  const entries = await Promise.all(
    ["root", "apps", "grants", "reservations", "effects"].map(async (table) => {
      const r = await rpc(endpoint, "get_table_rows", {
        json: true,
        code: c.account,
        scope: c.account,
        table,
        limit: 10001,
      });
      if (r.more || !Array.isArray(r.rows)) throw Error("Incomplete table");
      return [table, r.rows] as const;
    }),
  );
  return Object.fromEntries(entries);
}
async function verify(endpoint: string) {
  const [info, code, rawAbi, block, account, state] = await Promise.all([
    rpc(endpoint, "get_info"),
    rpc(endpoint, "get_code_hash", { account_name: c.account }),
    rpc(endpoint, "get_raw_abi", { account_name: c.account }),
    rpc(endpoint, "get_block", { block_num_or_id: receipt.block }),
    rpc(endpoint, "get_account", { account_name: c.actor }),
    snapshot(endpoint),
  ]);
  if (
    info.chain_id !== JUNGLE4 ||
    code.code_hash !== c.codeHash ||
    rawAbi.abi_hash !== c.abiHash
  )
    throw Error("Chain/code/ABI mismatch");
  assertNativeBlock(
    block,
    receipt.block,
    String(ownerTx.id),
    info.last_irreversible_block_num,
    receipt.blockId,
  );
  const permission = account.permissions.find(
    (p: any) => p.perm_name === c.permission,
  );
  const auth = permission?.required_auth;
  if (
    permission?.parent !== "active" ||
    auth?.threshold !== 1 ||
    auth.keys?.length !== 1 ||
    auth.keys[0].weight !== 1 ||
    auth.accounts?.length ||
    auth.waits?.length ||
    !PublicKey.from(auth.keys[0].key).equals(key.toPublic()) ||
    permission.linked_actions?.length !== 2 ||
    !["reserve", "consume"].every((action) =>
      permission.linked_actions.some(
        (a: any) => a.account === c.account && a.action === action,
      ),
    ) ||
    account.permissions.some(
      (p: any) =>
        (p.perm_name !== c.permission &&
          p.required_auth.keys.some((k: any) =>
            PublicKey.from(k.key).equals(key.toPublic()),
          )) ||
        p.required_auth.accounts.some(
          (a: any) =>
            a.permission.actor === c.actor &&
            a.permission.permission === c.permission,
        ),
    )
  )
    throw Error("Restricted key/permission mismatch");
  const grant = state.grants.find((g: any) => String(g.id) === c.grantId);
  const app = state.apps.find((a: any) => String(a.id) === c.appBinding!.appId);
  assertAppBinding(app, grant, c.appBinding!, c.actor, c.permission);
  if (
    ![true, 1].includes(grant.revoked) ||
    grant.space !== c.space ||
    Number(grant.expires) <= Math.floor(Date.now() / 1000) + 120 ||
    Number(grant.available) < 1
  )
    throw Error("Expected revoked, otherwise usable grant");
  return state;
}
const before = await Promise.all([verify(c.rpc), verify(c.independent)]);
if (JSON.stringify(before[0]) !== JSON.stringify(before[1]))
  throw Error("RPC states disagree");
const id = (BigInt("0x" + randomBytes(6).toString("hex")) + 1n).toString();
if (
  before[0].reservations.some((r: any) =>
    ["id", "obligation", "nullifier", "effect_id"].some(
      (field) => String(r[field]) === id,
    ),
  ) ||
  before[0].effects.some((e: any) => String(e.id) === id)
)
  throw Error("Fresh reservation ID collision");
const client = new APIClient({
  provider: new FetchProvider(c.rpc, {
    fetch: (url: any, options: any) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
  }),
});
const info = await client.v1.chain.get_info();
if (String(info.chain_id) !== JUNGLE4) throw Error("Wrong signing chain");
const tx = Transaction.from({
  ...info.getTransactionHeader(120),
  actions: [
    Action.from(
      {
        account: c.account,
        name: "reserve",
        authorization: [{ actor: c.actor, permission: c.permission }],
        data: {
          grant_id: c.grantId,
          app_id: c.appBinding.appId,
          space: c.space,
          id,
          obligation: id,
          nullifier: id,
          effect_id: id,
          payload_hash: sha("Post-revocation agent denial test"),
        },
      },
      abi,
    ),
  ],
});
const signed = SignedTransaction.from({
  ...tx,
  signatures: [key.signDigest(tx.signingDigest(JUNGLE4))],
});
const record: any = {
  version: 1,
  observedAt: new Date().toISOString(),
  chainId: JUNGLE4,
  contract: c.account,
  codeHash: c.codeHash,
  abiHash: c.abiHash,
  ownerTransactionId: String(ownerTx.id),
  ownerBlock: receipt.block,
  ownerBlockId: receipt.blockId,
  ownerSignerPublicKey: receipt.request.publicKey,
  endpoints: [c.rpc, c.independent],
  app: c.appBinding,
  grantId: c.grantId,
  actor: c.actor,
  permission: c.permission,
  agentPublicKey: String(key.toPublic()),
  transactionId: String(tx.id),
  signedTransaction: JSON.parse(JSON.stringify(signed)),
  before,
  status: "PREPARED",
  complete: false,
  trust:
    "Revocation inclusion verified via two RPCs. Rejection and table snapshots are RPC observations, not a finalized rejection receipt or light-client proof.",
};
writeFileSync(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
try {
  // Persist uncertainty before the single network submission; never auto-resend.
  record.status = "UNKNOWN";
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
  try {
    await client.v1.chain.send_transaction(signed);
    record.status = "UNEXPECTED_ACCEPTANCE";
  } catch (error: any) {
    // Capture only structured public chain error, never a raw config/exception.
    record.error = error?.response?.json?.error ?? null;
  }
  record.after = await Promise.all([verify(c.rpc), verify(c.independent)]);
  assertRevokedRejection(record.error, before, record.after);
  record.status = "REJECTED_UNCHANGED";
  record.complete = true;
} finally {
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
}
console.log(
  JSON.stringify({
    status: record.status,
    transactionId: record.transactionId,
  }),
);
