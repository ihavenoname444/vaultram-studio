import { it, expect } from "vitest";
import {
  assertNativeBlock,
  assertNativeEffect,
} from "../packages/core/src/native-evidence.ts";
const txid = "a".repeat(64),
  blockId = "b".repeat(64);
const block = {
  block_num: 10,
  id: blockId,
  transactions: [{ status: "executed", trx: { id: txid } }],
};
it("rejects non-final, malformed, substituted or non-executed inclusion evidence", () => {
  expect(() => assertNativeBlock(block, 10, txid, 11, blockId)).not.toThrow();
  for (const n of [undefined, "10", "head", NaN, 0, -1, 10.5])
    expect(() => assertNativeBlock(block, n, txid, 11, blockId)).toThrow();
  for (const lib of [undefined, "11", NaN, 9])
    expect(() => assertNativeBlock(block, 10, txid, lib, blockId)).toThrow();
  for (const patch of [
    { block_num: 11 },
    { id: "c".repeat(64) },
    { transactions: [] },
    { transactions: [{ status: "soft_fail", trx: { id: txid } }] },
    { transactions: [{ status: "executed", trx: { id: "d".repeat(64) } }] },
  ])
    expect(() =>
      assertNativeBlock({ ...block, ...patch }, 10, txid, 11, blockId),
    ).toThrow();
});
it("checks every protected effect and reservation binding, not only the payload", () => {
  const c = { grantId: "1", actor: "agent1111111", space: "memory" };
  const e = {
    id: "2",
    reservation: "2",
    grant_id: "1",
    actor: c.actor,
    space: c.space,
    payload: "hello",
  };
  const r = {
    id: "2",
    grant_id: "1",
    obligation: "2",
    nullifier: "2",
    effect_id: "2",
    status: 1,
    payload_hash: txid,
  };
  expect(() => assertNativeEffect(e, r, c, "2", "hello", txid)).not.toThrow();
  for (const key of Object.keys(e))
    expect(() =>
      assertNativeEffect(
        { ...e, [key]: "substituted" },
        r,
        c,
        "2",
        "hello",
        txid,
      ),
    ).toThrow();
  for (const key of Object.keys(r))
    expect(() =>
      assertNativeEffect(
        e,
        { ...r, [key]: "substituted" },
        c,
        "2",
        "hello",
        txid,
      ),
    ).toThrow();
});
