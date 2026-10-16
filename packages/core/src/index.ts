import { z } from "zod";
import { applicationSource } from "./template.ts";
import {
  keccak256,
  sha256,
  stringToHex,
  hashTypedData,
  verifyTypedData,
  type Hex,
} from "viem";

export const JUNGLE4 =
  "73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d";
export const VERSION = "1";
export const POLICY = "bounded-marketplace-v1";
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) => new TextEncoder().encode(v).length <= max,
      "UTF-8 byte limit exceeded",
    );
const id = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/)
  .refine((v) => BigInt(v) <= 18446744073709551615n);
export const AppSpecSchema = z
  .object({
    version: z.literal(1),
    template: z.literal("agent-marketplace"),
    name: text(60),
    description: text(500),
    accent: z.enum(["mint", "blue", "amber"]),
    entities: z.tuple([
      z.literal("agents"),
      z.literal("services"),
      z.literal("memories"),
    ]),
    actions: z.tuple([
      z.literal("createagent"),
      z.literal("pubservice"),
      z.literal("writemem"),
      z.literal("setstate"),
    ]),
    maxRows: z.literal(1000),
    publicData: z.literal(true),
  })
  .strict();
export type AppSpec = z.infer<typeof AppSpecSchema>;
export const exampleSpec: AppSpec = {
  version: 1,
  template: "agent-marketplace",
  name: "Agent Commons",
  description:
    "A public registry where agents publish services and retain small, inspectable memories.",
  accent: "mint",
  entities: ["agents", "services", "memories"],
  actions: ["createagent", "pubservice", "writemem", "setstate"],
  maxRows: 1000,
  publicData: true,
};
export const PayloadSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("createagent"),
      id,
      name: text(60),
      description: text(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("pubservice"),
      id,
      agentId: id,
      title: text(80),
      description: text(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("writemem"),
      id,
      agentId: id,
      content: text(1024),
    })
    .strict(),
  z
    .object({
      action: z.literal("setstate"),
      id,
      status: z.enum(["active", "paused"]),
    })
    .strict(),
]);
export type Payload = z.infer<typeof PayloadSchema>;
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  throw new Error("Unsupported canonical value");
}
export const digest = (value: unknown): Hex =>
  keccak256(stringToHex(canonical(value)));
export const ownerKey = (owner: string): Hex => sha256(stringToHex(owner));
export function compile(input: unknown) {
  const spec = AppSpecSchema.parse(input);
  const appHash = digest(spec);
  const appId = (BigInt("0x" + appHash.slice(2, 18)) || 1n).toString();
  return {
    spec,
    appHash,
    appId,
    templateVersion: VERSION,
    files: {
      "app.spec.json": JSON.stringify(spec, null, 2),
      "generated/manifest.json": JSON.stringify(
        {
          appId,
          appHash,
          template: spec.template,
          version: VERSION,
          policy: POLICY,
          destination: JUNGLE4,
        },
        null,
        2,
      ),
      "generated/App.tsx": applicationSource(spec.name, spec.description),
      "generated/policy.json": JSON.stringify(
        {
          maxRows: spec.maxRows,
          maxMemoryBytes: 1024,
          ownerScoped: true,
          trustedGateway: true,
          payments: false,
          reputation: "not implemented",
        },
        null,
        2,
      ),
    },
  };
}
export type Compiled = ReturnType<typeof compile>;
export function estimate(payload: Payload) {
  const payloadBytes = new TextEncoder().encode(canonical(payload)).length;
  return {
    minBytes: payload.action === "setstate" ? 0 : payloadBytes + 96,
    maxBytes: payloadBytes + 2048,
    payloadBytes,
    calibrated: false,
    method: "conservative-admission-v1",
    note: "Uncalibrated range; includes allowance for a first row, index and nonce. Not an enforced ceiling on chain RAM.",
  };
}
export const IntentSchema = z
  .object({
    owner: z.string().regex(/^0x[0-9a-f]{40}$/),
    appId: id,
    appHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    destination: z.literal(JUNGLE4),
    runtime: z.string().regex(/^[a-z1-5.]{1,12}$/),
    runtimeCodeHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    runtimeVersion: z.literal(VERSION),
    policy: z.literal(POLICY),
    sourceChainId: z.number().int().positive().max(2147483647),
    action: z.enum(["createagent", "pubservice", "writemem", "setstate"]),
    // JSON escaping can expand a valid 1024-byte string to over 6000 characters.
    payload: z.string().max(7000),
    payloadHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    nonce: id.refine((v) => BigInt(v) < 18446744073709551615n),
    expires: z.number().int().positive(),
    maxRamBytes: z.number().int().min(1).max(10000),
  })
  .strict();
export type Intent = z.infer<typeof IntentSchema>;
export const intentTypes = {
  Intent: [
    { name: "owner", type: "address" },
    { name: "appId", type: "uint64" },
    { name: "appHash", type: "bytes32" },
    { name: "destination", type: "bytes32" },
    { name: "runtime", type: "string" },
    { name: "runtimeCodeHash", type: "bytes32" },
    { name: "runtimeVersion", type: "string" },
    { name: "policy", type: "string" },
    { name: "action", type: "string" },
    { name: "payload", type: "string" },
    { name: "payloadHash", type: "bytes32" },
    { name: "nonce", type: "uint64" },
    { name: "expires", type: "uint64" },
    { name: "maxRamBytes", type: "uint64" },
  ],
} as const;
export function typedData(intent: Intent) {
  const { sourceChainId, ...message } = intent;
  return {
    domain: {
      name: "VaultRAM Studio",
      version: VERSION,
      chainId: sourceChainId,
      salt: digest({
        destination: intent.destination,
        runtime: intent.runtime,
        version: VERSION,
      }),
    },
    types: intentTypes,
    primaryType: "Intent" as const,
    message: {
      ...message,
      owner: intent.owner as Hex,
      appId: BigInt(intent.appId),
      appHash: intent.appHash as Hex,
      runtimeCodeHash: intent.runtimeCodeHash as Hex,
      destination: ("0x" + intent.destination) as Hex,
      payloadHash: intent.payloadHash as Hex,
      nonce: BigInt(intent.nonce),
      expires: BigInt(intent.expires),
      maxRamBytes: BigInt(intent.maxRamBytes),
    },
  };
}
export const intentHash = (intent: Intent) => hashTypedData(typedData(intent));
export function validateReviewIntent(
  raw: unknown,
  expected: {
    app: Compiled;
    payload: Payload;
    owner: string;
    sourceChainId: number;
    runtime: string;
    runtimeCodeHash: string;
  },
  now = Math.floor(Date.now() / 1000),
) {
  const intent = IntentSchema.parse(raw);
  const payload = PayloadSchema.parse(expected.payload);
  if (
    intent.owner !== expected.owner.toLowerCase() ||
    intent.sourceChainId !== expected.sourceChainId ||
    intent.appId !== expected.app.appId ||
    intent.appHash !== expected.app.appHash ||
    intent.runtime !== expected.runtime ||
    intent.runtimeCodeHash !== expected.runtimeCodeHash ||
    intent.action !== payload.action ||
    intent.payload !== canonical(payload) ||
    intent.payloadHash !== digest(payload) ||
    intent.maxRamBytes !== estimate(payload).maxBytes
  )
    throw new Error(
      "Signing request differs from reviewed action or deployment",
    );
  if (intent.expires <= now || intent.expires > now + 300)
    throw new Error("Signing request expired or lifetime too long");
  return intent;
}
export async function validateSignedIntent(
  raw: unknown,
  signature: Hex,
  app: Compiled,
  runtime: string,
  now = Math.floor(Date.now() / 1000),
) {
  const intent = IntentSchema.parse(raw);
  if (
    intent.runtime !== runtime ||
    intent.appId !== app.appId ||
    intent.appHash !== app.appHash
  )
    throw new Error("Intent deployment/app mismatch");
  if (intent.expires <= now || intent.expires > now + 300)
    throw new Error("Intent expired or expiry exceeds five minutes");
  const payload = PayloadSchema.parse(JSON.parse(intent.payload));
  if (
    canonical(payload) !== intent.payload ||
    digest(payload) !== intent.payloadHash ||
    payload.action !== intent.action
  )
    throw new Error("Payload binding mismatch");
  if (estimate(payload).maxBytes > intent.maxRamBytes)
    throw new Error("RAM admission budget insufficient");
  if (
    !(await verifyTypedData({
      ...typedData(intent),
      address: intent.owner as Hex,
      signature,
    }))
  )
    throw new Error("Invalid EOA signature");
  return { intent, payload, hash: intentHash(intent) };
}
export function makeIntent(
  app: Compiled,
  payload: Payload,
  owner: string,
  nonce: string,
  runtime: string,
  sourceChainId = 1,
  runtimeCodeHash = "0x" + "0".repeat(64),
): Intent {
  return IntentSchema.parse({
    owner: owner.toLowerCase(),
    appId: app.appId,
    appHash: app.appHash,
    destination: JUNGLE4,
    runtime,
    runtimeCodeHash,
    runtimeVersion: VERSION,
    policy: POLICY,
    sourceChainId,
    action: payload.action,
    payload: canonical(payload),
    payloadHash: digest(payload),
    nonce,
    expires: Math.floor(Date.now() / 1000) + 240,
    maxRamBytes: estimate(payload).maxBytes,
  });
}
export type StateRow = {
  id: string;
  owner: string;
  action: Payload["action"];
  data: Payload;
  status?: string;
};
export type Receipt = {
  version: 1;
  mode: "SIMULATED" | "JUNGLE4";
  intentHash: string;
  appId: string;
  owner: string;
  action: string;
  status: "SIMULATED" | "SUBMITTED" | "IRREVERSIBLE" | "UNKNOWN";
  transactionId: string | null;
  blockNum: number | null;
  issuedAt: string;
  ram: {
    before: number | null;
    after: number | null;
    delta: number | null;
    method: string;
    attributable: boolean;
    executionTrace?: {
      payer: string;
      delta: number;
      source: "send_transaction";
      transactionId: string;
      independentlyVerified: false;
    };
  };
  stateHash: string | null;
  trust: string;
};
export type SignedReceipt = {
  receipt: Receipt;
  signature: string;
  publicKey: string;
  algorithm: "Ed25519";
};
