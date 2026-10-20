// Real native gateway + SQLite, fake remote acceptance. No live network calls.
import { readFileSync, writeFileSync } from "node:fs";
import { AuthorityGateway } from "../../services/gateway/src/authority.ts";
import { JUNGLE4 } from "../../packages/core/src/index.ts";
const [directory, stage] = process.argv.slice(2);
const c = JSON.parse(readFileSync(directory + "/fixture-config.json", "utf8"));
const g = new AuthorityGateway(c, directory, undefined, "create");
g.pins = async () => ({});
g.permission = async () => {};
g.table = async () => [
  {
    id: 1,
    actor: c.actor,
    space: "memory",
    available: 5,
    max_payload: 256,
    expires: 2000000000,
    revoked: false,
  },
];
g.client.v1.chain.get_info = async () =>
  ({
    chain_id: JUNGLE4,
    getTransactionHeader: () => ({
      expiration: new Date(Date.now() + 120000).toISOString().slice(0, -1),
      ref_block_num: 1,
      ref_block_prefix: 2,
    }),
  }) as any;
const r = await g.prepare({ appId: "42", text: "crash-test public record" });
writeFileSync(directory + "/review.json", JSON.stringify(r));
const die = () => process.kill(process.pid, "SIGKILL");
if (stage === "prepared") die();
g.client.v1.chain.send_transaction = async () => {
  if (g.row(r.id).status !== "PENDING")
    throw Error("Not durable before broadcast");
  if (stage === "before_accept") die();
  writeFileSync(
    directory + "/fake-chain.json",
    JSON.stringify({ writes: 1, txid: r.transactionId }),
  );
  if (stage === "after_accept") die();
  throw Error("lost response");
};
g.rpc = async () => {
  throw Error("offline");
};
await g.submit(r.id, r.payloadHash);
if (stage === "unknown") die();
throw Error("Crash stage not reached");
