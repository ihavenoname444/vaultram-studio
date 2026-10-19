// Explicit Jungle4 acceptance runner; admin signing is limited to a dedicated
// revocation-test grant. The web gateway never imports this operator script.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  APIClient,
  ABI,
  Action,
  Transaction,
  SignedTransaction,
  PrivateKey,
} from "@wharfkit/antelope";
import { setTimeout as delay } from "node:timers/promises";
import { assertNativeBlock } from "../packages/core/src/native-evidence.ts";
import { readPrivateJson } from "../services/gateway/src/private-file.ts";
import { JUNGLE4 } from "../packages/core/src/index.ts";
const out = process.argv[2];
if (!out) throw Error("Provide evidence output directory");
if (existsSync(out + "/acceptance.json"))
  throw Error("Acceptance journal exists; no blind rerun");
const c = readPrivateJson(".data/owner-app-studio/config.json") as any,
  old = readPrivateJson(".data/testnet-keys.json") as any;
if (!c.appBinding) throw Error("Owner/app configuration required");
const base = "http://127.0.0.1:8787",
  ui = await fetch(base + "/api/config").then((r) => r.json());
const post = async (
  path: string,
  body: object,
  headers: any = {
    "content-type": "application/json",
    "x-vaultram-token": ui.token,
  },
) => {
  const r = await fetch(base + "/api/authority" + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};
const state = await fetch(base + "/api/authority").then((r) => r.json());
const op = state.operations.find((o: any) => o.status === "IRREVERSIBLE");
if (!op) throw Error("Complete a native UI write first");
if (
  state.configuration.account !== c.account ||
  state.configuration.appBinding?.appHash !== c.appBinding.appHash
)
  throw Error("Wrong running Studio deployment");
const checks: any[] = [];
writeFileSync(
  out + "/acceptance.json",
  JSON.stringify({ complete: false, account: c.account, checks }),
  { flag: "wx" },
);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const noToken = await post(
  "/execute",
  { id: op.id, payloadHash: hash(op.evidence.operation.payload) },
  { "content-type": "application/json" },
);
if (noToken.status !== 403) throw Error("CSRF token bypass");
checks.push({ case: "missing session token", status: noToken.status });
const origin = await post(
  "/execute",
  { id: op.id, payloadHash: hash(op.evidence.operation.payload) },
  {
    "content-type": "application/json",
    "x-vaultram-token": ui.token,
    origin: "https://attacker.invalid",
  },
);
if (origin.status !== 403) throw Error("Origin bypass");
checks.push({ case: "foreign origin", status: origin.status });
const altered = await post("/execute", {
  id: op.id,
  payloadHash: "0".repeat(64),
});
if (altered.status !== 400) throw Error("Review substitution");
checks.push({ case: "review hash substitution", status: altered.status });
const replay = await post("/execute", {
  id: op.id,
  payloadHash: hash(op.evidence.operation.payload),
});
const after = await fetch(base + "/api/authority").then((r) => r.json());
if (
  replay.data.status !== "IRREVERSIBLE" ||
  after.effects.length !== state.effects.length ||
  after.grant.consumed !== state.grant.consumed
)
  throw Error("Replay duplicated write");
checks.push({
  case: "same-operation replay",
  status: "same irreversible transaction; no extra effect",
});
writeFileSync(
  out + "/native-write.json",
  JSON.stringify(replay.data.evidence, null, 2),
);
const client = new APIClient({ url: c.rpc }),
  abi = ABI.from(
    JSON.parse(readFileSync("contracts/build/owner-app/authority.abi", "utf8")),
  );
async function rpc(method: string, data: object = {}) {
  const r = await fetch(c.independent + "/v1/chain/" + method, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!r.ok) throw Error("RPC failed");
  return r.json();
}
if ((await rpc("get_info")).chain_id !== JUNGLE4) throw Error("Wrong chain");
const act = (name: string, data: object, principal = false) =>
  Action.from(
    {
      account: c.account,
      name,
      data,
      authorization: [
        {
          actor: principal ? old.runtime : c.actor,
          permission: principal ? "active" : c.permission,
        },
      ],
    },
    abi,
  );
async function snapshot() {
  const rows = [];
  for (const table of ["root", "apps", "grants", "reservations", "effects"])
    rows.push(
      (
        await rpc("get_table_rows", {
          json: true,
          code: c.account,
          scope: c.account,
          table,
          limit: 10001,
        })
      ).rows,
    );
  return JSON.stringify(rows);
}
async function check(
  label: string,
  actions: Action[],
  key: string | string[],
  rejection?: RegExp,
) {
  const before = await snapshot(),
    info = await client.v1.chain.get_info();
  if (String(info.chain_id) !== JUNGLE4) throw Error("Wrong signing chain");
  const tx = Transaction.from({ ...info.getTransactionHeader(120), actions }),
    signed = SignedTransaction.from({
      ...tx,
      signatures: (Array.isArray(key) ? key : [key]).map((k) =>
        PrivateKey.from(k).signDigest(tx.signingDigest(JUNGLE4)),
      ),
    });
  const record: any = {
    case: label,
    transactionId: String(tx.id),
    transaction: JSON.parse(JSON.stringify(signed)),
    status: "PREPARED",
  };
  checks.push(record);
  writeFileSync(
    out + "/acceptance.json",
    JSON.stringify({ complete: false, account: c.account, checks }, null, 2),
  );
  let error = "",
    block = 0;
  try {
    await client.v1.chain.send_transaction(signed);
  } catch (e: any) {
    error = String(e) + " " + JSON.stringify(e.response?.json?.error ?? {});
  }
  if (rejection) {
    if (!rejection.test(error) || (await snapshot()) !== before)
      throw Error("Expected unchanged rejection: " + label);
  } else {
    if (error) throw Error(error);
    for (let i = 0; i < 50; i++) {
      const s = await rpc("get_transaction_status", { id: String(tx.id) });
      if (s.state === "IRREVERSIBLE") {
        const b = await rpc("get_block", { block_num_or_id: s.block_number });
        const info = await rpc("get_info");
        if (info.chain_id !== JUNGLE4) throw Error("Wrong finality chain");
        assertNativeBlock(
          b,
          Number(s.block_number),
          String(tx.id),
          info.last_irreversible_block_num,
          s.block_id,
        );
        block = Number(s.block_number);
        break;
      }
      await delay(500);
    }
    if (!block) throw Error("No independent finality");
  }
  Object.assign(record, {
    status: rejection ? "REJECTED_UNCHANGED" : "IRREVERSIBLE",
    error: error || undefined,
    block: block || undefined,
    unchanged: !!rejection,
  });
  writeFileSync(
    out + "/acceptance.json",
    JSON.stringify({ complete: false, account: c.account, checks }, null, 2),
  );
  console.log(label, rejection ? "REJECTED_UNCHANGED" : "IRREVERSIBLE");
}
const expiry = Math.floor(Date.now() / 1000) + 3600;
await check(
  "agent key cannot grant",
  [
    act("grant", {
      id: 99,
      app_id: c.appBinding.appId,
      actor_permission: c.permission,
      actor: c.actor,
      space: "memory",
      budget: 1,
      expires: expiry,
      max_payload: 256,
    }),
  ],
  c.privateKey,
  /authorization|authority/,
);
const tokenAbi = (await client.v1.chain.get_abi("eosio.token")).abi!;
await check(
  "agent key cannot transfer tokens",
  [
    Action.from(
      {
        account: "eosio.token",
        name: "transfer",
        authorization: [{ actor: c.actor, permission: c.permission }],
        data: {
          from: c.actor,
          to: old.runtime,
          quantity: "1.0000 EOS",
          memo: "must reject scoped key",
        },
      },
      tokenAbi,
    ),
  ],
  c.privateKey,
  /authorization|authority/,
);
// Test another native owner with the same actor, without issuing a grant for it.
const otherApp = (BigInt(c.appBinding.appId) + 1n).toString();
const registration = act(
  "regapp",
  {
    id: otherApp,
    owner: c.actor,
    app_hash: hash("owner consent isolation probe"),
  },
  true,
);
await check(
  "allocator cannot register app without owner's consent",
  [registration],
  old.runtimeAdmin,
  /authorization|authority/,
);
const approved = Action.from({
  ...registration,
  authorization: [
    { actor: old.runtime, permission: "active" },
    { actor: c.actor, permission: "active" },
  ],
});
await check(
  "separate owner and allocator co-sign app registration",
  [approved],
  [old.runtimeAdmin, old.relayerAdmin],
);
await check(
  "allocator cannot grant another owner's app without consent",
  [
    act(
      "grant",
      {
        id: 99,
        app_id: otherApp,
        actor: c.actor,
        actor_permission: c.permission,
        space: c.space,
        budget: 1,
        expires: expiry,
        max_payload: 256,
      },
      true,
    ),
  ],
  old.runtimeAdmin,
  /authorization|authority/,
);
const crossApp = act("reserve", {
  grant_id: c.grantId,
  app_id: otherApp,
  id: 3001,
  space: c.space,
  obligation: 3001,
  nullifier: 3001,
  effect_id: 3001,
  payload_hash: hash("cross-app attempt"),
});
await check(
  "app A grant cannot write registered app B",
  [crossApp],
  c.privateKey,
  /app binding mismatch/,
);
const payloadProbe = "owner app atomic rollback";
await check(
  "failed consume rolls back reservation atomically",
  [
    act("reserve", {
      grant_id: c.grantId,
      app_id: c.appBinding.appId,
      id: 3002,
      space: c.space,
      obligation: 3002,
      nullifier: 3002,
      effect_id: 3002,
      payload_hash: hash(payloadProbe),
    }),
    act("consume", { id: 3002, payload: "tampered" }),
  ],
  c.privateKey,
  /payload binding mismatch/,
);
const reserve = (space: string) =>
  act("reserve", {
    grant_id: 2,
    app_id: c.appBinding.appId,
    id: 2001,
    space,
    obligation: 2001,
    nullifier: 2001,
    effect_id: 2001,
    payload_hash: hash("revocation acceptance"),
  });
await check(
  "owner creates revocation-test grant",
  [
    act(
      "grant",
      {
        id: 2,
        app_id: c.appBinding.appId,
        actor_permission: c.permission,
        actor: c.actor,
        space: "memory",
        budget: 1,
        expires: expiry,
        max_payload: 256,
      },
      true,
    ),
  ],
  old.runtimeAdmin,
);
await check(
  "wrong namespace rejected",
  [reserve("treasury")],
  c.privateKey,
  /namespace/,
);
await check("reserve before revocation", [reserve("memory")], c.privateKey);
await check(
  "owner revokes",
  [act("revoke", { grant_id: 2 }, true)],
  old.runtimeAdmin,
);
await check(
  "revoked grant cannot consume",
  [act("consume", { id: 2001, payload: "revocation acceptance" })],
  c.privateKey,
  /revoked/,
);
writeFileSync(
  out + "/acceptance.json",
  JSON.stringify(
    {
      complete: true,
      account: c.account,
      checks,
      limitations: [
        "Rejected RPC results and unchanged snapshots are observations, not finalized rejection receipts",
      ],
    },
    null,
    2,
  ),
);
