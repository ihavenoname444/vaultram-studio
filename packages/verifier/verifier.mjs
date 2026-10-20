import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ABI,
  Action,
  PublicKey,
  Serializer,
  SignedTransaction,
} from "@wharfkit/antelope";

// Trust comes from the reviewer-selected package/profile, never from the bundle.
const profile = JSON.parse(
  readFileSync(new URL("./profile.json", import.meta.url), "utf8"),
);
const abiBytes = readFileSync(new URL("./authority.abi.json", import.meta.url));
const abi = ABI.from(JSON.parse(abiBytes));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export class VerificationError extends Error {
  constructor(message, unavailable = false) {
    super(message);
    this.unavailable = unavailable;
  }
}
function check(condition, message) {
  if (!condition) throw new VerificationError(message);
}
function shape(value, keys) {
  check(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((k) => Object.hasOwn(value, k)),
    "Unexpected evidence schema",
  );
}
function uint(value) {
  check(
    typeof value === "string" &&
      /^[1-9][0-9]{0,19}$/.test(value) &&
      BigInt(value) <= 18446744073709551615n,
    "Invalid unsigned identifier",
  );
  return value;
}
function hash(value) {
  check(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "Invalid hash",
  );
  return value;
}
function action(name, data, owner = false) {
  return Action.from(
    {
      account: profile.contract,
      name,
      data,
      authorization: [
        {
          actor: owner ? profile.app.owner : profile.actor,
          permission: owner ? "active" : profile.permission,
        },
      ],
    },
    abi,
  );
}
function reserve(id, payloadHash) {
  return action("reserve", {
    grant_id: profile.grantId,
    app_id: profile.app.appId,
    space: profile.space,
    id,
    obligation: id,
    nullifier: id,
    effect_id: id,
    payload_hash: payloadHash,
  });
}
function signed(record, expected, publicKey) {
  hash(record.transactionId);
  shape(record.transaction, [
    "expiration",
    "ref_block_num",
    "ref_block_prefix",
    "max_net_usage_words",
    "max_cpu_usage_ms",
    "delay_sec",
    "context_free_actions",
    "actions",
    "transaction_extensions",
    "signatures",
    "context_free_data",
  ]);
  for (const a of record.transaction.actions ?? [])
    shape(a, ["account", "name", "authorization", "data"]);
  const tx = SignedTransaction.from(record.transaction);
  check(
    tx.signatures.length === 1 &&
      !tx.context_free_data.length &&
      !tx.context_free_actions.length &&
      !tx.transaction_extensions.length &&
      Number(tx.delay_sec) === 0,
    "Unsupported signed transaction shape",
  );
  check(
    String(tx.id) === record.transactionId && same(tx.actions, expected),
    "Transaction/action binding mismatch",
  );
  // SignedTransaction.signingDigest includes signed fields; use unsigned body.
  check(
    tx.signatures[0]
      .recoverDigest(tx.transaction.signingDigest(profile.chainId))
      .equals(PublicKey.from(publicKey)),
    "Signature does not match pinned signer",
  );
  return tx;
}
function blockClaim(record) {
  check(
    Number.isSafeInteger(record.block) && record.block > 0,
    "Invalid block number",
  );
  hash(record.blockId);
  check(
    parseInt(record.blockId.slice(0, 8), 16) === record.block,
    "Block ID/number mismatch",
  );
}
function grantBinding(g) {
  check(
    g &&
      String(g.id) === profile.grantId &&
      String(g.app_id) === profile.app.appId &&
      g.owner === profile.app.owner &&
      g.actor === profile.actor &&
      g.actor_permission === profile.permission &&
      g.space === profile.space,
    "Current grant identity mismatch",
  );
  const counts = ["budget", "available", "reserved", "quarantined", "consumed"];
  for (const field of [...counts, "expires", "max_payload"])
    check(
      Number.isSafeInteger(g[field]) && g[field] >= 0,
      "Invalid grant counter",
    );
  check(
    g.budget === profile.grant.budget &&
      g.max_payload === profile.grant.max_payload &&
      g.expires === profile.grant.expires &&
      g.available + g.reserved + g.quarantined + g.consumed === g.budget,
    "Current grant limits/accounting mismatch",
  );
  check(
    g.revoked === true || g.revoked === 1,
    "Grant is not currently revoked",
  );
}
function historicalObservations(bundle) {
  const o = bundle.denial.observation;
  shape(o, [
    "observedAt",
    "submittingRpc",
    "stateRpcs",
    "error",
    "before",
    "after",
  ]);
  check(
    typeof o.observedAt === "string" &&
      Number.isFinite(Date.parse(o.observedAt)) &&
      o.submittingRpc === endpoints.greymass &&
      same(o.stateRpcs, [endpoints.greymass, endpoints.cryptolions]),
    "Unexpected observation provenance labels",
  );
  check(
    o.error?.code === 3050003 &&
      o.error?.name === "eosio_assert_message_exception" &&
      Array.isArray(o.error.details) &&
      o.error.details.some(
        (d) => d.message === "assertion failure with message: grant revoked",
      ),
    "Recorded rejection is not grant revoked",
  );
  check(
    Array.isArray(o.before) &&
      o.before.length === 2 &&
      same(o.before, o.after) &&
      same(o.before[0], o.before[1]),
    "Recorded snapshots disagree",
  );
  for (const s of o.before) {
    shape(s, ["root", "apps", "grants", "reservations", "effects"]);
    check(Object.values(s).every(Array.isArray), "Invalid recorded snapshot");
    grantBinding(s.grants.find((g) => String(g.id) === profile.grantId));
  }
  const ram = bundle.ramObservation;
  shape(ram, [
    "transactionId",
    "payer",
    "bytes",
    "payloadBytes",
    "source",
    "independentlyVerified",
    "observedAt",
  ]);
  check(
    ram.transactionId === bundle.write.transactionId &&
      ram.payer === profile.contract &&
      Number.isSafeInteger(ram.bytes) &&
      ram.bytes >= 0 &&
      ram.payloadBytes === Buffer.byteLength(bundle.write.payload) &&
      ram.source === "SUBMITTING_RPC_EXECUTION_TRACE" &&
      ram.independentlyVerified === false &&
      typeof ram.observedAt === "string" &&
      Number.isFinite(Date.parse(ram.observedAt)),
    "Malformed RAM observation",
  );
}
function inclusion(block, record, lib) {
  check(
    block?.block_num === record.block &&
      block.id === record.blockId &&
      record.block <= lib &&
      Array.isArray(block.transactions) &&
      block.transactions.some(
        (t) =>
          t.status === "executed" &&
          (t.trx?.id ?? t.trx) === record.transactionId,
      ),
    "Executed irreversible inclusion mismatch",
  );
}
export async function verifyEvidence(bundle, { rpc, rpcName } = {}) {
  check(
    sha(abiBytes) === profile.abiJsonHash &&
      sha(Serializer.encode({ object: abi }).array) === profile.abiHash,
    "Bundled ABI/profile mismatch",
  );
  shape(bundle, [
    "version",
    "profile",
    "write",
    "revocation",
    "denial",
    "ramObservation",
  ]);
  check(
    bundle.version === 1 && bundle.profile === profile.id,
    "Unsupported evidence profile",
  );
  const w = bundle.write,
    r = bundle.revocation,
    d = bundle.denial;
  shape(w, [
    "transaction",
    "transactionId",
    "block",
    "blockId",
    "reservationId",
    "payload",
  ]);
  shape(r, ["transaction", "transactionId", "block", "blockId"]);
  shape(d, [
    "transaction",
    "transactionId",
    "reservationId",
    "payloadHash",
    "observation",
  ]);
  uint(w.reservationId);
  uint(d.reservationId);
  hash(d.payloadHash);
  check(
    w.reservationId !== d.reservationId,
    "Denial must use a fresh reservation ID",
  );
  check(
    typeof w.payload === "string" &&
      Buffer.byteLength(w.payload) > 0 &&
      Buffer.byteLength(w.payload) <= profile.grant.max_payload,
    "Payload outside profile",
  );
  signed(
    w,
    [
      reserve(w.reservationId, sha(w.payload)),
      action("consume", { id: w.reservationId, payload: w.payload }),
    ],
    profile.agentPublicKey,
  );
  signed(
    r,
    [action("revoke", { grant_id: profile.grantId }, true)],
    profile.ownerPublicKey,
  );
  signed(d, [reserve(d.reservationId, d.payloadHash)], profile.agentPublicKey);
  blockClaim(w);
  blockClaim(r);
  check(w.block < r.block, "Write must precede revocation");
  historicalObservations(bundle);
  const claims = [
    {
      claim: "Signed transaction bodies and pinned signer keys",
      level: "VERIFIED_LOCAL",
    },
    {
      claim: "Exact app/grant/action/payload binding",
      level: "VERIFIED_LOCAL",
    },
    {
      claim: "Historical post-revoke rejection and unchanged snapshots",
      level: "RECORDED_ONLY",
      detail:
        "One claimed Greymass rejection; two claimed state observations. Internal consistency checked; provenance and submission are not authenticated.",
    },
    {
      claim: "RAM trace",
      level: "RECORDED_ONLY",
      bytes: bundle.ramObservation.bytes,
      detail:
        "Reported by submitting RPC; not independently authenticated or a byte quota.",
    },
    {
      claim: "AppSpec contents and historical registration/grant consent",
      level: "NOT_CHECKED",
    },
    {
      claim: "Historical deployed code and permission keys",
      level: "NOT_CHECKED",
    },
    {
      claim:
        "VaultRAM lease, V backing, cross-chain authority and full Aegis policy",
      level: "UNSUPPORTED",
    },
  ];
  if (rpc) {
    const [info, code, rawAbi, wb, rb] = await Promise.all([
      rpc("get_info", {}),
      rpc("get_code_hash", { account_name: profile.contract }),
      rpc("get_raw_abi", { account_name: profile.contract }),
      rpc("get_block", { block_num_or_id: w.block }),
      rpc("get_block", { block_num_or_id: r.block }),
    ]);
    check(
      info.chain_id === profile.chainId &&
        Number.isSafeInteger(info.last_irreversible_block_num) &&
        info.last_irreversible_block_num > 0,
      "RPC chain/finality mismatch",
    );
    check(
      code.code_hash === profile.codeHash &&
        rawAbi.abi_hash === profile.abiHash,
      "Current code/ABI pin mismatch",
    );
    inclusion(wb, w, info.last_irreversible_block_num);
    inclusion(rb, r, info.last_irreversible_block_num);
    const row = async (table, id) => {
      const result = await rpc("get_table_rows", {
        json: true,
        code: profile.contract,
        scope: profile.contract,
        table,
        lower_bound: id,
        upper_bound: id,
        limit: 1,
      });
      check(
        Array.isArray(result.rows) &&
          result.rows.length === 1 &&
          String(result.rows[0].id) === id &&
          !result.more,
        "Missing/ambiguous current row",
      );
      return result.rows[0];
    };
    const [app, grant, reservation, effect] = await Promise.all([
      row("apps", profile.app.appId),
      row("grants", profile.grantId),
      row("reservations", w.reservationId),
      row("effects", w.reservationId),
    ]);
    check(
      app.owner === profile.app.owner && app.app_hash === profile.app.appHash,
      "Current app binding mismatch",
    );
    grantBinding(grant);
    check(
      String(reservation.grant_id) === profile.grantId &&
        ["obligation", "nullifier", "effect_id"].every(
          (k) => String(reservation[k]) === w.reservationId,
        ) &&
        reservation.status === 1 &&
        reservation.payload_hash === sha(w.payload),
      "Current reservation mismatch",
    );
    check(
      String(effect.reservation) === w.reservationId &&
        String(effect.grant_id) === profile.grantId &&
        String(effect.app_id) === profile.app.appId &&
        effect.owner === profile.app.owner &&
        effect.actor === profile.actor &&
        effect.actor_permission === profile.permission &&
        effect.space === profile.space &&
        effect.payload === w.payload,
      "Current effect mismatch",
    );
    // Recheck pins after reads, without claiming this prevents transient upgrades.
    const [last, lastCode, lastAbi] = await Promise.all([
      rpc("get_info", {}),
      rpc("get_code_hash", { account_name: profile.contract }),
      rpc("get_raw_abi", { account_name: profile.contract }),
    ]);
    check(
      last.chain_id === profile.chainId &&
        Number.isSafeInteger(last.last_irreversible_block_num) &&
        last.last_irreversible_block_num >= info.last_irreversible_block_num &&
        lastCode.code_hash === profile.codeHash &&
        lastAbi.abi_hash === profile.abiHash,
      "RPC verification window changed",
    );
    claims.push(
      {
        claim: "Write and revocation executed irreversible inclusion",
        level: "VERIFIED_RPC",
        blocks: [w.block, r.block],
      },
      {
        claim: "Current code/ABI, app, revoked grant and retained write",
        level: "VERIFIED_RPC",
        detail: "Current table reads are not an atomic historical state proof.",
      },
    );
  } else
    claims.push({
      claim: "Chain inclusion, finality and current state",
      level: "NOT_CHECKED",
    });
  return {
    version: 1,
    profile: profile.id,
    status: rpc ? "PUBLIC_CHAIN_CHECKS_PASSED" : "OFFLINE_CHECKS_PASSED",
    aegisPolicyVerdict: "NOT_EVALUATED",
    checkedAt: new Date().toISOString(),
    rpc: rpc ? (rpcName ?? "CALLER_SUPPLIED") : null,
    claims,
    trust: [
      "Reviewer trusts this package's pinned profile, code and dependency lockfile.",
      "Online checks trust the selected RPC and chain consensus; not a light client.",
      "No fresh execution or wallet signing is performed; no authority is granted.",
      "Historical error/trace provenance is not authenticated; current pins cannot prove historical code.",
    ],
  };
}
export const endpoints = Object.freeze({
  cryptolions: "https://jungle4.cryptolions.io",
  greymass: "https://jungle4.greymass.com",
});
export function createRpc(name, transport = fetch) {
  check(Object.hasOwn(endpoints, name), "Unsupported RPC selection");
  const allowed = [
    "get_info",
    "get_code_hash",
    "get_raw_abi",
    "get_block",
    "get_table_rows",
  ];
  return async (method, body) => {
    check(allowed.includes(method), "RPC method is not read-only allowlisted");
    try {
      const response = await transport(
        endpoints[name] + "/v1/chain/" + method,
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw Error();
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8_000_000) {
          await reader.cancel();
          throw Error();
        }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new VerificationError(
        "RPC unavailable, malformed, redirected or oversized response",
        true,
      );
    }
  };
}
