import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  compile,
  exampleSpec,
  canonical,
  digest,
  PayloadSchema,
  makeIntent,
  typedData,
  validateSignedIntent,
  estimate,
} from "../packages/core/src/index.ts";
const wallet = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`),
  other = privateKeyToAccount(("0x" + "22".repeat(32)) as `0x${string}`);
const app = compile(exampleSpec),
  payload = {
    action: "createagent",
    id: "1",
    name: "Research",
    description: "Public research",
  } as const;
const fresh = () =>
  makeIntent(app, payload, wallet.address, "1", "vaultdemo111");
describe("compiler and EIP-712 policy", () => {
  it("compiles deterministically with stable canonical hashes", () => {
    expect(compile({ ...exampleSpec })).toEqual(app);
    expect(digest({ b: 2, a: 1 })).toEqual(digest({ a: 1, b: 2 }));
    expect(() => canonical({ a: undefined })).toThrow();
  });
  it("rejects arbitrary features, properties and byte-overflow inputs", () => {
    expect(() => compile({ ...exampleSpec, payments: true })).toThrow();
    expect(() =>
      PayloadSchema.parse({ ...payload, name: "🐳".repeat(20) }),
    ).toThrow();
    expect(() =>
      PayloadSchema.parse({ ...payload, action: "transfer" }),
    ).toThrow();
  });
  it("validates a real EOA signature", async () => {
    const intent = fresh();
    const sig = await wallet.signTypedData(typedData(intent));
    expect(
      (await validateSignedIntent(intent, sig, app, "vaultdemo111")).payload,
    ).toEqual(payload);
  });
  it.each([
    "owner",
    "appId",
    "appHash",
    "runtime",
    "runtimeCodeHash",
    "destination",
    "nonce",
    "action",
    "payload",
    "payloadHash",
    "expires",
    "maxRamBytes",
    "sourceChainId",
  ])("rejects tampering with %s", async (field) => {
    const intent = fresh();
    const sig = await wallet.signTypedData(typedData(intent));
    const bad: Record<string, unknown> = { ...intent };
    const changes: Record<string, unknown> = {
      owner: other.address.toLowerCase(),
      appId: "2",
      appHash: "0x" + "aa".repeat(32),
      runtime: "another11111",
      runtimeCodeHash: "0x" + "aa".repeat(32),
      destination: "aa".repeat(32),
      nonce: "2",
      action: "writemem",
      payload: canonical({ ...payload, name: "Changed" }),
      payloadHash: "0x" + "aa".repeat(32),
      expires: intent.expires - 1,
      maxRamBytes: intent.maxRamBytes + 1,
      sourceChainId: 5,
    };
    bad[field] = changes[field];
    await expect(
      validateSignedIntent(bad, sig, app, "vaultdemo111"),
    ).rejects.toThrow();
  });
  it("rejects expired intents, long lifetimes, insufficient allowance and wrong signer", async () => {
    for (const patch of [
      { expires: Math.floor(Date.now() / 1000) - 1 },
      { expires: Math.floor(Date.now() / 1000) + 600 },
      { maxRamBytes: 1 },
    ]) {
      const intent = { ...fresh(), ...patch };
      await expect(
        validateSignedIntent(
          intent,
          await wallet.signTypedData(typedData(intent)),
          app,
          "vaultdemo111",
        ),
      ).rejects.toThrow();
    }
    const intent = fresh();
    await expect(
      validateSignedIntent(
        intent,
        await other.signTypedData(typedData(intent)),
        app,
        "vaultdemo111",
      ),
    ).rejects.toThrow();
  });
  it("preserves full uint64 entity IDs and rejects overflow", () => {
    expect(
      PayloadSchema.parse({ ...payload, id: "18446744073709551615" }).id,
    ).toBe("18446744073709551615");
    expect(() =>
      PayloadSchema.parse({ ...payload, id: "18446744073709551616" }),
    ).toThrow();
  });
  it("does not pretend estimates are measured", () => {
    expect(estimate(payload).calibrated).toBe(false);
    expect(estimate(payload).maxBytes).toBeGreaterThan(
      estimate(payload).payloadBytes,
    );
  });
});
