import {
  generateKeyPairSync,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  canonical,
  type Receipt,
  type SignedReceipt,
} from "../../../packages/core/src/index.ts";
export function receiptSigner(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!existsSync(path)) {
    const pair = generateKeyPairSync("ed25519");
    writeFileSync(
      path,
      pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600, flag: "wx" },
    );
  }
  const key = readFileSync(path, "utf8");
  const publicKey = createPublicKey(key)
    .export({ type: "spki", format: "pem" })
    .toString();
  return {
    publicKey,
    sign: (receipt: Receipt): SignedReceipt => ({
      receipt,
      algorithm: "Ed25519",
      publicKey,
      signature: sign(null, Buffer.from(canonical(receipt)), key).toString(
        "base64",
      ),
    }),
  };
}
export function verifyReceipt(value: SignedReceipt, pinnedPublicKey: string) {
  return (
    value.algorithm === "Ed25519" &&
    value.publicKey === pinnedPublicKey &&
    verify(
      null,
      Buffer.from(canonical(value.receipt)),
      pinnedPublicKey,
      Buffer.from(value.signature, "base64"),
    )
  );
}
