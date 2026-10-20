// Fresh owner/app v2 deployment only. Never changes v1 code, tables or permissions.
// Local operator only. Admin keys are never loaded by the HTTP gateway.
import {
  APIClient,
  Action,
  ABI,
  Serializer,
  Transaction,
  SignedTransaction,
  PrivateKey,
} from "@wharfkit/antelope";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { assertNativeBlock } from "../packages/core/src/native-evidence.ts";
import { readPrivateJson } from "../services/gateway/src/private-file.ts";
import { JUNGLE4, compile, exampleSpec } from "../packages/core/src/index.ts";
const dir = ".data/owner-app-studio";
const app = compile(exampleSpec);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const mode = process.argv[2];
if (!["provision", "deploy"].includes(mode))
  throw Error("Use provision or deploy");
const rpc = "https://jungle4.greymass.com",
  independent = "https://jungle4.cryptolions.io";
const client = new APIClient({ url: rpc });
const old = readPrivateJson(".data/testnet-keys.json") as any;
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const build = JSON.parse(
  readFileSync("contracts/build/owner-app/build.json", "utf8"),
);
const wasm = readFileSync("contracts/build/owner-app/authority.wasm"),
  abiBytes = readFileSync("contracts/build/owner-app/authority.abi");
if (
  hash(wasm) !== build.wasmSha256 ||
  hash(abiBytes) !== build.abiSha256 ||
  hash(readFileSync("contracts/owner-app/authority.cpp")) !== build.sourceSha256
)
  throw Error("Build pin mismatch");
const abi = ABI.from(JSON.parse(abiBytes.toString()));
async function api(base: string, path: string, data: object = {}) {
  const r = await fetch(base + "/v1/chain/" + path, {
    method: "POST",
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!r.ok)
    throw Error(
      j.error?.details?.map((d: any) => d.message).join("; ") ?? "RPC error",
    );
  return j;
}
for (const u of [rpc, independent])
  if ((await api(u, "get_info")).chain_id !== JUNGLE4)
    throw Error("Wrong chain");
const keyFile = dir + "/operator.json";
if (!existsSync(keyFile)) {
  if (mode !== "provision") throw Error("Provision first");
  writeFileSync(
    keyFile,
    JSON.stringify({
      account:
        "vra" +
        [...randomBytes(9)]
          .map((x) => String.fromCharCode(97 + (x % 26)))
          .join(""),
      owner: String(PrivateKey.generate("K1")),
      active: String(PrivateKey.generate("K1")),
      agentKey: String(PrivateKey.generate("K1")),
    }),
    { mode: 0o600, flag: "wx" },
  );
}
const op = readPrivateJson(keyFile) as any;
const systemAbi = (await client.v1.chain.get_abi("eosio")).abi!;
const auth = (k: string) => ({
  threshold: 1,
  keys: [{ key: String(PrivateKey.from(k).toPublic()), weight: 1 }],
  accounts: [],
  waits: [],
});
const act = (
  account: string,
  name: string,
  data: object,
  actors: string[],
  a: any,
) =>
  Action.from(
    {
      account,
      name,
      data,
      authorization: actors.map((actor) => ({ actor, permission: "active" })),
    },
    a,
  );
const sys = (name: string, data: object, actor: string) =>
  act("eosio", name, data, [actor], systemAbi);
async function send(actions: Action[], signers: string[], file: string) {
  if (existsSync(file))
    throw Error("Journal exists; inspect instead of blindly repeating");
  const info = await client.v1.chain.get_info();
  if (String(info.chain_id) !== JUNGLE4) throw Error("Wrong signing chain");
  const tx = Transaction.from({ ...info.getTransactionHeader(120), actions });
  const signed = SignedTransaction.from({
    ...tx,
    signatures: signers.map((k) =>
      PrivateKey.from(k).signDigest(tx.signingDigest(JUNGLE4)),
    ),
  });
  const record: any = {
    chainId: JUNGLE4,
    account: op.account,
    transactionId: String(tx.id),
    transaction: JSON.parse(JSON.stringify(signed)),
    status: "PREPARED",
  };
  writeFileSync(file, JSON.stringify(record, null, 2));
  const r: any = await client.v1.chain.send_transaction(signed);
  record.reportedBlock = Number(r.processed.block_num);
  record.status = "PENDING";
  writeFileSync(file, JSON.stringify(record, null, 2));
  for (let i = 0; i < 50; i++) {
    const s = await api(independent, "get_transaction_status", {
      id: record.transactionId,
    });
    if (s.state === "IRREVERSIBLE") {
      const b = await api(independent, "get_block", {
        block_num_or_id: s.block_number,
      });
      const info = await api(independent, "get_info");
      if (info.chain_id !== JUNGLE4) throw Error("Wrong finality chain");
      assertNativeBlock(
        b,
        Number(s.block_number),
        record.transactionId,
        info.last_irreversible_block_num,
        s.block_id,
      );
      record.block = Number(s.block_number);
      record.status = "IRREVERSIBLE";
      writeFileSync(file, JSON.stringify(record, null, 2));
      console.log({
        account: op.account,
        transactionId: record.transactionId,
        block: record.block,
      });
      return;
    }
    await delay(500);
  }
  throw Error("Unknown finality; inspect journal");
}
if (mode === "provision") {
  const balance = await api(rpc, "get_currency_balance", {
    code: "eosio.token",
    account: old.relayer,
    symbol: "EOS",
  });
  if (parseFloat(balance[0] ?? "0") < 91) throw Error("Need 91 test EOS");
  await send(
    [
      sys(
        "newaccount",
        {
          creator: old.relayer,
          name: op.account,
          owner: auth(op.owner),
          active: auth(op.active),
        },
        old.relayer,
      ),
      sys(
        "buyram",
        { payer: old.relayer, receiver: op.account, quant: "85.0000 EOS" },
        old.relayer,
      ),
      sys(
        "delegatebw",
        {
          from: old.relayer,
          receiver: op.account,
          stake_net_quantity: "1.0000 EOS",
          stake_cpu_quantity: "5.0000 EOS",
          transfer: false,
        },
        old.relayer,
      ),
    ],
    [old.relayerAdmin],
    dir + "/provision.json",
  );
}
if (mode === "deploy") {
  if (
    (await api(rpc, "get_code_hash", { account_name: op.account }))
      .code_hash !== "0".repeat(64)
  )
    throw Error("Refusing code overwrite");
  if (
    (await api(rpc, "get_account", { account_name: op.account })).ram_quota <
    380000
  )
    throw Error("Insufficient RAM quota for fresh owner/app build");
  const existing = await api(rpc, "get_account", { account_name: old.relayer });
  if (existing.permissions.some((p: any) => p.perm_name === "vrapp"))
    throw Error("Permission already exists; inspect");
  const expires = Math.floor(Date.now() / 1000) + 7 * 86400;
  const actions = [
    sys(
      "setcode",
      {
        account: op.account,
        vmtype: 0,
        vmversion: 0,
        code: wasm.toString("hex"),
      },
      op.account,
    ),
    sys(
      "setabi",
      {
        account: op.account,
        abi: Serializer.encode({ object: abi }).hexString,
      },
      op.account,
    ),
    act(
      op.account,
      "init",
      { principal: old.runtime, total: 10000 },
      [op.account, old.runtime],
      abi,
    ),
    act(
      op.account,
      "regapp",
      { id: app.appId, owner: old.runtime, app_hash: app.appHash.slice(2) },
      [old.runtime],
      abi,
    ),
    act(
      op.account,
      "grant",
      {
        id: 1,
        app_id: app.appId,
        actor_permission: "vrapp",
        actor: old.relayer,
        space: "memory",
        budget: 100,
        expires,
        max_payload: 256,
      },
      [old.runtime],
      abi,
    ),
    sys(
      "updateauth",
      {
        account: old.relayer,
        permission: "vrapp",
        parent: "active",
        auth: auth(op.agentKey),
      },
      old.relayer,
    ),
    ...["reserve", "consume"].map((type) =>
      sys(
        "linkauth",
        {
          account: old.relayer,
          code: op.account,
          type,
          requirement: "vrapp",
        },
        old.relayer,
      ),
    ),
  ];
  await send(
    actions,
    [op.active, old.runtimeAdmin, old.relayerAdmin],
    dir + "/deployment.json",
  );
  writeFileSync(
    dir + "/config.json",
    JSON.stringify(
      {
        appBinding: {
          appId: app.appId,
          owner: old.runtime,
          appHash: app.appHash.slice(2),
        },
        account: op.account,
        actor: old.relayer,
        permission: "vrapp",
        grantId: "1",
        space: "memory",
        privateKey: op.agentKey,
        codeHash: build.wasmSha256,
        abiHash: hash(Serializer.encode({ object: abi }).array),
        abiJsonHash: build.abiSha256,
        rpc,
        independent,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Restricted Studio configuration ready; admin keys stay outside gateway configuration",
  );
}
