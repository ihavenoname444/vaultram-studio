import {
  generateKeyPairSync,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  canonical,
  type Receipt,
  type SignedReceipt,
} from "../../../packages/core/src/index.ts";
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const transactionId = z.string().regex(/^[0-9a-f]{64}$/);
const integer = z.number().int().safe();
const receiptSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["SIMULATED", "JUNGLE4"]),
    intentHash: hash,
    appId: z.string().regex(/^[1-9][0-9]{0,19}$/),
    owner: z.string().regex(/^0x[0-9a-f]{40}$/),
    action: z.enum(["createagent", "pubservice", "writemem", "setstate"]),
    status: z.enum(["SIMULATED", "SUBMITTED", "IRREVERSIBLE", "UNKNOWN"]),
    transactionId: transactionId.nullable(),
    blockNum: integer.positive().nullable(),
    issuedAt: z.iso.datetime(),
    stateHash: hash.nullable(),
    trust: z.string().max(2000),
    ram: z
      .object({
        before: integer.nonnegative().nullable(),
        after: integer.nonnegative().nullable(),
        delta: integer.nullable(),
        method: z.string().max(1000),
        attributable: z.literal(false),
        executionTrace: z
          .object({
            payer: z.string().regex(/^[a-z1-5.]{1,12}$/),
            delta: integer,
            source: z.literal("send_transaction"),
            transactionId,
            independentlyVerified: z.literal(false),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.mode === "SIMULATED" &&
      (r.status !== "SIMULATED" ||
        r.transactionId !== null ||
        r.blockNum !== null ||
        r.ram.before !== null ||
        r.ram.after !== null ||
        r.ram.delta !== null ||
        r.ram.executionTrace)
    )
      ctx.addIssue({
        code: "custom",
        message: "Simulation cannot claim chain evidence",
      });
    if (
      r.mode === "JUNGLE4" &&
      (r.status === "SIMULATED" ||
        !r.transactionId ||
        (r.status === "IRREVERSIBLE" && !r.blockNum))
    )
      ctx.addIssue({ code: "custom", message: "Inconsistent live evidence" });
    if (
      r.ram.executionTrace &&
      r.ram.executionTrace.transactionId !== r.transactionId
    )
      ctx.addIssue({
        code: "custom",
        message: "RAM trace transaction mismatch",
      });
  });
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
  try {
    return (
      receiptSchema.safeParse(value.receipt).success &&
      value.algorithm === "Ed25519" &&
      value.publicKey === pinnedPublicKey &&
      verify(
        null,
        Buffer.from(canonical(value.receipt)),
        pinnedPublicKey,
        Buffer.from(value.signature, "base64"),
      )
    );
  } catch {
    return false;
  }
}
