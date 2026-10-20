import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ABI, Name, Serializer } from "@wharfkit/antelope";
import { VerificationError } from "./verifier.mjs";

const profile = JSON.parse(
  readFileSync(new URL("./profile-external.json", import.meta.url)),
);
const abiBytes = readFileSync(new URL("./authority.abi.json", import.meta.url));
const tables = ["root", "apps", "grants", "reservations", "effects"];
const maximumRows = 10000;
const sha = (v) => createHash("sha256").update(v).digest("hex");
const check = (v, message) => {
  if (!v) throw new VerificationError(message);
};
function shape(v, keys) {
  check(
    v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).length === keys.length &&
      keys.every((k) => Object.hasOwn(v, k)),
    "Unexpected native state schema",
  );
}
function uint(v, positive = false) {
  check(
    (typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v)) ||
      (typeof v === "number" && Number.isSafeInteger(v) && v >= 0),
    "Unsafe native integer",
  );
  const n = BigInt(v);
  check(
    n <= 18446744073709551615n && (!positive || n > 0n),
    "Native integer out of range",
  );
  return n.toString();
}
function count(v) {
  const n = BigInt(uint(v));
  check(n <= BigInt(maximumRows), "Native count out of range");
  return Number(n);
}
function name(v) {
  check(
    typeof v === "string" &&
      /^[a-z1-5.]{1,13}$/.test(v) &&
      String(Name.from(v)) === v,
    "Invalid canonical native name",
  );
  return v;
}
function hash(v) {
  check(
    typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    "Invalid native hash",
  );
  return v;
}
const canonical = (v) =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
function unique(rows, field) {
  const seen = new Set();
  for (const r of rows) {
    check(!seen.has(r[field]), "Duplicate native " + field);
    seen.add(r[field]);
  }
}
function keyed(rows) {
  unique(rows, "id");
  rows.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  return new Map(rows.map((r) => [r.id, r]));
}

// Pure consistency checks over supplied public rows. This is not authentication.
export function inspectNativeState(raw) {
  shape(raw, tables);
  for (const t of tables)
    check(
      Array.isArray(raw[t]) && raw[t].length <= maximumRows,
      "Incomplete or oversized native table",
    );
  check(raw.root.length === 1, "Native root must be unique");
  const root = raw.root[0];
  shape(root, ["principal", "total", "available", "registered"]);
  const s = {
    root: [
      {
        principal: name(root.principal),
        total: count(root.total),
        available: count(root.available),
        registered: count(root.registered),
      },
    ],
    apps: [],
    grants: [],
    reservations: [],
    effects: [],
  };
  const rt = s.root[0];
  check(
    rt.principal === profile.root.principal && rt.total === profile.root.total,
    "Native root pin mismatch",
  );
  for (const a of raw.apps) {
    shape(a, ["id", "owner", "app_hash"]);
    s.apps.push({
      id: uint(a.id, true),
      owner: name(a.owner),
      app_hash: hash(a.app_hash),
    });
    check(a.app_hash !== "0".repeat(64), "Empty native app hash");
  }
  const apps = keyed(s.apps);
  check(rt.registered === apps.size, "Native app registration count mismatch");
  for (const g of raw.grants) {
    shape(g, [
      "id",
      "app_id",
      "owner",
      "actor",
      "actor_permission",
      "space",
      "budget",
      "available",
      "reserved",
      "quarantined",
      "consumed",
      "expires",
      "max_payload",
      "revoked",
    ]);
    check([true, false, 0, 1].includes(g.revoked), "Invalid revocation flag");
    const row = {
      id: uint(g.id, true),
      app_id: uint(g.app_id, true),
      owner: name(g.owner),
      actor: name(g.actor),
      actor_permission: name(g.actor_permission),
      space: name(g.space),
      budget: count(g.budget),
      available: count(g.available),
      reserved: count(g.reserved),
      quarantined: count(g.quarantined),
      consumed: count(g.consumed),
      expires: uint(g.expires, true),
      max_payload: count(g.max_payload),
      revoked: Boolean(g.revoked),
    };
    check(
      !["active", "owner"].includes(row.actor_permission),
      "Unrestricted agent permission",
    );
    check(
      apps.get(row.app_id)?.owner === row.owner,
      "Orphan or mismatched grant app",
    );
    check(
      row.budget > 0 &&
        row.max_payload > 0 &&
        row.max_payload <= 256 &&
        row.available + row.reserved + row.quarantined + row.consumed ===
          row.budget,
      "Native grant accounting mismatch",
    );
    s.grants.push(row);
  }
  const grants = keyed(s.grants);
  check(
    rt.available + s.grants.reduce((n, g) => n + g.budget, 0) === rt.total,
    "Shared native root conservation failed",
  );
  for (const r of raw.reservations) {
    shape(r, [
      "id",
      "grant_id",
      "obligation",
      "nullifier",
      "effect_id",
      "payload_hash",
      "status",
    ]);
    check([0, 1, 2].includes(r.status), "Invalid reservation status");
    const row = {
      id: uint(r.id, true),
      grant_id: uint(r.grant_id, true),
      obligation: uint(r.obligation, true),
      nullifier: uint(r.nullifier, true),
      effect_id: uint(r.effect_id, true),
      payload_hash: hash(r.payload_hash),
      status: r.status,
    };
    check(grants.has(row.grant_id), "Orphan reservation");
    s.reservations.push(row);
  }
  const reservations = keyed(s.reservations);
  for (const field of ["obligation", "nullifier", "effect_id"])
    unique(s.reservations, field);
  const counts = new Map(s.grants.map((g) => [g.id, [0, 0, 0]]));
  for (const r of s.reservations) counts.get(r.grant_id)[r.status]++;
  for (const g of s.grants) {
    const c = counts.get(g.id);
    check(
      c[0] === g.reserved && c[1] === g.consumed && c[2] === g.quarantined,
      "Reservation counters mismatch",
    );
  }
  for (const e of raw.effects) {
    shape(e, [
      "id",
      "reservation",
      "grant_id",
      "app_id",
      "owner",
      "actor",
      "actor_permission",
      "space",
      "payload",
    ]);
    check(typeof e.payload === "string", "Invalid effect payload");
    const row = {
      id: uint(e.id, true),
      reservation: uint(e.reservation, true),
      grant_id: uint(e.grant_id, true),
      app_id: uint(e.app_id, true),
      owner: name(e.owner),
      actor: name(e.actor),
      actor_permission: name(e.actor_permission),
      space: name(e.space),
      payload: e.payload,
    };
    const r = reservations.get(row.reservation),
      g = grants.get(row.grant_id);
    check(
      r &&
        g &&
        r.status === 1 &&
        r.effect_id === row.id &&
        r.grant_id === row.grant_id &&
        g.app_id === row.app_id &&
        g.owner === row.owner &&
        g.actor === row.actor &&
        g.actor_permission === row.actor_permission &&
        g.space === row.space,
      "Native effect binding mismatch",
    );
    check(
      Buffer.byteLength(row.payload) > 0 &&
        Buffer.byteLength(row.payload) <= g.max_payload &&
        sha(row.payload) === r.payload_hash,
      "Native effect payload mismatch",
    );
    s.effects.push(row);
  }
  const effects = keyed(s.effects);
  unique(s.effects, "reservation");
  for (const r of s.reservations)
    check(
      r.status === 1
        ? effects.get(r.effect_id)?.reservation === r.id
        : !effects.has(r.effect_id),
      "Consumed reservation/effect mismatch",
    );
  const totals = Object.fromEntries(
    ["available", "reserved", "quarantined", "consumed"].map((k) => [
      k,
      s.grants.reduce((n, g) => n + g[k], 0),
    ]),
  );
  return {
    snapshot: s,
    counts: {
      apps: apps.size,
      grants: grants.size,
      reservations: reservations.size,
      effects: effects.size,
    },
    accounting: {
      unit: "UNBACKED_TEST_WRITE",
      rootTotal: rt.total,
      rootAvailable: rt.available,
      allocated: s.grants.reduce((n, g) => n + g.budget, 0),
      grantCounters: totals,
    },
    observationDigest: sha(
      canonical({
        version: 1,
        chainId: profile.chainId,
        contract: profile.contract,
        codeHash: profile.codeHash,
        abiHash: profile.abiHash,
        rootPin: profile.root,
        snapshot: s,
      }),
    ),
  };
}
async function readTables(rpc) {
  const entries = await Promise.all(
    tables.map(async (table) => {
      const r = await rpc("get_table_rows", {
        json: true,
        code: profile.contract,
        scope: profile.contract,
        table,
        limit: maximumRows + 1,
      });
      check(
        r &&
          Array.isArray(r.rows) &&
          r.rows.length <= maximumRows &&
          r.more === false &&
          (!Object.hasOwn(r, "next_key") || r.next_key === ""),
        "Incomplete or ambiguous native table response",
      );
      return [table, r.rows];
    }),
  );
  return Object.fromEntries(entries);
}
async function pins(rpc) {
  const [info, code, abi] = await Promise.all([
    rpc("get_info", {}),
    rpc("get_code_hash", { account_name: profile.contract }),
    rpc("get_raw_abi", { account_name: profile.contract }),
  ]);
  check(
    info.chain_id === profile.chainId &&
      Number.isSafeInteger(info.head_block_num) &&
      Number.isSafeInteger(info.last_irreversible_block_num) &&
      info.last_irreversible_block_num > 0 &&
      info.head_block_num >= info.last_irreversible_block_num,
    "Native audit chain/finality mismatch",
  );
  check(
    code.code_hash === profile.codeHash && abi.abi_hash === profile.abiHash,
    "Native audit code/ABI pin mismatch",
  );
  return {
    headBlock: info.head_block_num,
    lastIrreversibleBlock: info.last_irreversible_block_num,
  };
}
export async function auditNativeState({ rpc, rpcName } = {}) {
  check(typeof rpc === "function", "Native state audit requires read-only RPC");
  check(
    sha(abiBytes) === profile.abiJsonHash &&
      sha(
        Serializer.encode({ object: ABI.from(JSON.parse(abiBytes)) }).array,
      ) === profile.abiHash,
    "Native audit bundled ABI mismatch",
  );
  const start = await pins(rpc);
  const first = await readTables(rpc);
  const second = await readTables(rpc);
  const end = await pins(rpc);
  check(
    end.lastIrreversibleBlock >= start.lastIrreversibleBlock &&
      end.headBlock >= start.headBlock,
    "Native audit verification window regressed",
  );
  // Compare raw canonical rows BEFORE invariant validation, so a changing read is
  // inconclusive, not falsely reported as a stable ledger violation. RPC row order
  // is primary-key order; a differing response requires a new read-only audit.
  if (canonical(first) !== canonical(second))
    throw new VerificationError(
      "Native state changed during observation; retry read-only audit",
      true,
    );
  const inspected = inspectNativeState(first);
  return {
    version: 1,
    status: "STABLE_CURRENT_RPC_OBSERVATION",
    profile: profile.id,
    chainId: profile.chainId,
    contract: profile.contract,
    codeHash: profile.codeHash,
    abiHash: profile.abiHash,
    checkedAt: new Date().toISOString(),
    rpc: rpcName ?? "CALLER_SUPPLIED",
    window: { start, end },
    ...inspected,
    aegisPolicyVerdict: "NOT_EVALUATED",
    backing: { status: "UNAVAILABLE", asset: null },
    trust: [
      "Two equal complete RPC reads, not an atomic snapshot or authenticated checkpoint.",
      "Observation digest identifies these rows; it is not an Aegis authority-state root or proof of canonical history.",
      "Head-state rows are not proven to belong to any irreversible block; RPC completeness and chain governance remain trusted.",
      "Counters are unbacked native test writes, not RAM bytes, V locks, leases or fresh executable authority.",
      "No transaction signing, submission, custody changes or capacity certificate is performed.",
    ],
  };
}
