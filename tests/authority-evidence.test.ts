import { describe, expect, it } from "vitest";
import { SignedTransaction } from "@wharfkit/antelope";
import {
  authorityCases,
  validateAuthorityMatrix,
  validateBuildBinding,
} from "../scripts/lib/authority-evidence.ts";
const account = "authority111",
  chain = "a".repeat(64);
function fixture() {
  const tx = SignedTransaction.from({
    expiration: "2030-01-01T00:00:00",
    ref_block_num: 1,
    ref_block_prefix: 1,
    actions: [
      {
        account,
        name: "reserve",
        authorization: [{ actor: "agent1111111", permission: "active" }],
        data: "",
      },
    ],
    signatures: [],
  });
  const signed = JSON.parse(JSON.stringify(tx)),
    id = String(tx.id);
  const state = {
    root: [{ total: 10000, available: 0 }],
    grants: [{}, {}, {}, {}],
    effects: [{}, {}],
  };
  return {
    complete: true,
    account,
    chainId: chain,
    finalState: state,
    events: authorityCases.map(([label, pattern]) =>
      pattern === "RACE"
        ? {
            label,
            before: state,
            after: state,
            signedTransactions: [signed, signed],
            results: [
              { transactionId: id, block: 1 },
              {
                originalStatus: { state: "EXPIRED" },
                retry: {
                  error: "budget exhausted",
                  transactionId: id,
                  signedTransaction: signed,
                  before: state,
                  after: state,
                },
              },
            ],
          }
        : {
            label,
            before: state,
            after: state,
            signedTransaction: signed,
            transactionId: id,
            expected: pattern ? "REJECT" : "EXECUTE",
            ...(pattern ? { error: pattern } : { block: 1 }),
          },
    ),
  };
}
const validate = (r: any) =>
  validateAuthorityMatrix(r, account, chain, () => {});
describe("authority evidence integrity boundaries", () => {
  it("binds every reviewed build hash and chain before trusting deployment metadata", () => {
    const build = {
      sourceSha256: "1".repeat(64),
      wasmSha256: "2".repeat(64),
      abiSha256: "3".repeat(64),
    };
    const d = { ...build, account, chainId: chain };
    expect(() => validateBuildBinding(d, build, account, chain)).not.toThrow();
    for (const field of [
      "sourceSha256",
      "wasmSha256",
      "abiSha256",
      "chainId",
      "account",
    ])
      expect(() =>
        validateBuildBinding(
          { ...d, [field]: "substituted" },
          build,
          account,
          chain,
        ),
      ).toThrow();
  });
  it("rejects omitted/relabelled cases and fabricated rejection outcomes", () => {
    const base = fixture();
    expect(() => validate(base)).not.toThrow();
    const missing = structuredClone(base);
    missing.events.splice(1, 1);
    expect(() => validate(missing)).toThrow("Incomplete matrix");
    const relabelled = structuredClone(base);
    relabelled.events[0].label = "wrong";
    expect(() => validate(relabelled)).toThrow("Missing/reordered");
    const wrongError: any = structuredClone(base);
    wrongError.events[0].error = "RPC unavailable";
    expect(() => validate(wrongError)).toThrow("rejection");
    const changed: any = structuredClone(base);
    changed.events[0].after = { ...changed.events[0].after, unexpected: true };
    expect(() => validate(changed)).toThrow("rejection");
  });
  it("rejects two race winners, tampered transaction IDs and missing successful inclusion", () => {
    const base = fixture();
    const race: any = structuredClone(base);
    const e = race.events.find((e: any) => e.results);
    e.results[1] = { ...e.results[0] };
    expect(() => validate(race)).toThrow("race");
    const digest: any = structuredClone(base);
    digest.events[1].transactionId = "0".repeat(64);
    expect(() => validate(digest)).toThrow("transaction");
    const missing: any = structuredClone(base);
    delete missing.events[1].block;
    expect(() => validate(missing)).toThrow("execution");
  });
});
