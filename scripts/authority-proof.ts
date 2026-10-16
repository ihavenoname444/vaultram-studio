// Dedicated Jungle4-only operator harness. Never uses the old runtime as target.
import {
  APIClient,
  Action,
  Transaction,
  SignedTransaction,
  PrivateKey,
  ABI,
  Serializer,
} from "@wharfkit/antelope";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { JUNGLE4 } from "../packages/core/src/index.ts";
import {
  validateAuthorityMatrix,
  validateBuildBinding,
} from "./lib/authority-evidence.ts";
const command = process.argv[2];
if (
  ![
    "resources",
    "ram",
    "provision",
    "deploy",
    "run",
    "resume-race",
    "verify",
  ].includes(command)
)
  throw Error(
    "Usage: tsx scripts/authority-proof.ts resources|ram|provision|deploy|run|resume-race|verify",
  );
const privateDir = ".data/authority-proof",
  out = process.env.AUTHORITY_EVIDENCE_DIR ?? ".data/authority-proof/evidence";
mkdirSync(privateDir, { recursive: true, mode: 0o700 });
mkdirSync(out, { recursive: true });
const rpc = "https://jungle4.greymass.com",
  independent = "https://jungle4.cryptolions.io";
const hash = (x: string | Uint8Array) =>
  createHash("sha256").update(x).digest("hex");
async function api(
  endpoint: string,
  method: string,
  body: object = {},
): Promise<any> {
  const r = await fetch(endpoint + "/v1/chain/" + method, {
    method: "POST",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!r.ok)
    throw Error(
      j.error?.details?.map((d: any) => d.message).join("; ") ??
        j.message ??
        String(r.status),
    );
  return j;
}
for (const endpoint of [rpc, independent])
  if ((await api(endpoint, "get_info")).chain_id !== JUNGLE4)
    throw Error("Wrong chain");
const client = new APIClient({ url: rpc });
const artifactDir = "contracts/build/authority/";
const abi = ABI.from(
  JSON.parse(readFileSync(artifactDir + "authority.abi", "utf8")),
);
const build = JSON.parse(readFileSync(artifactDir + "build.json", "utf8"));
if (
  hash(readFileSync("contracts/authority-proof/authority.cpp")) !==
    build.sourceSha256 ||
  hash(readFileSync(artifactDir + "authority.wasm")) !== build.wasmSha256 ||
  hash(readFileSync(artifactDir + "authority.abi")) !== build.abiSha256
)
  throw Error("Artifact/source pin mismatch");
type Keys = { account: string; owner: string; active: string };
let keys: Keys;
const keyPath = privateDir + "/keys.json";
if (command === "provision" && !existsSync(keyPath)) {
  keys = {
    account:
      "vra" +
      [...randomBytes(9)]
        .map((n) => String.fromCharCode(97 + (n % 26)))
        .join(""),
    owner: String(PrivateKey.generate("K1")),
    active: String(PrivateKey.generate("K1")),
  };
  writeFileSync(keyPath, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
} else if (command === "verify")
  keys = {
    account: JSON.parse(readFileSync(out + "/deployment.json", "utf8")).account,
    owner: "",
    active: "",
  };
else keys = JSON.parse(readFileSync(keyPath, "utf8"));
const old =
  command === "verify"
    ? null
    : JSON.parse(readFileSync(".data/testnet-keys.json", "utf8"));
if (old && [old.runtime, old.relayer].includes(keys.account))
  throw Error("Refusing existing demo account");
const deploymentPath = out + "/deployment.json";
const evidencePath = out + "/run.json";
function bindDeployment(d: any) {
  validateBuildBinding(d, build, keys.account, JUNGLE4);
}
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const save = (p: string, data: any) =>
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
function chainError(error: any) {
  const details = error?.response?.json?.error?.details;
  return (
    String(error) +
    (Array.isArray(details)
      ? "; " + details.map((d: any) => d.message).join("; ")
      : "")
  );
}
const signer = (actor: string) =>
  actor === keys.account
    ? keys.active
    : actor === old.runtime
      ? old.runtimeAdmin
      : actor === old.relayer
        ? old.relayerAdmin
        : (() => {
            throw Error("Unknown signer");
          })();
async function system(name: string, data: object, actor: string) {
  const { abi: systemAbi } = await client.v1.chain.get_abi("eosio");
  if (!systemAbi) throw Error("System ABI missing");
  return Action.from(
    {
      account: "eosio",
      name,
      data,
      authorization: [{ actor, permission: "active" }],
    },
    systemAbi,
  );
}
function action(name: string, data: object, actors: string[]) {
  return Action.from(
    {
      account: keys.account,
      name,
      data,
      authorization: actors.map((actor) => ({ actor, permission: "active" })),
    },
    abi,
  );
}
async function prepare(actions: Action[], actors: string[]) {
  const head = await client.v1.chain.get_info();
  if (String(head.chain_id) !== JUNGLE4) throw Error("Wrong signing chain");
  const tx = Transaction.from({ ...head.getTransactionHeader(120), actions });
  const signed = SignedTransaction.from({
    ...tx,
    signatures: [...new Set(actors)].map((actor) =>
      PrivateKey.from(signer(actor)).signDigest(tx.signingDigest(JUNGLE4)),
    ),
  });
  return { tx, signed, id: String(tx.id) };
}
async function push(p: Awaited<ReturnType<typeof prepare>>) {
  const r = JSON.parse(
    JSON.stringify(await client.v1.chain.send_transaction(p.signed)),
  );
  if (r.processed?.receipt?.status !== "executed" || r.processed?.except)
    throw Error("Not executed");
  return {
    transactionId: p.id,
    reportedBlock: Number(r.processed.block_num),
    transaction: JSON.parse(JSON.stringify(p.signed)),
  };
}
async function included(txid: string, hint: number) {
  for (let attempt = 0; attempt < 35; attempt++) {
    let blockNum = hint;
    try {
      const s = await api(independent, "get_transaction_status", { id: txid });
      if (s.block_number) blockNum = Number(s.block_number);
    } catch {
      /* Bounded fallback below */
    }
    const info = await api(independent, "get_info");
    for (const n of [...new Set([blockNum, hint, hint + 1, hint + 2])]) {
      if (n > info.last_irreversible_block_num) continue;
      const b = await api(independent, "get_block", { block_num_or_id: n });
      if (
        b.transactions?.some(
          (x: any) => x.status === "executed" && (x.trx?.id ?? x.trx) === txid,
        )
      )
        return n;
    }
    await delay(500);
  }
  throw Error("UNKNOWN: irreversible inclusion unavailable");
}
async function state(endpoint = rpc) {
  const result: Record<string, any[]> = {};
  for (const table of ["root", "grants", "reservations", "effects"]) {
    const r = await api(endpoint, "get_table_rows", {
      json: true,
      code: keys.account,
      scope: keys.account,
      table,
      limit: 10001,
    });
    if (r.more) throw Error("Unexpected table pagination");
    result[table] = r.rows;
  }
  return result;
}
function invariant(s: Record<string, any[]>) {
  if (s.root.length !== 1) throw Error("Root absent");
  let sum = BigInt(s.root[0].available),
    consumed = 0;
  for (const g of s.grants) {
    const subtotal = [
      "available",
      "reserved",
      "quarantined",
      "consumed",
    ].reduce((n, k) => n + BigInt(g[k]), 0n);
    if (subtotal !== BigInt(g.budget)) throw Error("Grant conservation failed");
    sum += subtotal;
    for (const [field, status] of [
      ["reserved", 0],
      ["consumed", 1],
      ["quarantined", 2],
    ] as const)
      if (
        Number(g[field]) !==
        s.reservations.filter(
          (r) =>
            String(r.grant_id) === String(g.id) && Number(r.status) === status,
        ).length
      )
        throw Error("Reservation accounting failed");
    consumed += Number(g.consumed);
  }
  if (sum !== BigInt(s.root[0].total) || consumed !== s.effects.length)
    throw Error("Global conservation failed");
  for (const f of ["id", "obligation", "nullifier", "effect_id"])
    if (
      new Set(s.reservations.map((r) => String(r[f]))).size !==
      s.reservations.length
    )
      throw Error("Identifier reused");
  for (const e of s.effects) {
    const r = s.reservations.find(
        (r) => String(r.id) === String(e.reservation),
      ),
      g = s.grants.find((g) => String(g.id) === String(e.grant_id));
    if (
      !r ||
      !g ||
      Number(r.status) !== 1 ||
      String(r.grant_id) !== String(g.id) ||
      String(r.effect_id) !== String(e.id) ||
      r.payload_hash !== hash(e.payload) ||
      e.actor !== g.actor ||
      e.space !== g.space
    )
      throw Error("Effect binding invalid");
  }
}
if (command === "resources") {
  if (existsSync(out + "/resources.json"))
    throw Error("Resource top-up already recorded");
  const actions = await Promise.all(
    [old.relayer, old.runtime].map((receiver) =>
      system(
        "delegatebw",
        {
          from: old.relayer,
          receiver,
          stake_net_quantity: "0.0000 EOS",
          stake_cpu_quantity: "10.0000 EOS",
          transfer: false,
        },
        old.relayer,
      ),
    ),
  );
  const result = await push(await prepare(actions, [old.relayer]));
  const block = await included(result.transactionId, result.reportedBlock);
  save(out + "/resources.json", { ...result, block, testStake: "20.0000 EOS" });
  console.log({ status: "TEST_CPU_STAKED", block });
}
if (command === "ram") {
  if (existsSync(out + "/ram.json")) throw Error("RAM top-up already recorded");
  const a = await api(rpc, "get_account", { account_name: keys.account });
  if (Number(a.ram_quota) >= 340000)
    throw Error("RAM already sufficient; inspect before retry");
  const actions = await Promise.all(
    [
      [old.relayer, "40.0000 EOS"],
      [old.runtime, "10.0000 EOS"],
    ].map(([payer, quant]) =>
      system("buyram", { payer, receiver: keys.account, quant }, payer),
    ),
  );
  const result = await push(await prepare(actions, [old.relayer, old.runtime]));
  const block = await included(result.transactionId, result.reportedBlock);
  save(out + "/ram.json", {
    ...result,
    block,
    testTokensAllocated: "50.0000 EOS",
  });
  console.log({ status: "TEST_RAM_ADDED", block });
}
if (command === "provision") {
  try {
    await api(rpc, "get_account", { account_name: keys.account });
    throw Error("Account exists; inspect before retry");
  } catch (e) {
    if (String(e).includes("Account exists")) throw e;
    if (!/unknown key|unknown account|does not exist/.test(String(e))) throw e;
  }
  const auth = (key: string) => ({
    threshold: 1,
    keys: [{ key: String(PrivateKey.from(key).toPublic()), weight: 1 }],
    accounts: [],
    waits: [],
  });
  const actions = [
    await system(
      "newaccount",
      {
        creator: old.relayer,
        name: keys.account,
        owner: auth(keys.owner),
        active: auth(keys.active),
      },
      old.relayer,
    ),
    await system(
      "buyram",
      { payer: old.relayer, receiver: keys.account, quant: "20.0000 EOS" },
      old.relayer,
    ),
    await system(
      "delegatebw",
      {
        from: old.relayer,
        receiver: keys.account,
        stake_net_quantity: "1.0000 EOS",
        stake_cpu_quantity: "5.0000 EOS",
        transfer: false,
      },
      old.relayer,
    ),
  ];
  const result = await push(await prepare(actions, [old.relayer]));
  const block = await included(result.transactionId, result.reportedBlock);
  save(out + "/provision.json", {
    account: keys.account,
    testTokensAllocated: "26.0000 EOS",
    ...result,
    block,
  });
  console.log({ account: keys.account, status: "PROVISIONED", block });
}
if (command === "deploy") {
  const code = await api(rpc, "get_code_hash", { account_name: keys.account });
  if (code.code_hash !== "0".repeat(64)) throw Error("Refusing code overwrite");
  const actions = [
    await system(
      "setcode",
      {
        account: keys.account,
        vmtype: 0,
        vmversion: 0,
        code: readFileSync(artifactDir + "authority.wasm").toString("hex"),
      },
      keys.account,
    ),
    await system(
      "setabi",
      {
        account: keys.account,
        abi: Serializer.encode({ object: abi }).hexString,
      },
      keys.account,
    ),
    action("init", { principal: old.runtime, total: 10000 }, [
      keys.account,
      old.runtime,
    ]),
  ];
  const result = await push(
    await prepare(actions, [keys.account, old.runtime]),
  );
  const block = await included(result.transactionId, result.reportedBlock);
  save(deploymentPath, {
    account: keys.account,
    principal: old.runtime,
    actor: old.relayer,
    chainId: JUNGLE4,
    ...build,
    ...result,
    block,
    trust:
      "Native principal; contract upgrade authorities and chain remain trusted",
  });
  console.log({ status: "DEPLOYED", account: keys.account, block });
}
if (command === "run" || command === "resume-race") {
  const resume = command === "resume-race";
  if (!resume && existsSync(evidencePath))
    throw Error("Run evidence exists; no blind rerun. Inspect journal.");
  const d = load(deploymentPath);
  bindDeployment(d);
  if (
    (await api(rpc, "get_code_hash", { account_name: keys.account }))
      .code_hash !== d.wasmSha256
  )
    throw Error("Deployment changed");
  const journal = resume ? load(evidencePath) : null;
  const events: any[] = journal?.events ?? [];
  if (
    resume &&
    (journal.complete ||
      events.length !== 28 ||
      events.at(-1).label !== "concurrent direct reservations" ||
      events.at(-1).after)
  )
    throw Error("Resume only supports interrupted race finality");
  if (resume) save(out + "/interrupted-race-run.json", journal);
  save(evidencePath, { complete: false, events });
  let expiry = resume
    ? Number(
        (await state(independent)).grants.find((g: any) => Number(g.id) === 4)
          .expires,
      )
    : 0;
  const expires = Math.floor(Date.now() / 1000) + 1800;
  const gd = (id: number, budget: number, patch = {}) => ({
    id,
    actor: old.relayer,
    space: "memory",
    budget,
    expires,
    max_payload: 256,
    ...patch,
  });
  const rd = (id: number, grant_id = 1, patch = {}) => ({
    id,
    grant_id,
    space: "memory",
    obligation: id,
    nullifier: id,
    effect_id: id,
    payload_hash: hash("public"),
    ...patch,
  });
  async function check(
    label: string,
    name: string,
    data: object,
    actor = old.relayer,
    rejection?: RegExp,
  ) {
    const before = await state();
    invariant(before);
    const p = await prepare([action(name, data, [actor])], [actor]);
    const event: any = {
      label,
      expected: rejection ? "REJECT" : "EXECUTE",
      before,
      signedTransaction: JSON.parse(JSON.stringify(p.signed)),
      transactionId: p.id,
    };
    events.push(event);
    save(evidencePath, { complete: false, events });
    let success = false;
    try {
      const r = await push(p);
      success = true;
      event.reportedBlock = r.reportedBlock;
      event.block = await included(p.id, r.reportedBlock);
    } catch (e) {
      event.error = chainError(e);
      if (!rejection || !rejection.test(event.error)) {
        save(evidencePath, { complete: false, events });
        throw e;
      }
    }
    if (rejection && success) throw Error("Attack executed: " + label);
    event.after = await state();
    invariant(event.after);
    if (rejection && JSON.stringify(before) !== JSON.stringify(event.after))
      throw Error("Rejected action changed state");
    save(evidencePath, { complete: false, events });
    console.log(
      label + ": " + (success ? "IRREVERSIBLE" : "REJECTED_UNCHANGED"),
    );
  }
  if (!resume) {
    await check(
      "forged principal grant",
      "grant",
      gd(1, 1),
      old.relayer,
      /missing authority/,
    );
    await check("allocate grant one", "grant", gd(1, 6), old.runtime);
    await check("allocate racing grant", "grant", gd(2, 1), old.runtime);
    await check(
      "allocate second actor",
      "grant",
      gd(3, 9991, { actor: old.runtime }),
      old.runtime,
    );
    expiry = Math.floor(Date.now() / 1000) + 60;
    await check(
      "allocate expiring grant",
      "grant",
      gd(4, 2, { expires: expiry }),
      old.runtime,
    );
    await check("reserve before expiry", "reserve", rd(40, 4));
    await check(
      "root 10000 plus one",
      "grant",
      gd(5, 1),
      old.runtime,
      /root budget/,
    );
    await check(
      "wrong native actor",
      "reserve",
      rd(1),
      old.runtime,
      /missing authority/,
    );
    await check(
      "namespace substitution",
      "reserve",
      rd(1, 1, { space: "treasury" }),
      old.relayer,
      /namespace/,
    );
    await check("reserve valid effect", "reserve", rd(1));
    await check(
      "wrong consuming actor",
      "consume",
      { id: 1, payload: "public" },
      old.runtime,
      /missing authority/,
    );
    await check(
      "oversized effect",
      "consume",
      { id: 1, payload: "x".repeat(257) },
      old.relayer,
      /payload size/,
    );
    await check(
      "payload substitution",
      "consume",
      { id: 1, payload: "forged" },
      old.relayer,
      /binding/,
    );
    await check("consume valid effect", "consume", {
      id: 1,
      payload: "public",
    });
    await check(
      "lost-response application retry",
      "consume",
      { id: 1, payload: "public" },
      old.relayer,
      /not available/,
    );
    for (const field of ["obligation", "nullifier", "effect_id"])
      await check(
        "reuse " + field,
        "reserve",
        rd(2, 1, { [field]: 1 }),
        old.relayer,
        /used/,
      );
    await check("reserve uncertain effect", "reserve", rd(2));
    await check("quarantine uncertain effect", "quarantine", { id: 2 });
    await check(
      "quarantine cannot execute",
      "consume",
      { id: 2, payload: "public" },
      old.relayer,
      /not available/,
    );
    await check(
      "quarantine cannot reserve again",
      "reserve",
      rd(2),
      old.relayer,
      /used/,
    );
    await check("reserve before revocation", "reserve", rd(3));
    await check(
      "actor cannot revoke",
      "revoke",
      { grant_id: 1 },
      old.relayer,
      /missing authority/,
    );
    await check("principal revokes", "revoke", { grant_id: 1 }, old.runtime);
    await check(
      "revoked cannot consume",
      "consume",
      { id: 3, payload: "public" },
      old.relayer,
      /revoked/,
    );
    await check(
      "revoked cannot reserve",
      "reserve",
      rd(4),
      old.relayer,
      /revoked/,
    );
  }
  // send_transaction may report local execution on competing nodes for BOTH
  // candidates. Only irreversible inclusion spends authoritative capacity.
  const before = resume ? events.at(-1).before : await state();
  const prepared = resume
    ? events.at(-1).signedTransactions.map((raw: any) => {
        const signed = SignedTransaction.from(raw);
        return { signed, tx: signed, id: String(signed.id) };
      })
    : await Promise.all([
        prepare([action("reserve", rd(20, 2), [old.relayer])], [old.relayer]),
        prepare([action("reserve", rd(21, 2), [old.relayer])], [old.relayer]),
      ]);
  const race: any = resume
    ? events.at(-1)
    : {
        label: "concurrent direct reservations",
        before,
        signedTransactions: prepared.map((p: any) =>
          JSON.parse(JSON.stringify(p.signed)),
        ),
      };
  if (!resume) {
    events.push(race);
    save(evidencePath, { complete: false, events });
    const submitted = await Promise.allSettled(prepared.map(push));
    race.submissionObservations = submitted.map((r) =>
      r.status === "fulfilled" ? r.value : { error: chainError(r.reason) },
    );
    save(evidencePath, { complete: false, events });
  } else
    race.recovery =
      "Original journal persisted signed candidates before sending; submission responses were not retained by interrupted older harness. No original candidate resubmitted.";
  // Let both signed candidates expire before classifying the final observation.
  const deadline = Math.max(
    ...prepared.map((p: any) => Date.parse(String(p.signed.expiration) + "Z")),
  );
  if (!Number.isFinite(deadline) || deadline - Date.now() > 125000)
    throw Error("Unexpected race expiry");
  while (Date.now() <= deadline + 1500) await delay(500);
  race.results = [];
  for (const p of prepared) {
    const status = await api(independent, "get_transaction_status", {
      id: p.id,
    });
    if (status.state === "IRREVERSIBLE") {
      const block = await included(p.id, Number(status.block_number));
      race.results.push({
        transactionId: p.id,
        transaction: JSON.parse(JSON.stringify(p.signed)),
        block,
        originalStatus: status,
      });
    } else race.results.push({ transactionId: p.id, originalStatus: status });
  }
  if (race.results.filter((r: any) => r.block).length !== 1)
    throw Error("Race requires exactly one independently finalized winner");
  const loserIndex = race.results.findIndex((r: any) => !r.block);
  const retryBefore = await state(independent);
  invariant(retryBefore);
  if (
    retryBefore.reservations.filter((r: any) => Number(r.grant_id) === 2)
      .length !== 1
  )
    throw Error("Unexpected race state");
  const retry = await prepare(prepared[loserIndex].signed.actions, [
    old.relayer,
  ]);
  race.results[loserIndex].retry = {
    transactionId: retry.id,
    signedTransaction: JSON.parse(JSON.stringify(retry.signed)),
    before: retryBefore,
  };
  save(evidencePath, { complete: false, events });
  let retryError = "";
  try {
    await push(retry);
  } catch (e) {
    retryError = chainError(e);
  }
  if (!/exhausted/.test(retryError))
    throw Error(
      "Race loser retry did not reject on exhausted budget: " + retryError,
    );
  race.after = await state(independent);
  invariant(race.after);
  if (JSON.stringify(retryBefore) !== JSON.stringify(race.after))
    throw Error("Race retry changed state");
  Object.assign(race.results[loserIndex].retry, {
    error: retryError,
    after: race.after,
  });
  save(evidencePath, { complete: false, events });
  console.log(
    "concurrent direct reservations: ONE_IRREVERSIBLE_WINNER; LOSER_RETRY_REJECTED_UNCHANGED",
  );
  const winner = race.after.reservations.find(
    (r: any) => Number(r.grant_id) === 2,
  );
  await check("consume race winner", "consume", {
    id: winner.id,
    payload: "public",
  });
  await check(
    "exhausted grant plus one",
    "reserve",
    rd(22, 2),
    old.relayer,
    /exhausted/,
  );
  while (Math.floor(Date.now() / 1000) <= expiry + 1) await delay(500);
  await check(
    "expired cannot reserve",
    "reserve",
    rd(41, 4),
    old.relayer,
    /expired/,
  );
  await check(
    "expired cannot consume",
    "consume",
    { id: 40, payload: "public" },
    old.relayer,
    /expired/,
  );
  await check("expired unit quarantined", "quarantine", { id: 40 });
  const finalState = await state(independent);
  invariant(finalState);
  save(evidencePath, {
    complete: true,
    chainId: JUNGLE4,
    account: keys.account,
    events,
    finalState,
    limitations: [
      "Negative RPC errors are observations, not finalized rejection receipts",
      "One contract, native account authority; no EVM signature verification or cross-domain conservation",
      "Upgrade admin and chain remain trusted",
    ],
  });
  console.log("LIVE_AUTHORITY_MATRIX_COMPLETE");
}
if (command === "verify") {
  const d = load(deploymentPath),
    run = load(evidencePath);
  bindDeployment(d);
  validateAuthorityMatrix(run, keys.account, JUNGLE4, invariant);
  if (
    !run.complete ||
    d.account !== keys.account ||
    run.account !== keys.account
  )
    throw Error("Incomplete or mismatched run");
  const code = await api(independent, "get_code_hash", {
    account_name: keys.account,
  });
  if (code.code_hash !== d.wasmSha256) throw Error("Code pin mismatch");
  const chainAbi = await api(independent, "get_abi", {
    account_name: keys.account,
  });
  if (
    Serializer.encode({ object: ABI.from(chainAbi.abi) }).hexString !==
    Serializer.encode({ object: abi }).hexString
  )
    throw Error("ABI pin mismatch");
  let verified = 0;
  for (const e of [
    d,
    ...run.events.flatMap((e: any) =>
      e.results ? e.results.filter((r: any) => r.block) : e.block ? [e] : [],
    ),
  ]) {
    const tx = SignedTransaction.from(e.transaction ?? e.signedTransaction);
    if (String(tx.id) !== e.transactionId)
      throw Error("Transaction digest mismatch");
    const n = await included(e.transactionId, e.block);
    if (n !== e.block) throw Error("Inclusion block mismatch");
    verified++;
  }
  const current = await state(independent);
  invariant(current);
  if (JSON.stringify(current) !== JSON.stringify(run.finalState))
    throw Error("State changed since run");
  save(out + "/verification.json", {
    status:
      "POSITIVE_INCLUSION_AND_STATE_VERIFIED_MATRIX_OBSERVATIONS_VALIDATED",
    checkedAt: new Date().toISOString(),
    account: keys.account,
    chainId: JUNGLE4,
    successfulTransactionsVerified: verified,
    codeHash: code.code_hash,
    sourceHash: build.sourceSha256,
    finalState: current,
    limitations: run.limitations,
  });
  console.log({
    status:
      "POSITIVE_INCLUSION_AND_STATE_VERIFIED_MATRIX_OBSERVATIONS_VALIDATED",
    successfulTransactionsVerified: verified,
    account: keys.account,
  });
}
