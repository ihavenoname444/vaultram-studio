# Submission/recovery proof boundary

This pass starts at `a189f9e` and changes only submission/recovery gating and reporting. It retains the operator child-permission check, owner revocation, contract replay identifiers, nonce rules and authority conservation. No contract or ABI changes, deployments, RAM/V/Mesh functionality or new live-chain evidence are included.

## Property and failure model

**No automatic second logical execution under ambiguous submission, with contract-level replay/nonce protection and explicit reconciliation.** This is not an exactly-once claim or a liveness guarantee.

The tests cover process SIGKILL, restart, RPC timeout/lost response, delayed observations, contradictory observations, concurrent requests and multiple connections to the same SQLite journal. SQLite durability/locking, retained complete journals, the pinned contract, intact keys/host and truthful finality data from the designated verification RPC are assumptions. This is not Byzantine-RPC consensus verification, a proof of complete journal history, protection against restoring an old valid backup, or cross-host consensus between independent journals.

The relevant domain is the existing native journal/grant, onboarding request journal, owner-revocation journal, or legacy app/owner nonce domain. Separately approved applications are separate domains. Emergency owner revocation remains possible while operational execution is unresolved: it reduces authority rather than retrying the effect.

## Terms

| Term                    | Meaning here                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request retry           | Repeat the API call for the same operation ID/hash. After the durable submission claim, this reads/reconciles; it does not send again.                                                                          |
| Transaction rebroadcast | Send the same signed transaction bytes again. Recovery does not do this automatically.                                                                                                                          |
| New signed intent       | New operation/request identity or nonce, requiring its own authorization. Native signing happens only after the atomic unresolved check. External wallet requests are unsigned until the owner approves.        |
| New logical execution   | Another authorized operation, even when the business payload resembles an earlier one. Recovery never creates one. Explicitly authorized distinct operations are not globally deduplicated by business meaning. |
| State effect            | Actual committed contract mutation. RPC acceptance, a signed receipt or a journal row alone is not this proof.                                                                                                  |

## Demonstrated gaps and bounded changes

- A native prepare paused in RPC could sign/store a new operation after another submission became unresolved. Native, owner and onboarding creation now perform the final unresolved check and creation under one SQLite writer transaction, without network awaits inside it.
- A recovery lock could arrive during native/onboarding submit preflight and be missed. The atomic submission claim now checks that lock too. App activation rechecks the parent lock after awaited reconciliation.
- Late send/reconcile failures could downgrade a concurrently finalized native/owner operation; onboarding had the send variant. Conditional updates preserve terminal status and evidence, and responses read current durable status.
- Legacy `SUBMITTED` was missing from unresolved gating. It now blocks new work until reconciliation establishes finality. Legacy nonce awaits also allowed another submission to appear between checks: intent creation rechecks, and reservation uses an atomic conditional insert. Stale legacy receipts cannot overwrite a finalized receipt.
- Native reconciliation responses now include `lifecycle` with explicit conservative machine semantics. This does not authorize new work or change wallet approval.

The native prepare race, native/owner late-reconcile failures, native/onboarding lock races, legacy pending-finality gate, stale legacy receipt and both legacy nonce-await races were observed failing before correction. No existing recovery assertion was removed or relaxed; original crash injection points remain unchanged.

## Twelve-case evidence matrix

| Case                               | Evidence and result                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Crash before broadcast          | Existing `native-recovery.test.ts` and `recovery.test.ts`: real child-process SIGKILL at prepared/reserved boundaries. PREPARED is not automatically sent; a durable submission claim remains unresolved.                                                                                                                                                      |
| 2. Crash during/around broadcast   | Same suites kill before/after simulated remote acceptance; restart does not send a second transaction. Remote acceptance is a fixture.                                                                                                                                                                                                                         |
| 3. Success with lost response      | Existing crash/lost-response tests plus native, owner and onboarding late-send tests. Actual WASM execution can be reconciled before the lost send response arrives; the later failure cannot erase finality.                                                                                                                                                  |
| 4. RPC timeout                     | Existing native/owner/onboarding restart tests; UNKNOWN stays blocked and repeat requests do not resend.                                                                                                                                                                                                                                                       |
| 5. RPC disagreement                | Native/app tests reject inconsistent effect bindings; the new delayed-finality test rejects claimed inclusion above observed LIB. Existing pin/permission tests include both endpoints. No majority-vote or Byzantine-node guarantee.                                                                                                                          |
| 6. Delayed inclusion/finality      | New actual-WASM tests with fixture statuses UNKNOWN/IN_BLOCK/FORKED/FAILED: no new intent or resend; later corroborated inclusion and effect can finalize. Legacy SUBMITTED also remains unresolved.                                                                                                                                                           |
| 7. Restart with unresolved journal | Existing native/legacy SIGKILL and owner/onboarding restart tests retain the operation and block new work. Missing/corrupt native journals fail closed.                                                                                                                                                                                                        |
| 8. Repeated recovery               | Repeated submit/reconcile calls in crash, delayed-finality and recovery-import tests do not broadcast. Recovery imports remain submission-locked.                                                                                                                                                                                                              |
| 9. Replay of signed intent         | Existing gateway deduplication and actual WASM runtime nonce / authority reservation-nullifier-effect tombstone tests reject replay without extra effects.                                                                                                                                                                                                     |
| 10. New intent while unresolved    | Existing competing-connection submission tests plus new prepare-await races and legacy nonce-await races. Creation/submission claims recheck at the durable boundary.                                                                                                                                                                                          |
| 11. Definitive failure, no effect  | Existing actual-WASM atomic rollback tests reject a failing second action and roll back the reservation. New revoke-during-broadcast WASM test leaves no reservation/effect. The gateway still does not infer globally definitive failure from an RPC exception: it stays UNKNOWN. Existing signature/expiry/revocation preflight tests reject before sending. |
| 12. Success then stale RPC         | New native/owner late-reconcile and all three late-send tests retain finalized status/evidence but mark fresh verification unavailable. Existing onboarding stale/finalized-block tests are retained. Legacy finalized receipts are monotonic.                                                                                                                 |

Local WASM VM execution proves behavior of the built contract under the test inputs; it is not live network inclusion. Fixture block IDs, status responses and LIB values test verifier decisions, not real irreversibility. No new live RPC or irreversible-chain observations were made in this pass.

## Machine-readable semantics

Native submit/reconcile responses retain existing `status` fields and add:

```json
{
  "lifecycle": {
    "state": "UNKNOWN",
    "nextAction": "RECONCILE",
    "reason": "SUBMISSION_UNRESOLVED",
    "automaticRetry": false,
    "automaticRebroadcast": false,
    "submissionBlockCleared": false,
    "newIntentRequiresAuthorityCheck": true
  }
}
```

| Journal/result                        | Machine state / action | Meaning                                                                                                            |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| PREPARED                              | PREPARED / STOP        | Await explicit submission/approval; no automatic send.                                                             |
| PENDING                               | SUBMITTED / RECONCILE  | Submission claimed; finality not established. WAIT between bounded reconciliation requests.                        |
| UNKNOWN                               | UNKNOWN / RECONCILE    | Reconcile the existing ID only. Timeout, FAILED/not-found status, expiry or an empty RPC lookup cannot release it. |
| IRREVERSIBLE, fresh checks pass       | FINALIZED / STOP       | Stop retrying this intent. Trusted-RPC inclusion and required effect/state checks passed.                          |
| IRREVERSIBLE, fresh check unavailable | FINALIZED / RECONCILE  | Preserve historical evidence; do not present it as fresh verification or clearance for new work.                   |

`submissionBlockCleared:true` means only that the checked lifecycle gate is clear and the journal is not recovery-locked. It is a snapshot, not an authorization token. It does **not** mean current authority, remaining capacity, expiry, permission links or a new payload are valid. A new explicit request must pass the normal preparation and submission checks again. Completed owner revocation does not clear this flag. There is intentionally no unconditional `SAFE_TO_CREATE_NEW_INTENT`/execute authorization derived from a historical receipt.

The legacy gateway retains its existing journal/receipt API: RESERVED, BROADCASTING, UNKNOWN and SUBMITTED are unresolved; REJECTED is only assigned when local transaction preparation failed before any broadcast; IRREVERSIBLE is terminal. The new `lifecycle` response is exposed by the native APIs, not retroactively claimed for legacy endpoints. Neither path asks an agent to infer success from an explorer.

## Remaining unproven cases

- Total loss/rollback of otherwise valid journals, compromised host/key, independent hosts using separate journals, or fabricated finality/state from a trusted RPC.
- Cryptographically authenticated consensus/finality and coherent historical state proofs; this pass uses trusted RPC observations.
- Releasing an UNKNOWN operation after expiry or alleged rejection without sufficient evidence of no possible effect. It deliberately remains blocked; availability is sacrificed rather than inventing certainty.
- Live crash/fork/timeout injection on Jungle4, arbitrary scheduling proof/formal verification, and global exactly-once business semantics across newly authorized identities.

## Reproduction

```sh
REQUIRE_OWNER_APP=1 REQUIRE_AUTHORITY=1 REQUIRE_WASM=1 npm test
npm run build
```

All three existing WASM artifacts are required; absence is a failure, not a silently skipped contract proof. Tests generate disposable fixture keys and never require a wallet, owner private key, token transfer or live RPC.
