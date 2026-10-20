import {
  Action,
  Transaction,
  SignedTransaction,
  PublicKey,
  PrivateKey,
} from "@wharfkit/antelope";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { JUNGLE4 } from "../../../packages/core/src/index.ts";
import { assertNativeBlock } from "../../../packages/core/src/native-evidence.ts";
import type { AuthorityGateway } from "./authority.ts";

// This path never signs, loads owner secrets, or accepts arbitrary wallet actions.
// Only single-key active authority is supported; multisig/delegation fail closed.
export function singleOwnerKey(account: any, owner: string) {
  const p = account?.permissions?.find((p: any) => p.perm_name === "active");
  const a = p?.required_auth;
  if (
    account?.account_name !== owner ||
    p?.parent !== "owner" ||
    a?.threshold !== 1 ||
    a?.keys?.length !== 1 ||
    a.keys[0].weight !== 1 ||
    !Array.isArray(a.accounts) ||
    a.accounts.length ||
    !Array.isArray(a.waits) ||
    a.waits.length
  )
    throw Error(
      "External owner signing requires simple 1-of-1 active authority; delegated/multisig authority unsupported",
    );
  return String(PublicKey.from(a.keys[0].key));
}
export class OwnerRevoke {
  constructor(readonly g: AuthorityGateway) {
    g.db.exec("BEGIN IMMEDIATE");
    try {
      g.db.exec(
        "CREATE TABLE IF NOT EXISTS native_owner_ops (id TEXT PRIMARY KEY, request TEXT NOT NULL, signed TEXT, status TEXT NOT NULL, evidence TEXT)",
      );
      for (const row of g.db
        .prepare("SELECT * FROM native_owner_ops")
        .all() as any[]) {
        if (
          !["PREPARED", "PENDING", "UNKNOWN", "IRREVERSIBLE"].includes(
            row.status,
          )
        )
          throw Error("Owner journal status corrupt");
        if ((row.status === "PREPARED") !== (row.signed === null))
          throw Error("Owner journal signature/status corrupt");
        this.validate(
          JSON.parse(row.request),
          row.status === "PREPARED" ? undefined : JSON.parse(row.signed),
        );
      }
      const version = Number(
        (g.db.prepare("PRAGMA user_version").get() as any).user_version,
      );
      g.db.exec(`PRAGMA user_version=${Math.max(version, 2)}; COMMIT`);
    } catch (e) {
      g.db.exec("ROLLBACK");
      throw e;
    }
  }
  async key() {
    const owner = this.g.c.appBinding?.owner;
    if (!owner) throw Error("Native owner/app v2 required");
    const key = singleOwnerKey(
      await this.g.rpc(this.g.c.independent, "get_account", {
        account_name: owner,
      }),
      owner,
    );
    if (
      PublicKey.from(key).equals(
        PrivateKey.from(this.g.c.privateKey).toPublic(),
      )
    )
      throw Error("Owner key must differ from the gateway operational key");
    return key;
  }
  async grant() {
    await this.g.pins(this.g.c.independent);
    const grant = (await this.g.table("grants")).find(
      (g: any) => String(g.id) === this.g.c.grantId,
    );
    await this.g.appBinding(grant);
    if (!grant || ![false, true, 0, 1].includes(grant.revoked))
      throw Error("Owner grant absent or malformed");
    return grant;
  }
  row(id: string) {
    const r = this.g.db
      .prepare("SELECT * FROM native_owner_ops WHERE id=?")
      .get(z.string().uuid().parse(id)) as any;
    if (!r) throw Error("Unknown owner request");
    return r;
  }
  list() {
    return this.g.db
      .prepare(
        "SELECT id,status,evidence FROM native_owner_ops ORDER BY rowid DESC LIMIT 20",
      )
      .all();
  }
  action() {
    const c = this.g.c;
    if (!c.appBinding) throw Error("Native owner/app v2 required");
    return Action.from(
      {
        account: c.account,
        name: "revoke",
        authorization: [{ actor: c.appBinding.owner, permission: "active" }],
        data: { grant_id: c.grantId },
      },
      this.g.abi,
    );
  }
  validate(request: any, signed?: unknown) {
    const tx = Transaction.from(request.transaction);
    const c = this.g.c;
    if (
      request.chainId !== JUNGLE4 ||
      request.contract !== c.account ||
      request.codeHash !== c.codeHash ||
      request.owner !== c.appBinding?.owner ||
      request.grantId !== c.grantId ||
      JSON.stringify(request.app) !== JSON.stringify(c.appBinding) ||
      request.transactionId !== String(tx.id) ||
      request.signingDigest !== String(tx.signingDigest(JUNGLE4)) ||
      JSON.stringify(tx.actions) !== JSON.stringify([this.action()]) ||
      tx.context_free_actions.length ||
      tx.transaction_extensions.length ||
      Number(tx.delay_sec) !== 0
    )
      throw Error("External owner request binding mismatch");
    if (signed === undefined) return tx;
    const st = SignedTransaction.from(signed as any);
    if (
      JSON.stringify(st.transaction) !== JSON.stringify(tx) ||
      st.signatures.length !== 1 ||
      !st.signatures[0]
        .recoverDigest(tx.signingDigest(JUNGLE4))
        .equals(PublicKey.from(request.publicKey))
    )
      throw Error("External owner signature/transaction mismatch");
    return st;
  }
  async prepare() {
    const grant = await this.grant();
    if (grant.revoked) throw Error("Owner grant absent or already revoked");
    if (
      this.g.db
        .prepare(
          "SELECT 1 FROM native_owner_ops WHERE status IN ('PENDING','UNKNOWN') LIMIT 1",
        )
        .get()
    )
      throw Error("Reconcile unresolved owner request first");
    const publicKey = await this.key();
    const info = await this.g.client.v1.chain.get_info();
    if (String(info.chain_id) !== JUNGLE4)
      throw Error("Wrong owner signing chain");
    const tx = Transaction.from({
      ...info.getTransactionHeader(120),
      actions: [this.action()],
    });
    const request = {
      version: 1,
      id: randomUUID(),
      chainId: JUNGLE4,
      contract: this.g.c.account,
      codeHash: this.g.c.codeHash,
      owner: this.g.c.appBinding!.owner,
      grantId: this.g.c.grantId,
      app: this.g.c.appBinding,
      publicKey,
      transactionId: String(tx.id),
      signingDigest: String(tx.signingDigest(JUNGLE4)),
      transaction: JSON.parse(JSON.stringify(tx)),
      review:
        "Revoke this grant: future reserve/consume stop; completed public records remain. No transfer, key change or grant expansion.",
    };
    this.validate(request);
    this.g.db
      .prepare(
        "INSERT INTO native_owner_ops(id,request,status) VALUES(?,?,'PREPARED')",
      )
      .run(request.id, JSON.stringify(request));
    return request;
  }
  async submit(id: string, signatures: unknown) {
    const sigs = z
      .array(z.string().regex(/^SIG_(K1|R1)_[1-9A-HJ-NP-Za-km-z]+$/))
      .length(1)
      .parse(signatures);
    const row = this.row(id),
      request = JSON.parse(row.request);
    if (row.status !== "PREPARED") return this.reconcile(id);
    const signed = SignedTransaction.from({
      ...request.transaction,
      signatures: sigs,
    });
    this.validate(request, signed);
    const remaining = Date.parse(String(signed.expiration) + "Z") - Date.now();
    if (remaining <= 0 || remaining > 125000)
      throw Error("Owner request expired or invalid lifetime");
    await this.grant();
    if ((await this.key()) !== request.publicKey)
      throw Error("Owner authority changed; prepare a new request");
    if (
      this.g.db
        .prepare(
          "UPDATE native_owner_ops SET status='PENDING',signed=? WHERE id=? AND status='PREPARED' AND NOT EXISTS (SELECT 1 FROM native_owner_ops WHERE status IN ('PENDING','UNKNOWN'))",
        )
        .run(JSON.stringify(signed), id).changes !== 1
    )
      throw Error("Owner request already submitted or unresolved");
    try {
      await this.g.client.v1.chain.send_transaction(signed);
    } catch {
      this.g.db
        .prepare("UPDATE native_owner_ops SET status='UNKNOWN' WHERE id=?")
        .run(id);
    }
    return this.reconcile(id);
  }
  async reconcile(id: string) {
    const row = this.row(id);
    if (row.status === "PREPARED") return { id, status: "PREPARED" };
    try {
      const request = JSON.parse(row.request);
      this.validate(request, JSON.parse(row.signed));
      const info = await this.g.pins(this.g.c.independent);
      const s = await this.g.rpc(
        this.g.c.independent,
        "get_transaction_status",
        { id: request.transactionId },
      );
      if (s.state !== "IRREVERSIBLE") throw Error("Owner finality unknown");
      const block = await this.g.rpc(this.g.c.independent, "get_block", {
        block_num_or_id: s.block_number,
      });
      assertNativeBlock(
        block,
        Number(s.block_number),
        request.transactionId,
        info.last_irreversible_block_num,
        s.block_id,
      );
      const grant = (await this.g.table("grants")).find(
        (g: any) => String(g.id) === this.g.c.grantId,
      );
      await this.g.appBinding(grant);
      if (![true, 1].includes(grant.revoked))
        throw Error("Owner revocation state unconfirmed");
      const evidence = {
        request,
        signedTransaction: JSON.parse(row.signed),
        block: s.block_number,
        blockId: block.id,
        grant,
        trust: "IRREVERSIBLE_INCLUSION_AND_CURRENT_STATE_VIA_TRUSTED_RPC",
      };
      this.g.db
        .prepare(
          "UPDATE native_owner_ops SET status='IRREVERSIBLE',evidence=? WHERE id=?",
        )
        .run(JSON.stringify(evidence), id);
      return { id, status: "IRREVERSIBLE", evidence };
    } catch {
      if (row.status !== "IRREVERSIBLE")
        this.g.db
          .prepare("UPDATE native_owner_ops SET status='UNKNOWN' WHERE id=?")
          .run(id);
      return {
        id,
        status: row.status === "IRREVERSIBLE" ? "IRREVERSIBLE" : "UNKNOWN",
        verificationUnavailable: true,
        evidence: row.evidence ? JSON.parse(row.evidence) : null,
      };
    }
  }
}
