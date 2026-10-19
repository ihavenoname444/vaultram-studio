import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ABI, Action, Serializer, SignedTransaction } from "@wharfkit/antelope";
import { JUNGLE4 } from "../packages/core/src/index.ts";
import {
  assertNativeBlock,
  assertNativeEffect,
} from "../packages/core/src/native-evidence.ts";
import {
  AppBinding,
  assertAppBinding,
  assertAppEffect,
} from "../packages/core/src/app-authority.ts";
const [file, expectedAccount, output] = process.argv.slice(2);
if (!file || !expectedAccount)
  throw Error(
    "Usage: tsx scripts/verify-native.ts export.json EXPECTED_NATIVE_ACCOUNT [result.json]",
  );
const e = JSON.parse(readFileSync(file, "utf8")),
  c = e.configuration,
  o = e.operation;
if (![1, 2].includes(e.version) || (e.version === 2) !== !!c.appBinding)
  throw Error("Evidence authority version mismatch");
const binding = c.appBinding ? AppBinding.parse(c.appBinding) : undefined;
const buildDir = "contracts/build/" + (binding ? "owner-app" : "authority");
const source = binding
  ? "contracts/owner-app/authority.cpp"
  : "contracts/authority-proof/authority.cpp";
const build = JSON.parse(readFileSync(buildDir + "/build.json", "utf8"));
const hash = (x: Uint8Array | string) =>
  createHash("sha256").update(x).digest("hex");
const bytes = readFileSync(buildDir + "/authority.abi"),
  abi = ABI.from(JSON.parse(bytes.toString()));
if (
  hash(readFileSync(source)) !== build.sourceSha256 ||
  hash(readFileSync(buildDir + "/authority.wasm")) !== build.wasmSha256 ||
  hash(bytes) !== build.abiSha256
)
  throw Error("Local reviewed build mismatch");
if (
  c.account !== expectedAccount ||
  c.chainId !== JUNGLE4 ||
  c.codeHash !== build.wasmSha256 ||
  c.abiHash !== hash(Serializer.encode({ object: abi }).array) ||
  c.abiJsonHash !== build.abiSha256
)
  throw Error("Evidence deployment/domain mismatch");
const tx = SignedTransaction.from(o.transaction);
if (
  String(tx.id) !== o.transactionId ||
  tx.actions.length !== 2 ||
  tx.context_free_actions.length ||
  tx.transaction_extensions.length
)
  throw Error("Transaction shape/digest mismatch");
const make = (name: string, data: object) =>
  Action.from(
    {
      account: c.account,
      name,
      data,
      authorization: [{ actor: c.actor, permission: c.permission }],
    },
    abi,
  );
const expected = [
  make("reserve", {
    ...(binding ? { app_id: binding.appId } : {}),
    grant_id: c.grantId,
    id: o.reservationId,
    space: c.space,
    obligation: o.reservationId,
    nullifier: o.reservationId,
    effect_id: o.reservationId,
    payload_hash: hash(o.payload),
  }),
  make("consume", { id: o.reservationId, payload: o.payload }),
];
if (JSON.stringify(tx.actions) !== JSON.stringify(expected))
  throw Error("Exact native action binding mismatch");
async function api(method: string, data: object = {}) {
  const r = await fetch("https://jungle4.cryptolions.io/v1/chain/" + method, {
    method: "POST",
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error("Independent RPC failed");
  return r.json();
}
const info = await api("get_info");
if (
  info.chain_id !== JUNGLE4 ||
  !Number.isSafeInteger(e.block) ||
  e.block < 1 ||
  !Number.isSafeInteger(info.last_irreversible_block_num) ||
  e.block > info.last_irreversible_block_num
)
  throw Error("Wrong chain or non-final block");
if (
  (await api("get_code_hash", { account_name: c.account })).code_hash !==
    build.wasmSha256 ||
  (await api("get_raw_abi", { account_name: c.account })).abi_hash !== c.abiHash
)
  throw Error("Current deployment pin mismatch");
const block = await api("get_block", { block_num_or_id: e.block });
assertNativeBlock(
  block,
  e.block,
  o.transactionId,
  info.last_irreversible_block_num,
  e.blockId,
);
async function row(table: string, id: string) {
  const r = await api("get_table_rows", {
    json: true,
    code: c.account,
    scope: c.account,
    table,
    lower_bound: id,
    upper_bound: id,
    limit: 1,
  });
  if (r.rows.length !== 1 || String(r.rows[0].id) !== id)
    throw Error("Protected row missing");
  return r.rows[0];
}
const effect = await row("effects", o.reservationId),
  reservation = await row("reservations", o.reservationId);
assertNativeEffect(
  effect,
  reservation,
  c,
  o.reservationId,
  o.payload,
  hash(o.payload),
);
if (binding) {
  const app = await row("apps", binding.appId),
    grant = await row("grants", c.grantId);
  assertAppBinding(app, grant, binding, c.actor, c.permission);
  if (grant.space !== c.space) throw Error("Grant namespace mismatch");
  assertAppEffect(effect, binding, c.permission);
}
const result = {
  model: binding ? "OWNER_APP_V2" : "NATIVE_GRANT_V1",
  ...(binding ? { appBinding: binding } : {}),
  status: "VERIFIED_NATIVE_STUDIO_WRITE",
  account: c.account,
  transactionId: o.transactionId,
  block: e.block,
  effectId: o.reservationId,
  codeHash: build.wasmSha256,
  sourceHash: build.sourceSha256,
  checkedAt: new Date().toISOString(),
  limitations: [
    "One contract and native account domain; local operator controls the delegated key",
    "Current code/ABI pinned; upgrade admin and chain remain trusted",
    "No claim of V necessity or comparative security superiority",
  ],
};
if (output) writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(result);
