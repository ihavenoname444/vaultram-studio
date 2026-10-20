import { describe, it, expect } from "vitest";
import {
  PrivateKey,
  Transaction,
  Serializer,
  UInt64,
} from "@wharfkit/antelope";
import { JUNGLE4 } from "../packages/core/src/index.ts";
import {
  ownerWalletTransaction,
  verifyOwnerWalletResult,
  signOwnerRevocation,
} from "../apps/studio/src/owner-wallet.ts";

function fixture(seconds = 100) {
  const key = PrivateKey.generate("K1");
  const transaction = Transaction.from({
    expiration: new Date(Date.now() + seconds * 1000)
      .toISOString()
      .slice(0, 19),
    ref_block_num: 123,
    ref_block_prefix: 456,
    actions: [
      {
        account: "authority111",
        name: "revoke",
        authorization: [{ actor: "owner1111111", permission: "active" }],
        data: Serializer.encode({ object: UInt64.from(1) }),
      },
    ],
  });
  const request = {
    transaction,
    chainId: JUNGLE4,
    contract: "authority111",
    owner: "owner1111111",
    grantId: "1",
    publicKey: String(key.toPublic()),
    transactionId: String(transaction.id),
    signingDigest: String(transaction.signingDigest(JUNGLE4)),
  };
  const result = {
    transaction,
    resolved: {
      transaction,
      chainId: JUNGLE4,
      signer: { actor: request.owner, permission: "active" },
    },
    chain: { id: JUNGLE4 },
    signer: { actor: request.owner, permission: "active" },
    signatures: [key.signDigest(transaction.signingDigest(JUNGLE4))],
  };
  return { key, request, result };
}
describe("external owner wallet boundary", () => {
  it("accepts an exact native revocation with a real cryptographic signature", () => {
    const { request, result } = fixture();
    expect(String(ownerWalletTransaction(request).id)).toBe(
      request.transactionId,
    );
    expect(verifyOwnerWalletResult(request, result)).toBe(
      String(result.signatures[0]),
    );
  });
  it("rejects request domain, grant and authorization changes", () => {
    const { request } = fixture();
    for (const patch of [
      { chainId: "0".repeat(64) },
      { owner: "other1111111" },
      { contract: "other1111111" },
      { grantId: "2" },
      { transactionId: "0".repeat(64) },
      { signingDigest: "0".repeat(64) },
    ])
      expect(() => ownerWalletTransaction({ ...request, ...patch })).toThrow();
  });
  it("rejects modified wallet bytes even when the returned signature is valid for them", () => {
    const { key, request, result } = fixture();
    const transaction = Transaction.from({
      ...JSON.parse(JSON.stringify(result.transaction)),
      ref_block_num: 124,
    });
    expect(() =>
      verifyOwnerWalletResult(request, {
        ...result,
        transaction,
        resolved: { ...result.resolved, transaction },
        signatures: [key.signDigest(transaction.signingDigest(JUNGLE4))],
      }),
    ).toThrow();
  });
  it("rejects wrong chain, signer, permission, signature and extra signatures", () => {
    const { request, result } = fixture();
    for (const patch of [
      { chain: { id: "0".repeat(64) } },
      { signer: { actor: "other1111111", permission: "active" } },
      { signer: { actor: request.owner, permission: "owner" } },
      {
        signatures: [
          PrivateKey.generate("K1").signDigest(request.signingDigest),
        ],
      },
      { signatures: [...result.signatures, ...result.signatures] },
    ])
      expect(() =>
        verifyOwnerWalletResult(request, { ...result, ...patch }),
      ).toThrow();
  });
  it("rejects expired requests and excessive validity", () => {
    for (const seconds of [-1, 130])
      expect(() => ownerWalletTransaction(fixture(seconds).request)).toThrow();
  });
  it("validates encoded SDK transaction even when its display transaction contains decoded action data", () => {
    const { request, result } = fixture();
    const decoded = JSON.parse(JSON.stringify(result.transaction));
    decoded.actions[0].data = { grant_id: "1" };
    expect(() => Transaction.from(decoded)).toThrow("Missing ABI");
    expect(
      verifyOwnerWalletResult(request, { ...result, transaction: decoded }),
    ).toBe(String(result.signatures[0]));
    expect(() =>
      verifyOwnerWalletResult(request, { ...result, resolved: undefined }),
    ).toThrow();
    expect(() =>
      verifyOwnerWalletResult(request, {
        ...result,
        resolved: { ...result.resolved, chainId: "0".repeat(64) },
      }),
    ).toThrow();
  });
  it("requires an actual connected native wallet before invoking signing", async () => {
    await expect(signOwnerRevocation(fixture().request)).rejects.toThrow(
      "Connect Anchor",
    );
  });
});
