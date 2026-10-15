import { describe, it, expect, vi } from "vitest";
import { Jungle, uint64 } from "../services/gateway/src/chain.ts";
import { JUNGLE4 } from "../packages/core/src/index.ts";
describe("RPC boundaries", () => {
  it("rejects lossy numbers instead of silently changing IDs", () => {
    expect(uint64("18446744073709551615")).toBe("18446744073709551615");
    expect(() => uint64(18446744073709551615)).toThrow("lossy");
    expect(() => uint64("-1")).toThrow();
  });
  it("replaces a preliminary block with actual inclusion and requires irreversible inclusion", async () => {
    const c = new Jungle(
      "https://unused.example",
      "runtime11111",
      "relayacct111",
      "",
      "ab".repeat(32),
    );
    vi.spyOn(c, "rpc").mockImplementation(async (path) => {
      if (path === "get_transaction_status") return { block_number: 101 };
      if (path === "get_info")
        return { chain_id: JUNGLE4, last_irreversible_block_num: 101 };
      if (path === "get_code_hash") return { code_hash: "ab".repeat(32) };
      if (path === "get_block")
        return { transactions: [{ status: "executed", trx: { id: "tx" } }] };
      throw new Error("Unexpected RPC");
    });
    expect(await c.inclusionBlock("tx", 100)).toBe(101);
    expect(await c.finality("tx", 101)).toBe(true);
    expect(await c.finality("different", 101)).toBe(false);
    expect(await c.finality("tx", 102)).toBe(false);
  });
});
