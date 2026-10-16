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
import { JUNGLE4 } from "../packages/core/src/index.ts";
const out = process.argv[2];
if (!out) throw Error("Provide evidence output directory");
if (existsSync(out + "/acceptance.json"))
  throw Error("Acceptance journal exists; no blind rerun");
const c = JSON.parse(
    readFileSync(".data/authority-studio/config.json", "utf8"),
  ),
  old = JSON.parse(readFileSync(".data/testnet-keys.json", "utf8"));
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
const checks: any[] = [];
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
    JSON.parse(readFileSync("contracts/build/authority/authority.abi", "utf8")),
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
  for (const table of ["root", "grants", "reservations", "effects"])
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
  key: string,
  rejection?: RegExp,
) {
  const before = await snapshot(),
    info = await client.v1.chain.get_info();
  if (String(info.chain_id) !== JUNGLE4) throw Error("Wrong signing chain");
  const tx = Transaction.from({ ...info.getTransactionHeader(120), actions }),
    signed = SignedTransaction.from({
      ...tx,
      signatures: [PrivateKey.from(key).signDigest(tx.signingDigest(JUNGLE4))],
    });
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
        if (
          !b.transactions.some(
            (t: any) =>
              t.status === "executed" && (t.trx?.id ?? t.trx) === String(tx.id),
          )
        )
          throw Error("Inclusion mismatch");
        block = Number(s.block_number);
        break;
      }
      await delay(500);
    }
    if (!block) throw Error("No independent finality");
  }
  checks.push({
    case: label,
    transactionId: String(tx.id),
    transaction: JSON.parse(JSON.stringify(signed)),
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
const reserve = (space: string) =>
  act("reserve", {
    grant_id: 2,
    id: 2001,
    space,
    obligation: 2001,
    nullifier: 2001,
    effect_id: 2001,
    payload_hash: hash("revocation acceptance"),
  });
await check(
  "principal creates revocation-test grant",
  [
    act(
      "grant",
      {
        id: 2,
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
  "principal revokes",
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
