import {
  APIClient,
  FetchProvider,
  ABI,
  Action,
  Transaction,
  SignedTransaction,
  PrivateKey,
  Serializer,
} from "@wharfkit/antelope";
import { createHash } from "node:crypto";
import {
  JUNGLE4,
  ownerKey,
  type Compiled,
  type Intent,
  type Payload,
  type StateRow,
} from "../../../packages/core/src/index.ts";
export function actionData(intent: Intent, payload: Payload, hash: string) {
  return {
    app_id: intent.appId,
    app_hash: intent.appHash.slice(2),
    owner: intent.owner,
    owner_key: ownerKey(intent.owner).slice(2),
    nonce: intent.nonce,
    expires: intent.expires,
    intent_hash: hash.slice(2),
    kind: ["createagent", "pubservice", "writemem", "setstate"].indexOf(
      payload.action,
    ),
    entity_id: payload.id,
    parent_id: "agentId" in payload ? payload.agentId : "0",
    title:
      "name" in payload
        ? payload.name
        : "title" in payload
          ? payload.title
          : "",
    content:
      "description" in payload
        ? payload.description
        : "content" in payload
          ? payload.content
          : "",
    status: "status" in payload ? payload.status : "active",
    ram_budget: intent.maxRamBytes,
  };
}
export function uint64(value: unknown): string {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("RPC returned a lossy uint64 number");
  const result = String(value);
  if (!/^[0-9]{1,20}$/.test(result) || BigInt(result) > 18446744073709551615n)
    throw new Error("Invalid uint64 in RPC response");
  return result;
}
// Only accept the exact single-action shape emitted by this runtime. Missing or
// ambiguous traces are unknown, never an invented zero. RPC traces remain trusted.
export function executionRam(
  processed: any,
  runtime: string,
  payer: string,
): number | null {
  const traces = processed?.action_traces;
  if (!Array.isArray(traces) || traces.length !== 1) return null;
  const trace = traces[0];
  if (
    trace?.receiver !== runtime ||
    trace?.act?.account !== runtime ||
    trace?.act?.name !== "execute" ||
    trace?.except ||
    (trace?.inline_traces?.length ?? 0) !== 0 ||
    !Array.isArray(trace?.account_ram_deltas) ||
    processed.account_ram_delta
  )
    return null;
  const seen = new Set<string>();
  let delta = 0;
  for (const entry of trace.account_ram_deltas) {
    if (
      !entry ||
      typeof entry.account !== "string" ||
      seen.has(entry.account) ||
      typeof entry.delta !== "number" ||
      !Number.isSafeInteger(entry.delta)
    )
      return null;
    seen.add(entry.account);
    if (entry.account === payer) delta += entry.delta;
  }
  return Number.isSafeInteger(delta) ? delta : null;
}
export class Jungle {
  client: APIClient;
  constructor(
    readonly url: string,
    readonly runtime: string,
    readonly relayer: string,
    readonly key: string,
    readonly codeHash: string,
    readonly permission = "relay",
    readonly abiHash?: string,
  ) {
    this.client = new APIClient({
      provider: new FetchProvider(url, {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      }),
    });
  }
  async rpc(path: string, body: unknown) {
    const r = await fetch(this.url + "/v1/chain/" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw new Error("Jungle4 RPC " + path + " failed (" + r.status + ")");
    return r.json();
  }
  async check() {
    const info = await this.rpc("get_info", {});
    if (info.chain_id !== JUNGLE4) throw new Error("Wrong destination chain");
    const code = await this.rpc("get_code_hash", {
      account_name: this.runtime,
    });
    if (code.code_hash !== this.codeHash)
      throw new Error("Runtime code hash does not match pinned deployment");
    if (this.abiHash) {
      const abi = await this.rpc("get_raw_abi", { account_name: this.runtime });
      if (abi.abi_hash !== this.abiHash)
        throw new Error("Runtime ABI hash does not match pinned deployment");
    }
    return info;
  }
  async table(
    table: string,
    scope: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.rpc("get_table_rows", {
      json: true,
      code: this.runtime,
      scope,
      table,
      limit: 1000,
      ...extra,
    });
  }
  async deployed(app: Compiled) {
    await this.check();
    const res = await this.table("apps", this.runtime, {
      lower_bound: app.appId,
      upper_bound: app.appId,
      limit: 1,
    });
    return res.rows.some(
      (r: { id: string | number; hash: string }) =>
        uint64(r.id) === app.appId && r.hash === app.appHash.slice(2),
    );
  }
  async nextNonce(app: string, owner: string) {
    const res = await this.table("nonces", app, {
      index_position: 2,
      key_type: "sha256",
      lower_bound: ownerKey(owner).slice(2),
      upper_bound: ownerKey(owner).slice(2),
      limit: 1,
    });
    const row = res.rows.find((r: { owner: string }) => r.owner === owner);
    return (BigInt(uint64(row?.nonce ?? 0)) + 1n).toString();
  }
  async ram() {
    const r = await this.rpc("get_account", { account_name: this.relayer });
    if (!Number.isSafeInteger(r.ram_usage) || r.ram_usage < 0)
      throw new Error("Invalid RPC RAM usage");
    return r.ram_usage as number;
  }
  async prepare(intent: Intent, payload: Payload, hash: string) {
    await this.check();
    const info = await this.client.v1.chain.get_info();
    if (String(info.chain_id) !== JUNGLE4)
      throw new Error("Wrong transaction-header chain");
    const { abi } = await this.client.v1.chain.get_abi(this.runtime);
    if (!abi) throw new Error("Missing runtime ABI");
    if (
      this.abiHash &&
      createHash("sha256")
        .update(Serializer.encode({ object: ABI.from(abi) }).array)
        .digest("hex") !== this.abiHash
    )
      throw new Error("Fetched transaction ABI differs from pin");
    const action = Action.from(
      {
        account: this.runtime,
        name: "execute",
        authorization: [{ actor: this.relayer, permission: this.permission }],
        data: actionData(intent, payload, hash),
      },
      abi,
    );
    const tx = Transaction.from({
      ...info.getTransactionHeader(90),
      actions: [action],
    });
    const signature = PrivateKey.from(this.key).signDigest(
      tx.signingDigest(JUNGLE4),
    );
    return {
      transaction: JSON.parse(
        JSON.stringify(
          SignedTransaction.from({ ...tx, signatures: [signature] }),
        ),
      ),
      transactionId: String(tx.id),
      packed: Serializer.encode({ object: tx }).hexString,
    };
  }
  async broadcast(prepared: Awaited<ReturnType<Jungle["prepare"]>>) {
    const r = await this.client.v1.chain.send_transaction(
      SignedTransaction.from(prepared.transaction),
    );
    const json = JSON.parse(JSON.stringify(r));
    if (
      json.processed?.except ||
      json.processed?.receipt?.status !== "executed"
    )
      throw new Error("Transaction not confirmed executed");
    if (json.transaction_id !== prepared.transactionId)
      throw new Error("Transaction response ID mismatch");
    if (
      !Number.isSafeInteger(json.processed.block_num) ||
      json.processed.block_num <= 0
    )
      throw new Error("Invalid transaction block number");
    return {
      transactionId: json.transaction_id as string,
      blockNum: Number(json.processed.block_num),
      executionRamDelta: executionRam(
        json.processed,
        this.runtime,
        this.relayer,
      ),
    };
  }
  async inclusionBlock(
    txid: string,
    hint: number | null,
  ): Promise<number | null> {
    try {
      const status = await this.rpc("get_transaction_status", { id: txid });
      const actual = Number(status.block_number);
      if (Number.isSafeInteger(actual) && actual > 0) return actual;
    } catch {
      /* Fall back to a recorded block and verify inclusion there. */
    }
    return hint;
  }
  async finality(txid: string, blockNum: number) {
    const info = await this.check();
    const block = await this.rpc("get_block", { block_num_or_id: blockNum });
    const included = block.transactions?.some(
      (t: { trx: string | { id: string }; status: string }) =>
        (typeof t.trx === "string" ? t.trx : t.trx.id) === txid &&
        t.status === "executed",
    );
    return !!included && info.last_irreversible_block_num >= blockNum;
  }
  async rows(app: string): Promise<StateRow[]> {
    const res = await this.table("items", app);
    if (res.more) throw new Error("State pagination exceeds configured cap");
    return res.rows.map(
      (r: {
        id: string | number;
        owner: string;
        kind: number;
        parent: string | number;
        title: string;
        content: string;
        status: string;
      }) => {
        const id = uint64(r.id);
        const action = (["createagent", "pubservice", "writemem"] as const)[
          r.kind
        ];
        const data: Payload =
          r.kind === 0
            ? {
                action: "createagent",
                id,
                name: r.title,
                description: r.content,
              }
            : r.kind === 1
              ? {
                  action: "pubservice",
                  id,
                  agentId: uint64(r.parent),
                  title: r.title,
                  description: r.content,
                }
              : {
                  action: "writemem",
                  id,
                  agentId: uint64(r.parent),
                  content: r.content,
                };
        return { id, owner: r.owner, action, data, status: r.status };
      },
    );
  }
}
