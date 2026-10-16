// Fault-injection worker: real gateway/SQLite and EOA signatures; fake chain.
// SIGKILL deliberately bypasses shutdown hooks at specific durability boundaries.
import { readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createServer } from "../../services/gateway/src/server.ts";
import { Jungle } from "../../services/gateway/src/chain.ts";
import {
  compile,
  exampleSpec,
  makeIntent,
  typedData,
  intentHash,
  JUNGLE4,
} from "../../packages/core/src/index.ts";
const [directory, stage] = process.argv.slice(2);
const key = generatePrivateKey();
const owner = privateKeyToAccount(key);
const app = compile(exampleSpec);
const intent = makeIntent(
  app,
  {
    action: "createagent",
    id: "1",
    name: "Crash proof",
    description: "Disposable test",
  },
  owner.address,
  "1",
  "runtime11111",
  1,
  "0x" + "ab".repeat(32),
);
const hash = intentHash(intent);
writeFileSync(directory + "/expected.json", JSON.stringify({ hash, intent }));
const die = () => process.kill(process.pid, "SIGKILL");
Object.assign(Jungle.prototype, {
  async check() {
    return { chain_id: JUNGLE4 };
  },
  async nextNonce() {
    return "1";
  },
  async ram() {
    return 4000;
  },
  async rows() {
    return [];
  },
  async prepare() {
    return {
      transaction: { fakeChainOnly: true },
      transactionId: hash.slice(2),
      packed: "",
    };
  },
  async broadcast() {
    if (stage === "before_accept") die();
    writeFileSync(
      directory + "/fake-chain.json",
      JSON.stringify({ writes: 1, transactionId: hash.slice(2) }),
    );
    if (stage === "after_accept") die();
    return {
      transactionId: hash.slice(2),
      blockNum: 100,
      executionRamDelta: 344,
    };
  },
});
const s = await createServer({ directory, mode: "JUNGLE4" });
s.store.putApp(app);
s.store.deploy(app.appId);
const reserve = s.store.reserve.bind(s.store);
s.store.reserve = (...args) => {
  reserve(...args);
  if (stage === "reserved") die();
};
const transaction = s.store.transaction.bind(s.store);
s.store.transaction = (fn) => {
  const result = transaction(fn);
  if (stage === "prepared" && s.store.get(hash)?.prepared) die();
  return result;
};
const save = s.store.saveReceipt.bind(s.store);
s.store.saveReceipt = (h, r) => {
  if (stage === "before_receipt" && r.receipt.status === "SUBMITTED") die();
  save(h, r);
};
await s.server.inject({
  method: "POST",
  url: "/api/execute",
  headers: { host: "127.0.0.1", "x-vaultram-token": s.token },
  payload: { intent, signature: await owner.signTypedData(typedData(intent)) },
});
throw new Error("Fault injection did not reach expected crash point");
