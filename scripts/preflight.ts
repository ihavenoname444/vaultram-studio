import { existsSync } from "node:fs";
import { JUNGLE4 } from "../packages/core/src/index.ts";
if (existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.VAULTA_RPC ?? "https://jungle4.greymass.com";
const r = await fetch(url + "/v1/chain/get_info", {
  signal: AbortSignal.timeout(15000),
});
if (!r.ok) throw new Error("RPC unavailable");
const info = await r.json();
if (info.chain_id !== JUNGLE4)
  throw new Error("Wrong chain: refusing any operation");
console.log(
  JSON.stringify(
    {
      network: "Jungle4",
      chainId: info.chain_id,
      headBlock: info.head_block_num,
      irreversibleBlock: info.last_irreversible_block_num,
      runtimeConfigured: !!process.env.VAULTA_RUNTIME,
      relayerConfigured: !!process.env.VAULTA_RELAYER,
      relayerKeyConfigured: !!process.env.VAULTA_RELAYER_PRIVATE_KEY,
      pinnedCodeConfigured: !!process.env.VAULTA_CODE_HASH,
      aiConfigured: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
      compiledWasm: existsSync("contracts/build/runtime.wasm"),
      compiledAbi: existsSync("contracts/build/runtime.abi"),
    },
    null,
    2,
  ),
);
