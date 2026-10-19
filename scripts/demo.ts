import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { PrivateKey, PublicKey, ABI, Serializer } from "@wharfkit/antelope";
import { Jungle } from "../services/gateway/src/chain.ts";
import { compile, exampleSpec } from "../packages/core/src/index.ts";

// Dedicated demo entry point: no AI calls, deployment signing or faucet requests.
// Never print this file's contents or the private key in a startup error.
const file = ".env.jungle4";
if (!existsSync(file))
  throw new Error(
    "Missing .env.jungle4; complete the dedicated testnet deployment first.",
  );
const values = parseEnv(readFileSync(file, "utf8"));
for (const name of [
  "VAULTA_RPC",
  "VAULTA_RUNTIME",
  "VAULTA_RELAYER",
  "VAULTA_RELAYER_PRIVATE_KEY",
  "VAULTA_CODE_HASH",
  "VAULTA_ABI_HASH",
]) {
  if (!values[name]) throw new Error("Missing demo setting: " + name);
  process.env[name] = values[name];
}
if (values.VAULTA_PERMISSION && values.VAULTA_PERMISSION !== "relay")
  throw new Error("Demo requires the restricted relay permission");
process.env.VAULTA_PERMISSION = "relay";
process.env.VAULTRAM_MODE = "JUNGLE4";
process.env.VAULTRAM_DATA_DIR = resolve(
  process.env.VAULTRAM_AUTHORITY_MODEL === "owner-app-v2"
    ? ".data/demo-owner-app"
    : ".data/demo-jungle4",
);
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_MODEL = "";
const chain = new Jungle(
  values.VAULTA_RPC!,
  values.VAULTA_RUNTIME!,
  values.VAULTA_RELAYER!,
  "",
  values.VAULTA_CODE_HASH!,
  "relay",
  values.VAULTA_ABI_HASH!,
);
const app = compile(exampleSpec);
const info = await chain.check();
if (!(await chain.deployed(app)))
  throw new Error("The demo specification is not registered on Jungle4");
const configuration = await chain.table("config", chain.runtime);
if (
  configuration.rows.length !== 1 ||
  ![false, 0].includes(configuration.rows[0].paused) ||
  configuration.rows[0].relayer !== chain.relayer
)
  throw new Error("Runtime is paused or relayer configuration differs");
const wasm = readFileSync("contracts/build/runtime.wasm");
if (createHash("sha256").update(wasm).digest("hex") !== chain.codeHash)
  throw new Error("Local WASM does not match the pinned deployment");
const abi = ABI.from(
  JSON.parse(readFileSync("contracts/build/runtime.abi", "utf8")),
);
if (
  createHash("sha256")
    .update(Serializer.encode({ object: abi }).array)
    .digest("hex") !== chain.abiHash
)
  throw new Error("Local ABI does not match the pinned deployment");
let publicKey: PublicKey;
try {
  publicKey = PrivateKey.from(values.VAULTA_RELAYER_PRIVATE_KEY!).toPublic();
} catch {
  throw new Error("Invalid relay key configuration (value redacted)");
}
const account = await chain.rpc("get_account", { account_name: chain.relayer });
const permission = account.permissions.find(
  (p: any) => p.perm_name === "relay",
);
const auth = permission?.required_auth;
if (
  permission?.parent !== "active" ||
  auth?.threshold !== 1 ||
  auth.keys.length !== 1 ||
  auth.keys[0].weight !== 1 ||
  auth.accounts.length ||
  auth.waits.length ||
  !PublicKey.from(auth.keys[0].key).equals(publicKey)
)
  throw new Error("Relay authority does not match the dedicated demo key");
if (
  !Array.isArray(permission.linked_actions) ||
  permission.linked_actions.length !== 1 ||
  permission.linked_actions[0].account !== chain.runtime ||
  permission.linked_actions[0].action !== "execute"
)
  throw new Error(
    "Relay permission is not linked exclusively to this runtime's execute action",
  );
for (const p of account.permissions.filter(
  (p: any) => p.perm_name !== "relay",
)) {
  if (
    p.required_auth.keys.some((k: any) =>
      PublicKey.from(k.key).equals(publicKey),
    )
  )
    throw new Error("Relay key is reused in another account permission");
}
const ramAvailable = Number(account.ram_quota) - Number(account.ram_usage);
if (!Number.isSafeInteger(ramAvailable) || ramAvailable < 10000)
  throw new Error(
    "Less than 10,000 bytes of test RAM remains; review resources before the demo",
  );
if (
  Number(account.cpu_limit.available) <= 0 ||
  Number(account.net_limit.available) <= 0
)
  throw new Error(
    "CPU/NET currently exhausted; wait or review free test resources",
  );
console.log(
  JSON.stringify(
    {
      status: "DEMO_PREFLIGHT_PASSED",
      network: "Jungle4",
      runtime: chain.runtime,
      relayer: chain.relayer,
      appId: app.appId,
      irreversibleBlock: info.last_irreversible_block_num,
      runtimePins: "match local WASM and ABI",
      restrictedPermission: "verified",
      ramAvailable,
      cpuAvailable: account.cpu_limit.available,
      netAvailable: account.net_limit.available,
      ai: "FIXTURE — API disabled",
      wallet: process.env.VAULTRAM_AUTHORITY_CONFIG
        ? "Local restricted native key; native owner/allocator admin keys remain outside the gateway"
        : "External EVM EOA required; signature only, no EVM gas",
      authorityModel: process.env.VAULTRAM_AUTHORITY_MODEL ?? "legacy-intent",
      dataDirectory: process.env.VAULTRAM_DATA_DIR,
      resources:
        "Current RPC observations, not a guarantee of future availability",
    },
    null,
    2,
  ),
);
if (!process.argv.includes("--check")) {
  // Seed only local metadata; this never registers or modifies the contract.
  const { createServer } = await import("../services/gateway/src/server.ts");
  const gateway = await createServer();
  gateway.store.putApp(app);
  gateway.store.deploy(app.appId);
  await gateway.server.close();
  await import("./dev.ts");
}
