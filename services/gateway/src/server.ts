import Fastify from "fastify";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { z } from "zod";
import {
  compile,
  PayloadSchema,
  canonical,
  digest,
  estimate,
  makeIntent,
  typedData,
  validateSignedIntent,
  type Receipt,
  type Intent,
  type Compiled,
} from "../../../packages/core/src/index.ts";
import { Store } from "./store.ts";
import { receiptSigner } from "./receipt.ts";
import { Jungle } from "./chain.ts";
import { describe } from "./ai.ts";
import { AuthorityGateway, NativeWrite } from "./authority.ts";
import { readPrivateJson } from "./private-file.ts";
if (existsSync(".env")) process.loadEnvFile(".env");
export async function createServer(
  options: { directory?: string; mode?: "SIMULATED" | "JUNGLE4" } = {},
) {
  const mode = options.mode ?? process.env.VAULTRAM_MODE ?? "SIMULATED";
  if (mode !== "SIMULATED" && mode !== "JUNGLE4")
    throw new Error("VAULTRAM_MODE must be SIMULATED or JUNGLE4");
  const directory = resolve(
    options.directory ?? process.env.VAULTRAM_DATA_DIR ?? ".data",
  );
  const port = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(process.env.VAULTRAM_PORT ?? 8787);
  const uiPort = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(process.env.VAULTRAM_UI_PORT ?? 5173);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  const runtime =
    mode === "SIMULATED" ? "vaultdemo111" : process.env.VAULTA_RUNTIME;
  let chain: Jungle | undefined;
  if (mode === "JUNGLE4") {
    for (const key of [
      "VAULTA_RPC",
      "VAULTA_RUNTIME",
      "VAULTA_RELAYER",
      "VAULTA_RELAYER_PRIVATE_KEY",
      "VAULTA_CODE_HASH",
      "VAULTA_ABI_HASH",
    ])
      if (!process.env[key]) throw new Error("JUNGLE4 mode requires " + key);
    if (
      !/^[a-f0-9]{64}$/.test(process.env.VAULTA_CODE_HASH!) ||
      !/^[a-f0-9]{64}$/.test(process.env.VAULTA_ABI_HASH!)
    )
      throw new Error("Invalid pinned code hash");
    chain = new Jungle(
      process.env.VAULTA_RPC!,
      runtime!,
      process.env.VAULTA_RELAYER!,
      process.env.VAULTA_RELAYER_PRIVATE_KEY!,
      process.env.VAULTA_CODE_HASH!,
      process.env.VAULTA_PERMISSION ?? "relay",
      process.env.VAULTA_ABI_HASH!,
    );
    await chain.check();
  }
  const store = new Store(directory + "/" + mode.toLowerCase() + ".sqlite");
  const authority =
    mode === "JUNGLE4" && process.env.VAULTRAM_AUTHORITY_CONFIG
      ? new AuthorityGateway(
          readPrivateJson(process.env.VAULTRAM_AUTHORITY_CONFIG),
          directory,
        )
      : undefined;
  if (authority) {
    await authority.pins(authority.c.rpc);
    await authority.pins(authority.c.independent);
    await authority.permission();
  }
  const signer = receiptSigner(directory + "/receipt-key.pem");
  const demoPath = directory + "/simulation-wallet.key";
  if (mode === "SIMULATED" && !existsSync(demoPath))
    writeFileSync(demoPath, generatePrivateKey(), { flag: "wx", mode: 0o600 });
  const demo =
    mode === "SIMULATED"
      ? privateKeyToAccount(readFileSync(demoPath, "utf8") as Hex)
      : undefined;
  const server = Fastify({ logger: false, bodyLimit: 32768 });
  let tail: Promise<unknown> = Promise.resolve();
  let queued = 0;
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    if (queued >= 16)
      return Promise.reject(
        new Error(
          "Submission queue full; reconcile pending work before retrying",
        ),
      );
    queued++;
    const run = tail.then(fn).finally(() => {
      queued--;
    });
    tail = run.catch(() => {});
    return run;
  }
  let windowStart = Date.now(),
    requests = 0;
  server.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(
        (req.headers.host ?? "").replace(/:\d+$/, ""),
      )
    )
      return reply.code(403).send({ error: "Local host required" });
    if (Date.now() - windowStart > 60000) {
      windowStart = Date.now();
      requests = 0;
    }
    if (++requests > 300)
      return reply.code(429).send({ error: "Rate limit; retry in a minute" });
    if (req.method !== "GET" && req.headers["x-vaultram-token"] !== token)
      return reply.code(403).send({ error: "Missing local session token" });
    const origin = req.headers.origin;
    if (
      origin &&
      ![
        `http://localhost:${uiPort}`,
        `http://127.0.0.1:${uiPort}`,
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
      ].includes(origin)
    )
      return reply.code(403).send({ error: "Origin rejected" });
  });
  server.setErrorHandler((error, _req, reply) => {
    const safe =
      error instanceof z.ZodError
        ? "Input validation failed: " +
          error.issues.map((i) => i.path.join(".") + " " + i.message).join(";")
        : error instanceof Error
          ? error.message
          : "Request failed";
    reply
      .code(400)
      .send({ error: safe.replace(/PVT_[A-Za-z0-9_]+/g, "[REDACTED]") });
  });
  server.get("/api/config", async () => ({
    authorityEnabled: !!authority,
    mode,
    runtime,
    runtimeCodeHash: "0x" + (chain?.codeHash ?? "0".repeat(64)),
    token,
    ai:
      process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
        ? "OPENAI"
        : "FIXTURE",
    receiptPublicKey: signer.publicKey,
    demoOwner: demo?.address.toLowerCase(),
    network: "Jungle4",
    trust:
      "EOA signature verified by trusted gateway; contract trusts relayer. No origin-chain transaction or bridge.",
  }));
  server.get("/api/apps", async () => store.apps());
  const native = () => {
    if (!authority) throw new Error("Native authority is not configured");
    return authority;
  };
  server.get("/api/authority", async () => native().state());
  server.post("/api/authority/prepare", async (req) =>
    serial(async () => {
      const body = NativeWrite.parse(req.body);
      store.app(body.appId);
      return native().prepare(body);
    }),
  );
  server.post("/api/authority/execute", async (req) =>
    serial(async () => {
      const body = z
        .object({
          id: z.string().uuid(),
          payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .parse(req.body);
      return native().submit(body.id, body.payloadHash);
    }),
  );
  server.post("/api/authority/reconcile", async (req) =>
    serial(async () => {
      const body = z.object({ id: z.string().uuid() }).strict().parse(req.body);
      return native().reconcile(body.id);
    }),
  );
  server.get("/api/receipts", async () => store.receipts());
  server.get<{ Params: { id: string } }>("/api/apps/:id/state", async (req) => {
    store.app(req.params.id);
    return chain ? chain.rows(req.params.id) : store.rows(req.params.id);
  });
  server.post("/api/compile", async (req) => {
    const body = z
      .object({ prompt: z.string().min(1).max(4000) })
      .strict()
      .parse(req.body);
    const result = await describe(body.prompt);
    const app = compile(result.spec);
    store.putApp(app);
    return { ...app, provenance: result.provenance, note: result.note };
  });
  server.post("/api/deploy", async (req) => {
    const { appId } = z.object({ appId: z.string() }).strict().parse(req.body);
    const app = store.app(appId);
    if (chain && !(await chain.deployed(app)))
      throw new Error(
        "App is not registered on Jungle4. Run the documented deployment and register command with the deployment account first.",
      );
    store.deploy(appId);
    return { status: chain ? "JUNGLE4_REGISTERED" : "SIMULATED", appId };
  });
  async function intentFor(
    app: Compiled,
    payload: unknown,
    owner: string,
    sourceChainId: number,
  ) {
    if (!store.deployed(app.appId)) throw new Error("Deploy this app first");
    const parsed = PayloadSchema.parse(payload);
    if (chain && store.unresolved(app.appId, owner.toLowerCase()))
      throw new Error(
        "Previous submission is unresolved; reconcile it before signing another action",
      );
    const nonce = chain
      ? await chain.nextNonce(app.appId, owner.toLowerCase())
      : store.nextNonce(app.appId, owner.toLowerCase());
    if (
      chain &&
      BigInt(nonce) < BigInt(store.nextNonce(app.appId, owner.toLowerCase()))
    )
      throw new Error(
        "RPC nonce is behind local submissions; wait for chain visibility and prepare again",
      );
    return {
      intent: makeIntent(
        app,
        parsed,
        owner,
        nonce,
        runtime!,
        sourceChainId,
        chain ? "0x" + chain.codeHash : undefined,
      ),
      estimate: estimate(parsed),
    };
  }
  server.post("/api/intent", async (req) => {
    const b = z
      .object({
        appId: z.string(),
        payload: z.unknown(),
        owner: z.string(),
        sourceChainId: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    return intentFor(store.app(b.appId), b.payload, b.owner, b.sourceChainId);
  });
  async function execute(raw: unknown, signature: Hex) {
    const id = z.object({ appId: z.string() }).parse(raw).appId;
    const app = store.app(id);
    if (!store.deployed(id)) throw new Error("Deploy this app first");
    const { intent, payload, hash } = await validateSignedIntent(
      raw,
      signature,
      app,
      runtime!,
    );
    if (
      intent.runtimeCodeHash !==
      (chain ? "0x" + chain.codeHash : "0x" + "0".repeat(64))
    )
      throw new Error("Runtime code pin mismatch");
    const existing = store.get(hash);
    if (existing) return existing;
    if (chain && store.unresolved(id, intent.owner))
      throw new Error(
        "Previous submission is unresolved; reconcile before executing another action",
      );
    const base: Receipt = {
      version: 1,
      mode: mode as Receipt["mode"],
      intentHash: hash,
      appId: id,
      owner: intent.owner,
      action: intent.action,
      status: mode === "SIMULATED" ? "SIMULATED" : "UNKNOWN",
      transactionId: null,
      blockNum: null,
      issuedAt: new Date().toISOString(),
      ram: {
        before: null,
        after: null,
        delta: null,
        method: "not measured",
        attributable: false,
      },
      stateHash: null,
      trust:
        mode === "SIMULATED"
          ? "Local simulation. No blockchain transaction."
          : "Gateway attestation; independent RPC and pinned receipt key required. Relayer and runtime administrator are trusted.",
    };
    if (!chain)
      return store.transaction(() => {
        if (intent.nonce !== store.nextNonce(id, intent.owner))
          throw new Error("Nonce already used or out of order");
        store.reserve(hash, intent, signature);
        store.apply(id, intent.owner, payload);
        base.stateHash = digest(store.rows(id));
        store.saveReceipt(hash, signer.sign(base));
        return store.get(hash);
      });
    if (intent.nonce !== (await chain.nextNonce(id, intent.owner)))
      throw new Error("Chain nonce already used or out of order");
    store.reserve(hash, intent, signature);
    let prepared: Awaited<ReturnType<Jungle["prepare"]>>;
    try {
      prepared = await chain.prepare(intent, payload, hash);
    } catch {
      store.rejectBeforeBroadcast(hash);
      throw new Error(
        "Transaction preparation failed before broadcast; check deployment, resources and relayer permission",
      );
    }
    base.transactionId = prepared.transactionId;
    try {
      base.ram.before = await chain.ram();
    } catch {
      /* Metering must not obscure execution status. */
    }
    store.transaction(() => {
      store.status(hash, "BROADCASTING", prepared);
      store.saveReceipt(hash, signer.sign(base));
    });
    try {
      const result = await chain.broadcast(prepared);
      base.blockNum = result.blockNum;
      base.status = "SUBMITTED";
      if (result.executionRamDelta !== null)
        base.ram.executionTrace = {
          payer: chain.relayer,
          delta: result.executionRamDelta,
          source: "send_transaction",
          transactionId: prepared.transactionId,
          independentlyVerified: false,
        };
      store.saveReceipt(hash, signer.sign(base));
    } catch {
      store.saveReceipt(hash, signer.sign(base));
      return store.get(hash);
    }
    try {
      base.ram.after = await chain.ram();
      // Independent calls can see different/lagging backends. Preserve samples,
      // but do not turn their difference into a transaction RAM measurement.
      base.ram.delta = null;
      base.ram.method =
        "non-atomic account samples; use executionTrace for submitting-RPC attribution when available";
    } catch {
      /* Separate measurement failure from execution. */
    }
    try {
      base.stateHash = digest(await chain.rows(id));
      if (await chain.finality(base.transactionId!, base.blockNum!))
        base.status = "IRREVERSIBLE";
    } catch {
      /* Finality remains pending. */
    }
    store.saveReceipt(hash, signer.sign(base));
    return store.get(hash);
  }
  server.post("/api/execute", async (req) => {
    const b = z
      .object({
        intent: z.unknown(),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      })
      .strict()
      .parse(req.body);
    return serial(() => execute(b.intent, b.signature as Hex));
  });
  server.post("/api/simulate", async (req) => {
    if (!demo) throw new Error("Simulation endpoint unavailable in live mode");
    const b = z
      .object({ appId: z.string(), payload: z.unknown() })
      .strict()
      .parse(req.body);
    return serial(async () => {
      const { intent } = await intentFor(
        store.app(b.appId),
        b.payload,
        demo.address,
        1,
      );
      const signature = await demo.signTypedData(typedData(intent));
      return execute(intent, signature);
    });
  });
  server.post("/api/reconcile", async (req) => {
    const { hash } = z.object({ hash: z.string() }).strict().parse(req.body);
    return serial(async () => {
      const record = store.get(hash);
      if (!record) throw new Error("Unknown submission");
      if (!chain || !record.receipt) return record;
      const receipt = record.receipt.receipt;
      if (!receipt.transactionId) return record;
      receipt.blockNum = await chain.inclusionBlock(
        receipt.transactionId,
        receipt.blockNum,
      );
      if (
        receipt.blockNum &&
        (await chain.finality(receipt.transactionId, receipt.blockNum))
      ) {
        receipt.status = "IRREVERSIBLE";
        receipt.issuedAt = new Date().toISOString();
      }
      store.saveReceipt(hash, signer.sign(receipt));
      return store.get(hash);
    });
  });
  server.get<{ Params: { hash: string } }>("/api/export/:hash", async (req) => {
    const row = store.get(req.params.hash);
    if (!row) throw new Error("Unknown submission");
    return {
      app: store.app(row.app),
      intent: row.intent,
      signature: row.signature,
      attestation: row.receipt,
      prepared: row.prepared ? JSON.parse(row.prepared) : null,
      deployment: {
        chainId: row.intent.destination,
        runtime: row.intent.runtime,
        codeHash: row.intent.runtimeCodeHash.slice(2),
        abiHash: chain?.abiHash ?? null,
        runtimeVersion: row.intent.runtimeVersion,
        policy: row.intent.policy,
        abiHashSigned: false,
      },
    };
  });
  server.addHook("onClose", async () => {
    authority?.close();
    store.close();
  });
  return { server, store, token, mode, port };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { server, mode, port } = await createServer();
  await server.listen({ host: "127.0.0.1", port });
  console.log(`VaultRAM gateway http://127.0.0.1:${port} · ${mode}`);
}
