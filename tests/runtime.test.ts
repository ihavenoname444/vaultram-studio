import { beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { Blockchain, type Account } from "@vaulta/vert";
import {
  compile,
  exampleSpec,
  makeIntent,
  intentHash,
  type Payload,
} from "../packages/core/src/index.ts";
import { actionData } from "../services/gateway/src/chain.ts";
const available =
  existsSync("contracts/build/runtime.wasm") &&
  existsSync("contracts/build/runtime.abi");
if (process.env.REQUIRE_WASM === "1" && !available)
  throw new Error("WASM tests required but artifacts are missing");
const app = compile(exampleSpec),
  owner = "0x" + "11".repeat(20),
  stranger = "0x" + "22".repeat(20);
const agent: Payload = {
  action: "createagent",
  id: "1",
  name: "Agent",
  description: "Public research",
};
describe.skipIf(!available)(
  "actual compiled runtime (VeRT, not a live chain)",
  () => {
    let chain: Blockchain, runtime: Account;
    beforeEach(async () => {
      chain = new Blockchain();
      chain.createAccounts("relayacct111", "stranger1111");
      runtime = chain.createContract("runtime11111", "contracts/build/runtime");
      await runtime.actions
        .init({ relayer: "relayacct111" })
        .send("runtime11111@active");
      await runtime.actions
        .regapp({ app_id: app.appId, app_hash: app.appHash.slice(2) })
        .send("runtime11111@active");
    });
    function execute(
      payload: Payload,
      nonce = "1",
      signer = owner,
      patch: Record<string, unknown> = {},
      permission = "relayacct111@relay",
    ) {
      const intent = {
        ...makeIntent(app, payload, signer, nonce, "runtime11111"),
        expires: 240,
      };
      return runtime.actions
        .execute({
          ...actionData(intent, payload, intentHash(intent)),
          ...patch,
        })
        .send(permission);
    }
    const rows = () => runtime.tables.items(BigInt(app.appId)).getTableRows();
    it("executes agent, service, memory and status and retains nonce", async () => {
      await execute(agent);
      await execute(
        {
          action: "pubservice",
          id: "2",
          agentId: "1",
          title: "Search",
          description: "Public search",
        },
        "2",
      );
      await execute(
        {
          action: "writemem",
          id: "3",
          agentId: "1",
          content: "A small public memory",
        },
        "3",
      );
      await execute({ action: "setstate", id: "1", status: "paused" }, "4");
      expect(rows()).toHaveLength(3);
      expect(rows()[0].status).toBe("paused");
      expect(
        String(
          runtime.tables.nonces(BigInt(app.appId)).getTableRows()[0].nonce,
        ),
      ).toBe("4");
    });
    it("rejects wrong permission and replay without changing state", async () => {
      await expect(
        execute(agent, "1", owner, {}, "stranger1111@active"),
      ).rejects.toThrow();
      await execute(agent);
      await expect(execute({ ...agent, id: "2" })).rejects.toThrow("nonce");
      expect(rows()).toHaveLength(1);
    });
    it("atomically rejects ownership attacks, forged app binding and oversized data", async () => {
      await execute(agent);
      await expect(
        execute(
          { action: "setstate", id: "1", status: "paused" },
          "1",
          stranger,
        ),
      ).rejects.toThrow("not owned");
      await expect(
        execute({ ...agent, id: "2" }, "2", owner, {
          app_hash: "aa".repeat(32),
        }),
      ).rejects.toThrow("hash");
      await expect(
        execute({ ...agent, id: "2" }, "2", owner, {
          content: "x".repeat(1025),
        }),
      ).rejects.toThrow("large");
      expect(rows()).toHaveLength(1);
      expect(
        String(
          runtime.tables.nonces(BigInt(app.appId)).getTableRows()[0].nonce,
        ),
      ).toBe("1");
    });
    it("rejects expired requests and paused runtime", async () => {
      await expect(execute(agent, "1", owner, { expires: 0 })).rejects.toThrow(
        "expired",
      );
      await runtime.actions.pause({ paused: true }).send("runtime11111@active");
      await expect(execute(agent)).rejects.toThrow("paused");
      expect(rows()).toHaveLength(0);
    });
  },
);
