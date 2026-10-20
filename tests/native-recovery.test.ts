import { expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ABI, Serializer, PrivateKey } from "@wharfkit/antelope";
import { AuthorityGateway } from "../services/gateway/src/authority.ts";
const bytes = readFileSync("contracts/build/authority/authority.abi");
const hash = (x: Uint8Array) => createHash("sha256").update(x).digest("hex");
it("rejects missing core tables even when domain fingerprint survived", () => {
  for (const table of ["native_ops", "native_ram", "native_safety"]) {
    const d = mkdtempSync(join(tmpdir(), "native-missing-table-")),
      c = config();
    try {
      const g = new AuthorityGateway(c, d, bytes, "create");
      g.db.exec("DROP TABLE " + table);
      g.close();
      expect(() => new AuthorityGateway(c, d, bytes)).toThrow("incomplete");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
});
it("failed recovery import and restart retain the durable submission lock", async () => {
  const d = mkdtempSync(join(tmpdir(), "native-locked-recovery-")),
    c = config();
  let g = new AuthorityGateway(c, d, bytes, "recovery");
  try {
    await expect(g.restoreExport({ configuration: {} })).rejects.toThrow(
      "domain",
    );
    g.close();
    g = new AuthorityGateway(c, d, bytes);
    await expect(
      g.prepare({ appId: "42", text: "cannot resume" }),
    ).rejects.toThrow("read-only");
  } finally {
    g.close();
    rmSync(d, { recursive: true, force: true });
  }
});
function config() {
  return {
    account: "authority111",
    actor: "agent1111111",
    permission: "vrstudio",
    grantId: "1",
    space: "memory",
    privateKey: String(PrivateKey.generate("K1")),
    codeHash: "a".repeat(64),
    abiHash: hash(
      Serializer.encode({ object: ABI.from(JSON.parse(bytes.toString())) })
        .array,
    ),
    abiJsonHash: hash(bytes),
    rpc: "https://jungle4.greymass.com" as const,
    independent: "https://jungle4.cryptolions.io" as const,
  };
}
it.each(["prepared", "before_accept", "after_accept", "unknown"])(
  "native journal survives SIGKILL at %s without resending or dropping uncertainty",
  async (stage) => {
    const directory = mkdtempSync(join(tmpdir(), "native-crash-"));
    let g: AuthorityGateway | undefined;
    try {
      const c = config();
      writeFileSync(directory + "/fixture-config.json", JSON.stringify(c), {
        mode: 0o600,
      });
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "tests/fixtures/native-crash-worker.ts",
          directory,
          stage,
        ],
        {
          encoding: "utf8",
          timeout: 15000,
          env: {
            PATH: process.env.PATH,
            HOME: directory,
            TSX_DISABLE_CACHE: "1",
          },
        },
      );
      expect(child.signal, child.stderr).toBe("SIGKILL");
      const r = JSON.parse(readFileSync(directory + "/review.json", "utf8"));
      g = new AuthorityGateway(c, directory, bytes);
      expect(g.row(r.id).status).toBe(
        stage === "prepared"
          ? "PREPARED"
          : stage === "unknown"
            ? "UNKNOWN"
            : "PENDING",
      );
      vi.spyOn(g, "pins").mockRejectedValue(Error("offline"));
      const send = vi.spyOn(g.client.v1.chain, "send_transaction");
      if (stage === "prepared")
        expect((await g.reconcile(r.id)).status).toBe("PREPARED");
      else {
        expect((await g.submit(r.id, r.payloadHash)).status).toBe("UNKNOWN");
        await expect(
          g.prepare({ appId: "42", text: "duplicate risk" }),
        ).rejects.toThrow("unresolved");
      }
      expect(send).not.toHaveBeenCalled();
      if (existsSync(directory + "/fake-chain.json"))
        expect(
          JSON.parse(readFileSync(directory + "/fake-chain.json", "utf8"))
            .writes,
        ).toBe(1);
    } finally {
      g?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
it("refuses a missing, zero-byte, corrupt or identity-less live journal instead of creating history", () => {
  const d = mkdtempSync(join(tmpdir(), "native-corrupt-")),
    c = config();
  try {
    expect(() => new AuthorityGateway(c, d, bytes)).toThrow("missing");
    for (const content of ["", "not sqlite"]) {
      writeFileSync(d + "/authority.sqlite", content);
      expect(() => new AuthorityGateway(c, d, bytes)).toThrow();
      rmSync(d + "/authority.sqlite", { force: true });
    }
    const g = new AuthorityGateway(c, d, bytes, "create");
    g.db.exec("DELETE FROM native_domain");
    g.close();
    expect(() => new AuthorityGateway(c, d, bytes)).toThrow("incomplete");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
it("refuses a corrupted signed row on startup", async () => {
  const d = mkdtempSync(join(tmpdir(), "native-row-corrupt-")),
    c = config();
  try {
    const g = new AuthorityGateway(c, d, bytes, "create");
    g.db
      .prepare(
        "INSERT INTO native_ops(id,payload,rid,txid,transaction_json,status) VALUES(?,?,?,?,?,?)",
      )
      .run("x", "changed", "1", "a".repeat(64), "{}", "IRREVERSIBLE");
    g.close();
    expect(() => new AuthorityGateway(c, d, bytes)).toThrow(
      "record binding corrupt",
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
