import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { Blockchain, type Account } from "@vaulta/vert";
import { API } from "@wharfkit/antelope-vert";
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
      const [relay] = chain.createAccounts("relayacct111", "stranger1111");
      relay.permissions.push(
        API.v1.AccountPermission.from({
          perm_name: "relay",
          parent: "active",
          required_auth: { threshold: 1, keys: [], accounts: [], waits: [] },
        }),
      );
      runtime = chain.createAccount({
        name: "runtime11111",
        abi: JSON.parse(readFileSync("contracts/build/runtime.abi", "utf8")),
        wasm: readFileSync("contracts/build/runtime.wasm"),
      });
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
      await expect(
        execute(agent, "1", owner, {}, "relayacct111@active"),
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
    it("rejects unauthorized administration, reinitialization, bad owner keys and nonce gaps", async () => {
      await expect(
        runtime.actions
          .init({ relayer: "stranger1111" })
          .send("runtime11111@active"),
      ).rejects.toThrow("initialized");
      await expect(
        runtime.actions.pause({ paused: true }).send("relayacct111@relay"),
      ).rejects.toThrow();
      await expect(
        runtime.actions
          .regapp({ app_id: "2", app_hash: app.appHash.slice(2) })
          .send("stranger1111@active"),
      ).rejects.toThrow();
      await expect(execute(agent, "2")).rejects.toThrow("first nonce");
      await expect(
        execute(agent, "1", owner, { owner_key: "ff".repeat(32) }),
      ).rejects.toThrow("owner key");
      await execute(agent);
      await expect(
        execute(
          {
            action: "pubservice",
            id: "2",
            agentId: "1",
            title: "S",
            description: "D",
          },
          "1",
          stranger,
        ),
      ).rejects.toThrow("not owned");
      await expect(execute({ ...agent, id: "2" }, "3")).rejects.toThrow(
        "nonce",
      );
      expect(rows()).toHaveLength(1);
    });
    it("enforces the app cap without changing its configuration after failure", async () => {
      for (let n = 1; n < 64; n++)
        await runtime.actions
          .regapp({ app_id: String(n), app_hash: app.appHash.slice(2) })
          .send("runtime11111@active");
      await expect(
        runtime.actions
          .regapp({ app_id: "64", app_hash: app.appHash.slice(2) })
          .send("runtime11111@active"),
      ).rejects.toThrow("app limit");
      expect(
        runtime.tables
          .apps(BigInt(runtime.name.value.toString()))
          .getTableRows(),
      ).toHaveLength(64);
    });
  },
);
