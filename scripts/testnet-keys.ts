import { PrivateKey } from "@wharfkit/antelope";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const file = ".data/testnet-keys.json";
mkdirSync(".data", { recursive: true, mode: 0o700 });
if (!existsSync(file)) {
  const name = (prefix: string) =>
    prefix +
    Array.from(
      randomBytes(10),
      (b) => "abcdefghijklmnopqrstuvwxyz12345"[b % 31],
    ).join("");
  const keys = {
    runtime: name("vr"),
    relayer: name("rl"),
    runtimeAdmin: String(PrivateKey.generate("K1")),
    relayerAdmin: String(PrivateKey.generate("K1")),
    relay: String(PrivateKey.generate("K1")),
  };
  writeFileSync(file, JSON.stringify(keys, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
}
const keys = JSON.parse(readFileSync(file, "utf8"));
const manifest = {
  network: "Jungle4 ONLY",
  runtime: {
    account: keys.runtime,
    publicKey: String(PrivateKey.from(keys.runtimeAdmin).toPublic()),
  },
  relayer: {
    account: keys.relayer,
    publicKey: String(PrivateKey.from(keys.relayerAdmin).toPublic()),
  },
  relayPublicKey: String(PrivateKey.from(keys.relay).toPublic()),
  privateKeys:
    "Stored locally in .data/testnet-keys.json; never upload or fund on mainnet",
  accountCreation: "https://monitor4.jungletestnet.io/#account",
};
writeFileSync(".data/testnet-public.json", JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
