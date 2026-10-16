import { SignedTransaction } from "@wharfkit/antelope";
export const authorityCases: [string, string | null][] = [
  ["forged principal grant", "missing authority"],
  ["allocate grant one", null],
  ["allocate racing grant", null],
  ["allocate second actor", null],
  ["allocate expiring grant", null],
  ["reserve before expiry", null],
  ["root 10000 plus one", "root budget"],
  ["wrong native actor", "missing authority"],
  ["namespace substitution", "namespace"],
  ["reserve valid effect", null],
  ["wrong consuming actor", "missing authority"],
  ["oversized effect", "payload size"],
  ["payload substitution", "binding"],
  ["consume valid effect", null],
  ["lost-response application retry", "not available"],
  ["reuse obligation", "used"],
  ["reuse nullifier", "used"],
  ["reuse effect_id", "used"],
  ["reserve uncertain effect", null],
  ["quarantine uncertain effect", null],
  ["quarantine cannot execute", "not available"],
  ["quarantine cannot reserve again", "used"],
  ["reserve before revocation", null],
  ["actor cannot revoke", "missing authority"],
  ["principal revokes", null],
  ["revoked cannot consume", "revoked"],
  ["revoked cannot reserve", "revoked"],
  ["concurrent direct reservations", "RACE"],
  ["consume race winner", null],
  ["exhausted grant plus one", "exhausted"],
  ["expired cannot reserve", "expired"],
  ["expired cannot consume", "expired"],
  ["expired unit quarantined", null],
];
export function validateAuthorityMatrix(
  run: any,
  account: string,
  chainId: string,
  invariant: (s: any) => void,
) {
  if (
    !run.complete ||
    run.chainId !== chainId ||
    run.account !== account ||
    run.events?.length !== authorityCases.length
  )
    throw Error("Incomplete matrix");
  for (let i = 0; i < authorityCases.length; i++) {
    const [label, pattern] = authorityCases[i],
      e = run.events[i];
    if (e.label !== label)
      throw Error("Missing/reordered matrix case: " + label);
    invariant(e.before);
    invariant(e.after);
    if (
      i &&
      JSON.stringify(e.before) !== JSON.stringify(run.events[i - 1].after)
    )
      throw Error("Discontinuous state history");
    if (pattern === "RACE") {
      if (
        e.results?.length !== 2 ||
        e.signedTransactions?.length !== 2 ||
        e.results.filter((r: any) => r.block && !r.error).length !== 1 ||
        e.results.filter(
          (r: any) =>
            /exhausted/.test(r.retry?.error ?? "") &&
            !r.block &&
            r.originalStatus?.state !== "IRREVERSIBLE",
        ).length !== 1
      )
        throw Error("Invalid race evidence");
      e.results.forEach((r: any, j: number) => {
        const tx = SignedTransaction.from(e.signedTransactions[j]);
        if (r.block && String(tx.id) !== r.transactionId)
          throw Error("Race transaction mismatch");
        if (
          tx.actions.length !== 1 ||
          String(tx.actions[0].account) !== account
        )
          throw Error("Wrong race target");
        if (!r.block) {
          const retry = SignedTransaction.from(r.retry.signedTransaction);
          if (
            String(retry.id) !== r.retry.transactionId ||
            JSON.stringify(retry.actions) !== JSON.stringify(tx.actions) ||
            JSON.stringify(r.retry.before) !== JSON.stringify(r.retry.after) ||
            JSON.stringify(r.retry.after) !== JSON.stringify(e.after)
          )
            throw Error("Invalid race retry observation");
        }
      });
    } else {
      const tx = SignedTransaction.from(e.signedTransaction);
      if (
        String(tx.id) !== e.transactionId ||
        tx.actions.length !== 1 ||
        String(tx.actions[0].account) !== account
      )
        throw Error("Wrong transaction/target");
      if (pattern) {
        if (
          e.expected !== "REJECT" ||
          e.block ||
          !new RegExp(pattern).test(e.error ?? "") ||
          JSON.stringify(e.before) !== JSON.stringify(e.after)
        )
          throw Error("Invalid rejection observation");
      } else if (e.expected !== "EXECUTE" || !e.block || e.error)
        throw Error("Missing execution evidence");
    }
  }
  invariant(run.finalState);
  if (
    JSON.stringify(run.finalState) !==
      JSON.stringify(run.events.at(-1).after) ||
    run.finalState.effects.length !== 2 ||
    run.finalState.grants.length !== 4 ||
    Number(run.finalState.root[0].total) !== 10000 ||
    Number(run.finalState.root[0].available) !== 0
  )
    throw Error("Unexpected final state");
}
export function validateBuildBinding(
  deployment: any,
  build: any,
  account: string,
  chainId: string,
) {
  if (
    deployment.chainId !== chainId ||
    deployment.account !== account ||
    ["sourceSha256", "wasmSha256", "abiSha256"].some(
      (k) => !build[k] || deployment[k] !== build[k],
    )
  )
    throw Error("Deployment does not match reviewed local build/chain/account");
}
