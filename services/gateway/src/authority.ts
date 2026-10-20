import {
  ABI,
  Action,
  APIClient,
  FetchProvider,
  Transaction,
  SignedTransaction,
  PrivateKey,
  PublicKey,
  Serializer,
} from "@wharfkit/antelope";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { z } from "zod";
import { JUNGLE4 } from "../../../packages/core/src/index.ts";
import {
  assertNativeBlock,
  assertNativeEffect,
} from "../../../packages/core/src/native-evidence.ts";
import {
  AppBinding,
  NativeAppId,
  assertAppBinding,
  assertAppEffect,
  assertCompiledApp,
  type AppAuthorityBinding,
} from "../../../packages/core/src/app-authority.ts";
import { nativeExecutionRam } from "./chain.ts";
import {
  AuthorityRequirement,
  assertAuthorityRequirement,
  authorityManifest,
} from "../../../packages/core/src/authority-manifest.ts";
const name = z.string().regex(/^[a-z1-5.]{1,12}$/);
const pin = z.string().regex(/^[a-f0-9]{64}$/);
export const AuthorityConfig = z
  .object({
    appBinding: AppBinding.optional(),
    account: name,
    actor: name,
    permission: name.refine((x) => !["active", "owner"].includes(x)),
    grantId: z.string().regex(/^[1-9][0-9]{0,15}$/),
    space: name,
    privateKey: z.string(),
    codeHash: pin,
    abiHash: pin,
    abiJsonHash: pin,
    rpc: z.literal("https://jungle4.greymass.com"),
    independent: z.literal("https://jungle4.cryptolions.io"),
  })
  .strict();
export type AuthoritySettings = z.infer<typeof AuthorityConfig>;
const sha = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
export const NativeWrite = z
  .object({
    appId: NativeAppId,
    text: z.string().min(1).max(256),
    requirement: AuthorityRequirement.default("NATIVE_TESTNET_PROOF"),
  })
  .strict();
export function nativePayload(input: unknown, binding?: AppAuthorityBinding) {
  const b = NativeWrite.parse(input);
  assertAuthorityRequirement(b.requirement);
  if (binding && b.appId !== binding.appId)
    throw Error("Native app outside grant");
  const payload = JSON.stringify({
    ...(binding ? {} : { appId: b.appId }),
    kind: "memory",
    text: b.text,
  });
  if (Buffer.byteLength(payload) > 256)
    throw Error(
      "Public record exceeds 256 UTF-8 bytes including its application binding",
    );
  return payload;
}
export function assertGrant(
  g: any,
  c: Pick<AuthoritySettings, "actor" | "space" | "grantId">,
  now: number,
) {
  if (
    !g ||
    String(g.id) !== c.grantId ||
    g.actor !== c.actor ||
    g.space !== c.space
  )
    throw Error("Native grant binding mismatch");
  if (
    ![false, true, 0, 1].includes(g.revoked) ||
    ![g.expires, g.available, g.max_payload].every(
      (x) =>
        (typeof x === "number" ||
          (typeof x === "string" && /^[0-9]+$/.test(x))) &&
        Number.isSafeInteger(Number(x)) &&
        Number(x) >= 0,
    ) ||
    Number(g.available) > 10000 ||
    Number(g.max_payload) < 1 ||
    Number(g.max_payload) > 256
  )
    throw Error("Malformed native grant");
  if (g.revoked) throw Error("Native grant revoked");
  if (Number(g.expires) <= now) throw Error("Native grant expired");
  if (Number(g.available) < 1) throw Error("Native grant exhausted");
}
export class AuthorityGateway {
  readonly db: DatabaseSync;
  readonly abi: ABI;
  readonly c: AuthoritySettings;
  readonly client: APIClient;
  constructor(
    config: AuthoritySettings,
    directory: string,
    readonly abiBytes: Uint8Array = readFileSync(
      `contracts/build/${config.appBinding ? "owner-app" : "authority"}/authority.abi`,
    ),
    journalMode: "existing" | "create" | "recovery" = "existing",
  ) {
    this.c = AuthorityConfig.parse(config);
    if (sha(abiBytes) !== this.c.abiJsonHash)
      throw Error("Local authority ABI pin mismatch");
    this.abi = ABI.from(JSON.parse(Buffer.from(abiBytes).toString()));
    if (sha(Serializer.encode({ object: this.abi }).array) !== this.c.abiHash)
      throw Error("Serialized authority ABI pin mismatch");
    const exists = existsSync(directory + "/authority.sqlite");
    if (journalMode === "existing" && !exists)
      throw Error(
        "Native journal missing: restore a verified backup; never silently recreate live history",
      );
    if (journalMode !== "existing" && exists)
      throw Error("Native journal already exists; use existing mode");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(directory + "/authority.sqlite");
    try {
      if (
        (this.db.prepare("PRAGMA quick_check").get() as any)?.quick_check !==
        "ok"
      )
        throw Error("Native journal integrity check failed");
      if (
        journalMode === "existing" &&
        !this.db
          .prepare("SELECT fingerprint FROM native_domain WHERE id=1")
          .get()
      )
        throw Error("Native journal identity missing");
      if (journalMode === "existing") {
        const version = Number(
          (this.db.prepare("PRAGMA user_version").get() as any).user_version,
        );
        if (![0, 1, 2, 3].includes(version))
          throw Error("Unsupported journal version");
        for (const table of [
          "native_domain",
          "native_ops",
          "native_ram",
          ...(version >= 1 ? ["native_safety"] : []),
          ...(version >= 2 ? ["native_owner_ops"] : []),
          ...(version >= 3 ? ["native_onboard_ops"] : []),
        ])
          if (
            !this.db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
              )
              .get(table)
          )
            throw Error("Journal table missing");
      }
    } catch {
      this.db.close();
      throw Error(
        "Native journal corrupt or incomplete: restore a verified backup",
      );
    }
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS native_ops (id TEXT PRIMARY KEY,payload TEXT NOT NULL,rid TEXT NOT NULL UNIQUE,txid TEXT NOT NULL UNIQUE,transaction_json TEXT NOT NULL,status TEXT NOT NULL,evidence TEXT,error TEXT)",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS native_domain (id INTEGER PRIMARY KEY CHECK(id=1),fingerprint TEXT NOT NULL)",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS native_ram (txid TEXT PRIMARY KEY, observation TEXT NOT NULL)",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS native_safety (id INTEGER PRIMARY KEY CHECK(id=1), recovery_locked INTEGER NOT NULL)",
    );
    if (journalMode === "recovery")
      this.db
        .prepare("INSERT INTO native_safety(id,recovery_locked) VALUES(1,1)")
        .run();
    if (
      Number(
        (this.db.prepare("PRAGMA user_version").get() as any).user_version,
      ) === 0
    )
      this.db.exec("PRAGMA user_version=1");
    const fingerprint = sha(
      JSON.stringify({
        ...this.publicConfig(),
        publicKey: String(PrivateKey.from(this.c.privateKey).toPublic()),
      }),
    );
    const previous = this.db
      .prepare("SELECT fingerprint FROM native_domain WHERE id=1")
      .get() as any;
    if (
      previous?.fingerprint !== fingerprint &&
      (previous || this.db.prepare("SELECT 1 FROM native_ops LIMIT 1").get())
    ) {
      this.db.close();
      throw Error(
        "Native journal configuration mismatch; use a separate data directory",
      );
    }
    if (!previous)
      this.db
        .prepare("INSERT INTO native_domain(id,fingerprint) VALUES(1,?)")
        .run(fingerprint);
    this.client = new APIClient({
      provider: new FetchProvider(this.c.rpc, {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      }),
    });
    try {
      for (const row of this.db
        .prepare("SELECT * FROM native_ops")
        .all() as any[]) {
        if (
          !["PREPARED", "PENDING", "UNKNOWN", "IRREVERSIBLE"].includes(
            row.status,
          )
        )
          throw Error("Invalid journal status");
        this.boundTransaction(row);
      }
      this.db.exec("COMMIT");
    } catch {
      this.db.close();
      throw Error(
        "Native journal record binding corrupt; restore a verified backup",
      );
    }
  }
  assertWritable() {
    if (
      this.db
        .prepare("SELECT 1 FROM native_safety WHERE recovery_locked=1")
        .get()
    )
      throw Error(
        "Recovery journal is read-only for submission; completeness must be reviewed before any new authority is issued",
      );
  }
  async restoreExport(e: any) {
    // Exports can reconstruct evidence, never establish completeness of lost history.
    if (
      JSON.stringify(e.configuration) !== JSON.stringify(this.publicConfig()) ||
      (e.version === 2) !== !!this.c.appBinding ||
      ![1, 2].includes(e.version)
    )
      throw Error("Recovery export domain mismatch");
    const o = e.operation;
    const row = {
      id: z.string().uuid().parse(o?.id),
      rid: z
        .string()
        .regex(/^[1-9][0-9]*$/)
        .parse(o?.reservationId),
      txid: o.transactionId,
      payload: z.string().max(256).parse(o?.payload),
      transaction_json: JSON.stringify(o.transaction),
    };
    this.boundTransaction(row);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO native_safety(id,recovery_locked) VALUES(1,1)",
        )
        .run();
      const old = this.db
        .prepare("SELECT * FROM native_ops WHERE id=?")
        .get(row.id) as any;
      if (
        old &&
        (old.txid !== row.txid ||
          old.transaction_json !== row.transaction_json ||
          old.payload !== row.payload ||
          old.rid !== row.rid)
      )
        throw Error("Recovery collision");
      if (!old)
        this.db
          .prepare(
            "INSERT INTO native_ops(id,payload,rid,txid,transaction_json,status) VALUES(?,?,?,?,?,'UNKNOWN')",
          )
          .run(row.id, row.payload, row.rid, row.txid, row.transaction_json);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.reconcile(row.id);
  }
  close() {
    this.db.close();
  }
  async rpc(endpoint: string, method: string, body: object = {}) {
    const r = await fetch(endpoint + "/v1/chain/" + method, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw Error("Authority RPC " + method + " failed (" + r.status + ")");
    return r.json();
  }
  async pins(endpoint: string) {
    const c = this.c;
    const info = await this.rpc(endpoint, "get_info");
    if (info.chain_id !== JUNGLE4) throw Error("Wrong authority chain");
    const code = await this.rpc(endpoint, "get_code_hash", {
      account_name: c.account,
    });
    if (code.code_hash !== c.codeHash)
      throw Error("Authority code pin mismatch");
    const a = await this.rpc(endpoint, "get_raw_abi", {
      account_name: c.account,
    });
    if (a.abi_hash !== c.abiHash) throw Error("Authority ABI pin mismatch");
    return info;
  }
  async permission(endpoint: string = this.c.rpc) {
    const c = this.c,
      account = await this.rpc(endpoint, "get_account", {
        account_name: c.actor,
      });
    if (
      account?.account_name !== c.actor ||
      !Array.isArray(account.permissions) ||
      account.permissions.length < 1 ||
      account.permissions.length > 1000 ||
      account.permissions.some(
        (q: any) =>
          !q ||
          typeof q.perm_name !== "string" ||
          !q.perm_name ||
          typeof q.parent !== "string" ||
          q.parent === q.perm_name ||
          !q.required_auth ||
          !Array.isArray(q.required_auth.keys) ||
          !Array.isArray(q.required_auth.accounts) ||
          !Array.isArray(q.required_auth.waits),
      ) ||
      new Set(account.permissions.map((q: any) => q.perm_name)).size !==
        account.permissions.length
    )
      throw Error("Malformed native permission account");
    // Parent authority can satisfy its children, even with unrelated child keys.
    // Exact direct action links are therefore insufficient: the signer must be a leaf.
    if (account.permissions.some((q: any) => q.parent === c.permission))
      throw Error("Restricted native permission must have no children");
    const p = account.permissions.find(
        (p: any) => p.perm_name === c.permission,
      ),
      a = p?.required_auth;
    const pub = PrivateKey.from(c.privateKey).toPublic();
    if (
      p?.parent !== "active" ||
      a?.threshold !== 1 ||
      a.keys?.length !== 1 ||
      a.keys[0].weight !== 1 ||
      a.accounts?.length ||
      a.waits?.length ||
      !PublicKey.from(a.keys[0].key).equals(pub)
    )
      throw Error("Restricted native permission mismatch");
    if (
      account.permissions.some((q: any) =>
        q.required_auth.accounts?.some(
          (entry: any) =>
            entry.permission?.actor === c.actor &&
            entry.permission?.permission === c.permission,
        ),
      )
    )
      throw Error("Agent permission referenced by another authority");
    const links = p.linked_actions;
    if (
      !Array.isArray(links) ||
      links.length !== 2 ||
      !["reserve", "consume"].every((action) =>
        links.some((l: any) => l.account === c.account && l.action === action),
      )
    )
      throw Error("Native permission links mismatch");
    if (
      account.permissions.some(
        (q: any) =>
          q.perm_name !== c.permission &&
          q.required_auth.keys.some((k: any) =>
            PublicKey.from(k.key).equals(pub),
          ),
      )
    )
      throw Error("Agent key reused in another permission");
  }
  async operationalChecks() {
    await Promise.all([
      this.pins(this.c.rpc),
      this.pins(this.c.independent),
      this.permission(this.c.rpc),
      this.permission(this.c.independent),
    ]);
  }
  async table(table: string, endpoint: string = this.c.independent) {
    const r = await this.rpc(endpoint, "get_table_rows", {
      json: true,
      code: this.c.account,
      scope: this.c.account,
      table,
      limit: 10001,
    });
    if (r.more || !Array.isArray(r.rows))
      throw Error("Incomplete authority table");
    return r.rows;
  }
  publicConfig() {
    const { privateKey, ...c } = this.c;
    return {
      ...c,
      chainId: JUNGLE4,
      signer: "LOCAL_RESTRICTED_NATIVE_KEY",
      trust:
        "Local operator controls agent signing. Native contract enforces grant limits. Upgrade administrator and chain remain trusted.",
    };
  }
  assertApp(app: { appId: string; appHash: string }) {
    if (this.c.appBinding) assertCompiledApp(app, this.c.appBinding);
  }
  async appBinding(grant: any, endpoint: string = this.c.independent) {
    if (!this.c.appBinding) return undefined;
    const app = (await this.table("apps", endpoint)).find(
      (a: any) => String(a.id) === this.c.appBinding!.appId,
    );
    assertAppBinding(
      app,
      grant,
      this.c.appBinding,
      this.c.actor,
      this.c.permission,
    );
    return app;
  }
  async state() {
    await this.pins(this.c.independent);
    await this.permission(this.c.independent);
    const [root, grants, effects] = await Promise.all(
      ["root", "grants", "effects"].map((t) => this.table(t)),
    );
    if (root.length !== 1) throw Error("Authority root absent");
    const total =
      BigInt(root[0].available) +
      grants.reduce(
        (n: bigint, g: any) =>
          n +
          ["available", "reserved", "quarantined", "consumed"].reduce(
            (s, k) => s + BigInt(g[k]),
            0n,
          ),
        0n,
      );
    if (
      total !== BigInt(root[0].total) ||
      grants.some(
        (g: any) =>
          ["available", "reserved", "quarantined", "consumed"].reduce(
            (n, k) => n + BigInt(g[k]),
            0n,
          ) !== BigInt(g.budget),
      )
    )
      throw Error("Authority conservation mismatch");
    const grant = grants.find((g: any) => String(g.id) === this.c.grantId);
    const app = await this.appBinding(grant);
    return {
      configuration: this.publicConfig(),
      app,
      manifest: this.c.appBinding
        ? authorityManifest(app, grant, {
            ...this.c,
            appBinding: this.c.appBinding,
          })
        : undefined,
      root: root[0],
      grant,
      effects: effects.filter(
        (e: any) => String(e.grant_id) === this.c.grantId,
      ),
      operations: this.list(),
    };
  }
  list() {
    return (
      this.db
        .prepare(
          "SELECT id,status,txid,error,evidence FROM native_ops ORDER BY rowid DESC LIMIT 100",
        )
        .all() as any[]
    ).map((r) => ({
      ...r,
      evidence: r.evidence ? JSON.parse(r.evidence) : null,
    }));
  }
  row(id: string) {
    const row = this.db
      .prepare("SELECT * FROM native_ops WHERE id=?")
      .get(id) as any;
    if (!row) throw Error("Unknown native operation");
    return row;
  }
  async prepare(input: unknown) {
    this.assertWritable();
    const payload = nativePayload(input, this.c.appBinding);
    if (
      this.db
        .prepare(
          "SELECT 1 FROM native_ops WHERE status IN ('PENDING','UNKNOWN') LIMIT 1",
        )
        .get()
    )
      throw Error("Reconcile unresolved native operation first");
    await this.operationalChecks();
    const grants = await this.table("grants", this.c.rpc),
      grant = grants.find((g: any) => String(g.id) === this.c.grantId);
    assertGrant(grant, this.c, Math.floor(Date.now() / 1000));
    const app = await this.appBinding(grant, this.c.rpc);
    const manifest = this.c.appBinding
      ? authorityManifest(app, grant, {
          ...this.c,
          appBinding: this.c.appBinding,
        })
      : undefined;
    if (Buffer.byteLength(payload) > Number(grant.max_payload))
      throw Error("Payload exceeds native grant limit");
    const rid = BigInt("0x" + randomBytes(6).toString("hex")).toString();
    if (rid === "0") throw Error("Retry preparation");
    const c = this.c;
    const data = {
      ...(c.appBinding ? { app_id: c.appBinding.appId } : {}),
      grant_id: c.grantId,
      id: rid,
      space: c.space,
      obligation: rid,
      nullifier: rid,
      effect_id: rid,
      payload_hash: sha(payload),
    };
    const make = (name: string, data: object) =>
      Action.from(
        {
          account: c.account,
          name,
          data,
          authorization: [{ actor: c.actor, permission: c.permission }],
        },
        this.abi,
      );
    const head = await this.client.v1.chain.get_info();
    if (String(head.chain_id) !== JUNGLE4)
      throw Error("Wrong authority signing chain");
    const tx = Transaction.from({
      ...head.getTransactionHeader(120),
      actions: [make("reserve", data), make("consume", { id: rid, payload })],
    });
    const signed = SignedTransaction.from({
      ...tx,
      signatures: [
        PrivateKey.from(c.privateKey).signDigest(tx.signingDigest(JUNGLE4)),
      ],
    });
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO native_ops(id,payload,rid,txid,transaction_json,status) VALUES(?,?,?,?,?,?)",
      )
      .run(id, payload, rid, String(tx.id), JSON.stringify(signed), "PREPARED");
    return {
      id,
      payload,
      payloadHash: sha(payload),
      reservationId: rid,
      transactionId: String(tx.id),
      expires: String(tx.expiration),
      manifest,
      configuration: this.publicConfig(),
      grant,
    };
  }
  boundTransaction(row: any) {
    const tx = SignedTransaction.from(JSON.parse(row.transaction_json)),
      c = this.c;
    const make = (name: string, data: object) =>
      Action.from(
        {
          account: c.account,
          name,
          data,
          authorization: [{ actor: c.actor, permission: c.permission }],
        },
        this.abi,
      );
    const expected = [
      make("reserve", {
        ...(c.appBinding ? { app_id: c.appBinding.appId } : {}),
        grant_id: c.grantId,
        id: row.rid,
        space: c.space,
        obligation: row.rid,
        nullifier: row.rid,
        effect_id: row.rid,
        payload_hash: sha(row.payload),
      }),
      make("consume", { id: row.rid, payload: row.payload }),
    ];
    if (
      String(tx.id) !== row.txid ||
      JSON.stringify(tx.actions) !== JSON.stringify(expected) ||
      tx.context_free_actions.length ||
      tx.transaction_extensions.length ||
      tx.signatures.length !== 1 ||
      !tx.signatures[0]
        .recoverDigest(tx.transaction.signingDigest(JUNGLE4))
        .equals(PrivateKey.from(c.privateKey).toPublic())
    )
      throw Error("Stored native transaction binding mismatch");
    return tx;
  }
  async submit(id: string, payloadHash: string) {
    const row = this.row(id);
    if (sha(row.payload) !== payloadHash)
      throw Error("Reviewed payload mismatch");
    if (row.status !== "PREPARED") return this.reconcile(id);
    this.assertWritable();
    if (
      this.db
        .prepare(
          "SELECT 1 FROM native_ops WHERE status IN ('PENDING','UNKNOWN') LIMIT 1",
        )
        .get()
    )
      throw Error("Reconcile unresolved native operation first");
    const tx = this.boundTransaction(row);
    if (Date.parse(String(tx.expiration) + "Z") <= Date.now())
      throw Error("Native review expired; prepare a new operation");
    await this.operationalChecks();
    if (this.c.appBinding) {
      const grant = (await this.table("grants", this.c.rpc)).find(
        (g: any) => String(g.id) === this.c.grantId,
      );
      assertGrant(grant, this.c, Math.floor(Date.now() / 1000));
      await this.appBinding(grant, this.c.rpc);
    }
    if (
      this.db
        .prepare(
          "UPDATE native_ops SET status='PENDING' WHERE id=? AND status='PREPARED' AND NOT EXISTS (SELECT 1 FROM native_ops WHERE status IN ('PENDING','UNKNOWN'))",
        )
        .run(id).changes !== 1
    ) {
      if (this.row(id).status === "PREPARED")
        throw Error("Reconcile unresolved native operation first");
      return this.reconcile(id);
    }
    // Persist before broadcast. Never automatically rebroadcast after an ambiguous result.
    try {
      const response = JSON.parse(
        JSON.stringify(await this.client.v1.chain.send_transaction(tx)),
      );
      const ram = {
        transactionId: row.txid,
        payer: this.c.account,
        bytes: nativeExecutionRam(response, row.txid, this.c.account),
        payloadBytes: Buffer.byteLength(row.payload),
        source: "SUBMITTING_RPC_EXECUTION_TRACE",
        independentlyVerified: false,
        observedAt: new Date().toISOString(),
      };
      this.db
        .prepare("INSERT INTO native_ram(txid,observation) VALUES(?,?)")
        .run(row.txid, JSON.stringify(ram));
    } catch {
      this.db
        .prepare(
          "UPDATE native_ops SET status='UNKNOWN',error='Submission outcome uncertain; reconcile without resubmitting' WHERE id=?",
        )
        .run(id);
    }
    return this.reconcile(id);
  }
  async reconcile(id: string) {
    const row = this.row(id);
    if (row.status === "PREPARED")
      return { id, status: row.status, transactionId: row.txid };
    try {
      const info = await this.pins(this.c.independent);
      const s = await this.rpc(this.c.independent, "get_transaction_status", {
        id: row.txid,
      });
      if (s.state !== "IRREVERSIBLE")
        return {
          id,
          status: row.status,
          transactionId: row.txid,
          observedChainStatus: s.state,
          verificationUnavailable: row.status === "IRREVERSIBLE",
          evidence: row.evidence ? JSON.parse(row.evidence) : null,
        };
      const n = Number(s.block_number);
      if (
        !Number.isSafeInteger(n) ||
        n < 1 ||
        !Number.isSafeInteger(info.last_irreversible_block_num) ||
        n > info.last_irreversible_block_num
      )
        throw Error("Authority block not irreversible");
      const b = await this.rpc(this.c.independent, "get_block", {
        block_num_or_id: n,
      });
      assertNativeBlock(
        b,
        n,
        row.txid,
        info.last_irreversible_block_num,
        s.block_id,
      );
      const tx = this.boundTransaction(row);
      if (String(tx.id) !== row.txid)
        throw Error("Stored transaction digest mismatch");
      const [effects, reservations, grants] = await Promise.all(
        ["effects", "reservations", "grants"].map((t) => this.table(t)),
      );
      const effect = effects.find((r: any) => String(r.id) === row.rid),
        reservation = reservations.find((r: any) => String(r.id) === row.rid),
        grant = grants.find((r: any) => String(r.id) === this.c.grantId);
      assertNativeEffect(
        effect,
        reservation,
        this.c,
        row.rid,
        row.payload,
        sha(row.payload),
      );
      const app = await this.appBinding(grant);
      if (this.c.appBinding)
        assertAppEffect(effect, this.c.appBinding, this.c.permission);
      const evidence = {
        version: this.c.appBinding ? 2 : 1,
        ...(app ? { app } : {}),
        ram: (() => {
          const sample = this.db
            .prepare("SELECT observation FROM native_ram WHERE txid=?")
            .get(row.txid) as any;
          return sample
            ? JSON.parse(sample.observation)
            : {
                bytes: null,
                transactionId: row.txid,
                payer: this.c.account,
                payloadBytes: Buffer.byteLength(row.payload),
                source: "UNAVAILABLE",
                independentlyVerified: false,
              };
        })(),
        configuration: this.publicConfig(),
        operation: {
          id,
          payload: row.payload,
          reservationId: row.rid,
          transactionId: row.txid,
          transaction: JSON.parse(row.transaction_json),
        },
        block: n,
        blockId: b.id,
        effect,
        reservation,
        grant,
        verifiedAt: new Date().toISOString(),
        verification: "IRREVERSIBLE_INCLUSION_AND_EFFECT_VIA_INDEPENDENT_RPC",
      };
      this.db
        .prepare(
          "UPDATE native_ops SET status='IRREVERSIBLE',evidence=?,error=NULL WHERE id=?",
        )
        .run(JSON.stringify(evidence), id);
      return { id, status: "IRREVERSIBLE", transactionId: row.txid, evidence };
    } catch {
      if (row.status !== "IRREVERSIBLE")
        this.db
          .prepare(
            "UPDATE native_ops SET status='UNKNOWN',error='Independent verification unavailable; reconcile without resubmitting' WHERE id=?",
          )
          .run(id);
      return {
        id,
        status: row.status === "IRREVERSIBLE" ? "IRREVERSIBLE" : "UNKNOWN",
        transactionId: row.txid,
        evidence: row.evidence ? JSON.parse(row.evidence) : null,
        verificationUnavailable: true,
      };
    }
  }
}
