import {
  APIClient,
  Action,
  Transaction,
  SignedTransaction,
  PrivateKey,
  Serializer,
  ABI,
} from "@wharfkit/antelope";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { JUNGLE4, compile, exampleSpec } from "../packages/core/src/index.ts";
const command = process.argv[2];
if (!["inspect", "permissions", "deploy", "register"].includes(command))
  throw new Error(
    "Usage: tsx scripts/deploy.ts inspect|permissions|deploy|register [app.spec.json]. Uses locally generated dedicated TESTNET keys only.",
  );
const keys = JSON.parse(readFileSync(".data/testnet-keys.json", "utf8"));
const url = process.env.VAULTA_RPC ?? "https://jungle4.greymass.com";
const client = new APIClient({ url });
const info = await client.v1.chain.get_info();
if (String(info.chain_id) !== JUNGLE4)
  throw new Error("Wrong chain; refusing to sign");
const runtime = await client.v1.chain.get_account(keys.runtime);
const relayer = await client.v1.chain.get_account(keys.relayer);
if (command === "inspect") {
  console.log(
    JSON.stringify(
      {
        chainId: JUNGLE4,
        runtime: keys.runtime,
        relayer: keys.relayer,
        runtimeRam: {
          quota: String(runtime.ram_quota),
          used: String(runtime.ram_usage),
        },
        relayerRam: {
          quota: String(relayer.ram_quota),
          used: String(relayer.ram_usage),
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
async function action(
  account: string,
  name: string,
  data: unknown,
  actor: string,
  permission = "active",
) {
  const { abi } = await client.v1.chain.get_abi(account);
  if (!abi) throw new Error("Missing ABI");
  return Action.from(
    {
      account,
      name,
      authorization: [{ actor, permission }],
      data: data as Record<string, unknown>,
    },
    abi,
  );
}
async function send(actions: Action[], key: string) {
  const head = await client.v1.chain.get_info();
  if (String(head.chain_id) !== JUNGLE4) throw new Error("Wrong chain");
  const tx = Transaction.from({ ...head.getTransactionHeader(90), actions });
  const signed = SignedTransaction.from({
    ...tx,
    signatures: [PrivateKey.from(key).signDigest(tx.signingDigest(JUNGLE4))],
  });
  const result = await client.v1.chain.send_transaction(signed);
  const json = JSON.parse(JSON.stringify(result));
  if (json.processed?.receipt?.status !== "executed" || json.processed?.except)
    throw new Error("Deployment transaction did not execute");
  console.log(
    JSON.stringify(
      {
        transactionId: json.transaction_id,
        blockNum: json.processed.block_num,
        irreversibility: "not yet verified",
      },
      null,
      2,
    ),
  );
  return json;
}
if (command === "permissions") {
  const actions = [
    await action(
      "eosio",
      "updateauth",
      {
        account: keys.relayer,
        permission: "relay",
        parent: "active",
        auth: {
          threshold: 1,
          keys: [
            { key: String(PrivateKey.from(keys.relay).toPublic()), weight: 1 },
          ],
          accounts: [],
          waits: [],
        },
      },
      keys.relayer,
    ),
    await action(
      "eosio",
      "linkauth",
      {
        account: keys.relayer,
        code: keys.runtime,
        type: "execute",
        requirement: "relay",
      },
      keys.relayer,
    ),
  ];
  await send(actions, keys.relayerAdmin);
}
if (command === "deploy") {
  const wasm = readFileSync("contracts/build/runtime.wasm");
  const abi = ABI.from(
    JSON.parse(readFileSync("contracts/build/runtime.abi", "utf8")),
  );
  const code = (await client.call({
    path: "/v1/chain/get_code_hash",
    params: { account_name: keys.runtime },
  })) as { code_hash: string };
  if (String(code.code_hash) !== "0".repeat(64))
    throw new Error(
      "Runtime already has code; automatic overwrite refused. Review and perform upgrades separately.",
    );
  const setcode = await action(
    "eosio",
    "setcode",
    {
      account: keys.runtime,
      vmtype: 0,
      vmversion: 0,
      code: wasm.toString("hex"),
    },
    keys.runtime,
  );
  const setabi = await action(
    "eosio",
    "setabi",
    {
      account: keys.runtime,
      abi: Serializer.encode({ object: abi }).hexString,
    },
    keys.runtime,
  );
  const init = Action.from(
    {
      account: keys.runtime,
      name: "init",
      authorization: [{ actor: keys.runtime, permission: "active" }],
      data: { relayer: keys.relayer },
    },
    abi,
  );
  await send([setcode, setabi, init], keys.runtimeAdmin);
  const hash = createHash("sha256").update(wasm).digest("hex");
  const env =
    [
      "VAULTRAM_MODE=JUNGLE4",
      "VAULTA_RPC=" + url,
      "VAULTA_RUNTIME=" + keys.runtime,
      "VAULTA_RELAYER=" + keys.relayer,
      "VAULTA_PERMISSION=relay",
      "VAULTA_RELAYER_PRIVATE_KEY=" + keys.relay,
      "VAULTA_CODE_HASH=" + hash,
      "VAULTA_ABI_HASH=" +
        createHash("sha256")
          .update(Serializer.encode({ object: abi }).array)
          .digest("hex"),
      "OPENAI_API_KEY=",
      "OPENAI_MODEL=",
    ].join("\n") + "\n";
  const target = ".env.jungle4";
  if (existsSync(target))
    throw new Error(
      "Deployed successfully, but .env.jungle4 already exists and was not overwritten. Pin the printed code hash manually.",
    );
  writeFileSync(target, env, { mode: 0o600, flag: "wx" });
  console.log(
    "Gateway-only environment saved to .env.jungle4. Code SHA256: " + hash,
  );
}
if (command === "register") {
  const app = compile(
    process.argv[3]
      ? JSON.parse(readFileSync(process.argv[3], "utf8"))
      : exampleSpec,
  );
  await send(
    [
      await action(
        keys.runtime,
        "regapp",
        { app_id: app.appId, app_hash: app.appHash.slice(2) },
        keys.runtime,
      ),
    ],
    keys.runtimeAdmin,
  );
  console.log("Registered app " + app.appId);
}
