import { randomUUID, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  PublicKey,
  PrivateKey,
  SignedTransaction,
  Transaction,
} from "@wharfkit/antelope";
import { z } from "zod";
import { compile, JUNGLE4 } from "../../../packages/core/src/index.ts";
import { assertNativeBlock } from "../../../packages/core/src/native-evidence.ts";
import {
  OnboardingInput,
  planOf,
  onboardingActions,
  onboardingActors,
  onboardingTransaction,
  type EnrollmentPlan,
} from "../../../packages/core/src/onboarding.ts";
import { AuthorityGateway } from "./authority.ts";
import { OwnerRevoke, singleOwnerKey } from "./owner-revoke.ts";

// Owner/allocator secrets never enter this class. Public signatures only.
export class OwnerOnboarding {
  private contexts = new Map<
    string,
    { gateway: AuthorityGateway; owner: OwnerRevoke }
  >();
  constructor(
    readonly g: AuthorityGateway,
    readonly directory: string,
  ) {
    g.db.exec("BEGIN IMMEDIATE");
    try {
      g.db.exec(
        "CREATE TABLE IF NOT EXISTS native_onboard_ops (id TEXT PRIMARY KEY, request TEXT NOT NULL, signed TEXT, status TEXT NOT NULL, evidence TEXT)",
      );
      for (const r of g.db
        .prepare("SELECT * FROM native_onboard_ops")
        .all() as any[]) {
        z.string().uuid().parse(r.id);
        if (
          !["PREPARED", "PENDING", "UNKNOWN", "IRREVERSIBLE"].includes(r.status)
        )
          throw Error("Onboarding journal status corrupt");
        if ((r.status === "PREPARED") !== (r.signed === null))
          throw Error("Onboarding journal signature/status corrupt");
        const request = JSON.parse(r.request);
        if (request.id !== r.id)
          throw Error("Onboarding journal identity mismatch");
        this.validate(
          request,
          r.status === "PREPARED" ? undefined : JSON.parse(r.signed),
        );
      }
      g.db.exec("PRAGMA user_version=3; COMMIT");
    } catch (e) {
      g.db.exec("ROLLBACK");
      throw e;
    }
  }
  private childDirectory(id: string) {
    return resolve(
      this.directory,
      "native-contexts",
      z.string().uuid().parse(id),
    );
  }
  private childConfig(request: any) {
    const p = planOf(request),
      app = compile(p.spec);
    return {
      ...this.g.c,
      grantId: p.grantId,
      space: "memory",
      appBinding: {
        appId: app.appId,
        appHash: app.appHash.slice(2),
        owner: p.owner,
      },
    };
  }
  row(id: string) {
    const r = this.g.db
      .prepare("SELECT * FROM native_onboard_ops WHERE id=?")
      .get(z.string().uuid().parse(id)) as any;
    if (!r) throw Error("Unknown onboarding request");
    return r;
  }
  list() {
    return (
      this.g.db
        .prepare(
          "SELECT id,request,status,evidence FROM native_onboard_ops ORDER BY rowid DESC LIMIT 50",
        )
        .all() as any[]
    ).map((r) => ({
      id: r.id,
      request: JSON.parse(r.request),
      status: r.status,
      evidence: r.evidence ? JSON.parse(r.evidence) : undefined,
    }));
  }
  private assertNoUnresolved() {
    if (
      this.g.db
        .prepare(
          "SELECT 1 FROM native_onboard_ops WHERE status IN ('PENDING','UNKNOWN')",
        )
        .get()
    )
      throw Error("Reconcile unresolved onboarding before issuing authority");
  }
  private async keys(p: EnrollmentPlan) {
    const keys = await Promise.all(
      onboardingActors(p).map(async (actor) => {
        const publicKey = singleOwnerKey(
          await this.g.rpc(this.g.c.independent, "get_account", {
            account_name: actor,
          }),
          actor,
        );
        if (
          PublicKey.from(publicKey).equals(
            PrivateKey.from(this.g.c.privateKey).toPublic(),
          )
        )
          throw Error("Owner/allocator key must differ from operational key");
        return { actor, publicKey };
      }),
    );
    if (new Set(keys.map((k) => k.publicKey)).size !== keys.length)
      throw Error("Distinct owner/allocator accounts must use distinct keys");
    return keys;
  }
  private async preflight(p: EnrollmentPlan, requireUnused: boolean) {
    this.g.assertWritable();
    await this.g.pins(this.g.c.independent);
    await this.g.permission(this.g.c.independent);
    const [roots, apps, grants] = await Promise.all(
      ["root", "apps", "grants"].map((t) => this.g.table(t)),
    );
    const root = roots[0],
      app = compile(p.spec);
    if (
      roots.length !== 1 ||
      root.principal !== p.allocator ||
      !["total", "available", "registered"].every(
        (k) =>
          Number.isSafeInteger(root[k]) && root[k] >= 0 && root[k] <= 10000,
      ) ||
      root.available > root.total ||
      root.registered > root.total
    )
      throw Error("Allocator/root state mismatch");
    if (
      requireUnused &&
      (root.available < p.budget ||
        root.registered >= root.total ||
        apps.some((a: any) => String(a.id) === app.appId) ||
        grants.some((g: any) => String(g.id) === p.grantId))
    )
      throw Error(
        "Insufficient test-write capacity or app/grant already exists; use a new app specification",
      );
    if (
      requireUnused &&
      (p.expires <= Math.floor(Date.now() / 1000) ||
        p.expires > Math.floor(Date.now() / 1000) + 168 * 3600)
    )
      throw Error("Grant expiry outside permitted test window");
    return this.keys(p);
  }
  validate(request: any, signed?: unknown) {
    const p = planOf(request),
      c = this.g.c;
    z.string().uuid().parse(request.id);
    if (
      p.contract !== c.account ||
      p.codeHash !== c.codeHash ||
      p.abiHash !== c.abiHash ||
      p.owner !== c.appBinding?.owner ||
      p.actor !== c.actor ||
      p.permission !== c.permission
    )
      throw Error("Onboarding deployment/owner/signer binding mismatch");
    const tx = onboardingTransaction(request);
    if (
      new Set(
        request.signers.map((s: any) => String(PublicKey.from(s.publicKey))),
      ).size !== request.signers.length
    )
      throw Error("Duplicate onboarding key");
    if (signed === undefined) return tx;
    const st = SignedTransaction.from(signed as any);
    if (
      JSON.stringify(st.transaction) !== JSON.stringify(tx) ||
      st.context_free_data.length ||
      st.signatures.length !== request.signers.length
    )
      throw Error("Onboarding signature/transaction mismatch");
    const actual = st.signatures
      .map((s) => String(s.recoverDigest(tx.signingDigest(JUNGLE4))))
      .sort();
    const expected = request.signers
      .map((s: any) => String(PublicKey.from(s.publicKey)))
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw Error("Both exact owner/allocator signatures are required");
    return st;
  }
  async prepare(input: unknown) {
    this.g.assertWritable();
    this.assertNoUnresolved();
    const b = OnboardingInput.parse(input);
    const root = (await this.g.table("root"))[0];
    if (!this.g.c.appBinding || !root)
      throw Error("Owner/app deployment required");
    const p: EnrollmentPlan = {
      version: 2,
      kind: "REGISTER_AND_GRANT",
      chainId: JUNGLE4,
      contract: this.g.c.account,
      codeHash: this.g.c.codeHash,
      abiHash: this.g.c.abiHash,
      owner: this.g.c.appBinding.owner,
      allocator: root.principal,
      actor: this.g.c.actor,
      permission: this.g.c.permission,
      spec: b.spec,
      grantId: (BigInt("0x" + randomBytes(6).toString("hex")) + 1n).toString(),
      budget: b.budget,
      maxPayload: b.maxPayload,
      expires: Math.floor(Date.now() / 1000) + b.hours * 3600,
    };
    const signers = await this.preflight(p, true);
    const info = await this.g.client.v1.chain.get_info();
    if (String(info.chain_id) !== JUNGLE4) throw Error("Wrong signing chain");
    const tx = Transaction.from({
      ...info.getTransactionHeader(120),
      actions: onboardingActions(p),
    });
    const request = {
      ...p,
      id: randomUUID(),
      signers,
      transactionId: String(tx.id),
      signingDigest: String(tx.signingDigest(JUNGLE4)),
      transaction: JSON.parse(JSON.stringify(tx)),
    };
    this.validate(request);
    // Initialize the child journal BEFORE any signed submission is possible.
    // Activation always opens existing mode: lost files are never regenerated.
    const child = new AuthorityGateway(
      this.childConfig(request),
      this.childDirectory(request.id),
      this.g.abiBytes,
      "create",
    );
    try {
      new OwnerRevoke(child);
    } finally {
      child.close();
    }
    this.g.db
      .prepare(
        "INSERT INTO native_onboard_ops(id,request,status) VALUES(?,?,'PREPARED')",
      )
      .run(request.id, JSON.stringify(request));
    return request;
  }
  async submit(id: string, signatures: unknown) {
    this.g.assertWritable();
    const row = this.row(id),
      request = JSON.parse(row.request);
    if (row.status !== "PREPARED") return this.reconcile(id);
    const sigs = z
      .array(z.string().regex(/^SIG_(K1|R1)_[1-9A-HJ-NP-Za-km-z]+$/))
      .min(1)
      .max(2)
      .parse(signatures);
    const signed = SignedTransaction.from({
      ...request.transaction,
      signatures: sigs,
    });
    this.validate(request, signed);
    const remaining = Date.parse(String(signed.expiration) + "Z") - Date.now();
    if (remaining <= 0 || remaining > 125000)
      throw Error("Onboarding request expired");
    this.assertNoUnresolved();
    if (
      JSON.stringify(await this.preflight(planOf(request), true)) !==
      JSON.stringify(request.signers)
    )
      throw Error("Owner/allocator authority changed; prepare again");
    // Check the durable child exists before the one submission.
    const child = this.openChild(request);
    child.gateway.assertWritable();
    if (
      this.g.db
        .prepare(
          "UPDATE native_onboard_ops SET signed=?,status='PENDING' WHERE id=? AND status='PREPARED' AND NOT EXISTS(SELECT 1 FROM native_onboard_ops WHERE status IN ('PENDING','UNKNOWN'))",
        )
        .run(JSON.stringify(signed), id).changes !== 1
    )
      throw Error("Onboarding already submitted or unresolved");
    try {
      await this.g.client.v1.chain.send_transaction(signed);
    } catch {
      this.g.db
        .prepare("UPDATE native_onboard_ops SET status='UNKNOWN' WHERE id=?")
        .run(id);
    }
    return this.reconcile(id);
  }
  async reconcile(id: string) {
    const row = this.row(id),
      request = JSON.parse(row.request),
      p = planOf(request),
      app = compile(p.spec);
    if (row.status === "PREPARED") return { id, status: "PREPARED" };
    try {
      this.validate(request, JSON.parse(row.signed));
      const info = await this.g.pins(this.g.c.independent);
      // Re-fetch known finalized blocks rather than depending on status-cache retention.
      // Stored evidence supplies a locator only; inclusion/LIB/state are checked anew.
      const recorded =
        row.status === "IRREVERSIBLE" && row.evidence
          ? JSON.parse(row.evidence)
          : undefined;
      const status = recorded
        ? {
            state: "IRREVERSIBLE",
            block_number: recorded.block,
            block_id: recorded.blockId,
          }
        : await this.g.rpc(this.g.c.independent, "get_transaction_status", {
            id: request.transactionId,
          });
      if (status.state !== "IRREVERSIBLE")
        throw Error("Onboarding finality unknown");
      const block = await this.g.rpc(this.g.c.independent, "get_block", {
        block_num_or_id: status.block_number,
      });
      assertNativeBlock(
        block,
        Number(status.block_number),
        request.transactionId,
        info.last_irreversible_block_num,
        status.block_id,
      );
      const a = (await this.g.table("apps")).find(
        (r: any) => String(r.id) === app.appId,
      );
      const grant = (await this.g.table("grants")).find(
        (r: any) => String(r.id) === p.grantId,
      );
      if (
        !a ||
        a.owner !== p.owner ||
        a.app_hash !== app.appHash.slice(2) ||
        !grant ||
        String(grant.app_id) !== app.appId ||
        grant.owner !== p.owner ||
        grant.actor !== p.actor ||
        grant.actor_permission !== p.permission ||
        grant.space !== "memory" ||
        grant.budget !== p.budget ||
        grant.expires !== p.expires ||
        grant.max_payload !== p.maxPayload
      )
        throw Error("Onboarding resulting state mismatch");
      const evidence = {
        request,
        signedTransaction: JSON.parse(row.signed),
        block: status.block_number,
        blockId: block.id,
        app: a,
        grant,
        trust: "IRREVERSIBLE_INCLUSION_AND_CURRENT_STATE_VIA_TRUSTED_RPC",
      };
      this.g.db
        .prepare(
          "UPDATE native_onboard_ops SET status='IRREVERSIBLE',evidence=? WHERE id=?",
        )
        .run(JSON.stringify(evidence), id);
      return { id, status: "IRREVERSIBLE", evidence };
    } catch {
      this.g.db
        .prepare(
          "UPDATE native_onboard_ops SET status='UNKNOWN' WHERE id=? AND status!='IRREVERSIBLE'",
        )
        .run(id);
      return { id, status: this.row(id).status, verificationUnavailable: true };
    }
  }
  private openChild(request: any) {
    let child = this.contexts.get(request.id);
    if (!child) {
      const gateway = new AuthorityGateway(
        this.childConfig(request),
        this.childDirectory(request.id),
        this.g.abiBytes,
      );
      child = { gateway, owner: new OwnerRevoke(gateway) };
      this.contexts.set(request.id, child);
    }
    return child;
  }
  async context(id: string) {
    this.g.assertWritable();
    const result = await this.reconcile(id);
    if (result.status !== "IRREVERSIBLE" || result.verificationUnavailable)
      throw Error(
        "Fresh verified onboarding required before selecting this app",
      );
    const request = JSON.parse(this.row(id).request);
    const child = this.openChild(request);
    child.gateway.assertWritable();
    return { ...child, app: compile(request.spec) };
  }
  close() {
    for (const c of this.contexts.values()) c.gateway.close();
    this.contexts.clear();
  }
}
