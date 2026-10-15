import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Compiled,
  Intent,
  Payload,
  SignedReceipt,
  StateRow,
} from "../../../packages/core/src/index.ts";

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, value TEXT NOT NULL, deployed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS submissions (hash TEXT PRIMARY KEY, app TEXT NOT NULL, owner TEXT NOT NULL, nonce TEXT NOT NULL, intent TEXT NOT NULL, signature TEXT NOT NULL, status TEXT NOT NULL, prepared TEXT, receipt TEXT, error TEXT, UNIQUE(app,owner,nonce));
      CREATE TABLE IF NOT EXISTS state (app TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(app,kind,id));`);
  }
  putApp(app: Compiled) {
    this.db
      .prepare(
        "INSERT INTO apps(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(app.appId, JSON.stringify(app));
  }
  app(id: string): Compiled {
    const r = this.db.prepare("SELECT value FROM apps WHERE id=?").get(id);
    if (!r) throw new Error("Unknown app; compile first");
    return JSON.parse(String(r.value));
  }
  deploy(id: string) {
    this.app(id);
    this.db.prepare("UPDATE apps SET deployed=1 WHERE id=?").run(id);
  }
  deployed(id: string) {
    return (
      this.db.prepare("SELECT deployed FROM apps WHERE id=?").get(id)
        ?.deployed === 1
    );
  }
  apps() {
    return this.db
      .prepare("SELECT value,deployed FROM apps ORDER BY rowid DESC")
      .all()
      .map((r) => ({
        ...JSON.parse(String(r.value)),
        deployed: r.deployed === 1,
      }));
  }
  get(hash: string) {
    const r = this.db
      .prepare("SELECT * FROM submissions WHERE hash=?")
      .get(hash);
    return r
      ? {
          hash: String(r.hash),
          app: String(r.app),
          owner: String(r.owner),
          nonce: String(r.nonce),
          signature: String(r.signature),
          status: String(r.status),
          prepared: r.prepared ? String(r.prepared) : null,
          intent: JSON.parse(String(r.intent)) as Intent,
          receipt: r.receipt
            ? (JSON.parse(String(r.receipt)) as SignedReceipt)
            : null,
        }
      : null;
  }
  nextNonce(app: string, owner: string) {
    const rows = this.db
      .prepare(
        "SELECT nonce FROM submissions WHERE app=? AND owner=? AND status!='REJECTED'",
      )
      .all(app, owner);
    return (
      rows.reduce(
        (n, r) => (BigInt(String(r.nonce)) > n ? BigInt(String(r.nonce)) : n),
        0n,
      ) + 1n
    ).toString();
  }
  rejectBeforeBroadcast(hash: string) {
    this.db
      .prepare("UPDATE submissions SET status='REJECTED',nonce=? WHERE hash=?")
      .run("released:" + hash, hash);
  }
  reserve(hash: string, intent: Intent, signature: string) {
    this.db
      .prepare(
        "INSERT INTO submissions(hash,app,owner,nonce,intent,signature,status) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        hash,
        intent.appId,
        intent.owner,
        intent.nonce,
        JSON.stringify(intent),
        signature,
        "RESERVED",
      );
  }
  status(hash: string, status: string, prepared?: unknown) {
    this.db
      .prepare(
        "UPDATE submissions SET status=?, prepared=COALESCE(?,prepared) WHERE hash=?",
      )
      .run(status, prepared ? JSON.stringify(prepared) : null, hash);
  }
  saveReceipt(hash: string, receipt: SignedReceipt) {
    this.db
      .prepare("UPDATE submissions SET receipt=?,status=? WHERE hash=?")
      .run(JSON.stringify(receipt), receipt.receipt.status, hash);
  }
  receipts() {
    return this.db
      .prepare(
        "SELECT hash,status,receipt,error FROM submissions ORDER BY rowid DESC LIMIT 100",
      )
      .all()
      .map((r) => ({
        ...r,
        receipt: r.receipt ? JSON.parse(String(r.receipt)) : null,
      }));
  }
  rows(app: string): StateRow[] {
    return this.db
      .prepare("SELECT value FROM state WHERE app=? ORDER BY rowid DESC")
      .all(app)
      .map((r) => JSON.parse(String(r.value)));
  }
  apply(app: string, owner: string, payload: Payload) {
    const kind = payload.action === "setstate" ? "createagent" : payload.action;
    const get = (k: string, id: string): StateRow | undefined => {
      const r = this.db
        .prepare("SELECT value FROM state WHERE app=? AND kind=? AND id=?")
        .get(app, k, id);
      return r ? JSON.parse(String(r.value)) : undefined;
    };
    const existing = get(kind, payload.id);
    if (payload.action === "setstate") {
      if (!existing || existing.owner !== owner)
        throw new Error("Agent not owned by signer");
      existing.status = payload.status;
      this.db
        .prepare("UPDATE state SET value=? WHERE app=? AND kind=? AND id=?")
        .run(JSON.stringify(existing), app, kind, payload.id);
      return;
    }
    if (this.rows(app).some((r) => r.id === payload.id))
      throw new Error("Entity ID already exists");
    if (this.rows(app).length >= 1000) throw new Error("App row limit reached");
    if (
      "agentId" in payload &&
      get("createagent", payload.agentId)?.owner !== owner
    )
      throw new Error("Parent agent not owned by signer");
    const row: StateRow = {
      id: payload.id,
      owner,
      action: payload.action,
      data: payload,
      ...(kind === "createagent" ? { status: "active" } : {}),
    };
    this.db
      .prepare("INSERT INTO state(app,kind,id,value) VALUES(?,?,?,?)")
      .run(app, kind, payload.id, JSON.stringify(row));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
