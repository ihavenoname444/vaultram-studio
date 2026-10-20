# External owner signing, custody and recovery

## Delivered scope

Studio has an Anchor wallet adapter and a developer handoff for **native owner-signed grant revocation**. It prepares one unsigned `revoke` action, exports the Antelope transaction and accepts a returned public signature. No owner private key or seed is accepted by this path. It supports only the current configured Jungle4 owner/app/grant and simple 1-of-1 `active` authority; multisig/delegation fail closed. [External registration and grant approval](OWNER_ONBOARDING.md) are now implemented for the configured owner with a separate journal per app/grant; local WASM tests pass and a fresh live app/grant, write, external revocation and denied agent attempt are verified.

The gateway reconstructs the exact action/authorization, checks the chain-bound signing digest, expiry, owner/app/grant/code binding and current active public key. It rejects additional actions, extensions, wrong signers/chains, key rotation after review and owner keys reused as its operational key. The signed transaction is persisted before broadcast. Unknown results are reconciled without automatic resend. The native contract—not the signature UI—enforces revocation.

Revocation intentionally does not require the operational agent permission to remain healthy. Current code pins and app/grant ownership are still required. The UI retains the owner control panel when the operational authority overview fails. This is not recovery from a hostile upgraded contract or an offline chain.

Local tests generate a separate owner key and execute signed revocation against actual owner/app WASM; their network/finality responses are fixtures. Separately, a real Anchor ceremony succeeded on Jungle4 on 2026-10-19, followed by a live post-revocation denial test on 2026-10-20. The exact chain, signer, encoded transaction and recovered active key were checked before submission. Revocation was verified irreversible; a subsequent restricted-agent reserve was rejected with grant revoked and unchanged table snapshots from both RPCs. See the [demo guide and public evidence](OWNER_AUTHORITY_DEMO.md).

The adapter uses official WharfKit SessionKit with in-memory sessions, Jungle4 only, exact owner@active matching, broadcast disabled and transaction modification disabled. MetaMask's EVM signature is not a substitute for this native Antelope signature. Full owner custody and operating-system isolation remain unverified.

## Using Anchor

1. Keep owner and active private keys in your separately controlled wallet and verify that its public keys are actually bound to the native Jungle4 account. Installing Anchor or connecting an unrelated account does not transfer custody. Back up keys privately before any reviewed on-chain rotation.
2. Connect Anchor before preparing the short-lived request. Select the configured native owner account and its active permission on Jungle4.
3. Prepare unsigned revocation, select Sign with Anchor and review the actual contract, revoke action and owner@active authorization in the wallet. Signing alone does not broadcast.
4. Submit the checked signature in Studio. On timeout use Reconcile; wait for irreversible verification and then confirm the revoked agent cannot write.

The on-chain active-key rotation and real-wallet revocation drill are verified; complete owner custody migration remains unfinished. The app never requests a seed or private key.

## Using the developer handoff

1. In Owner control, prepare unsigned revocation. Review the native owner, grant, exact contract, Jungle4 chain and two-minute expiry.
2. Export the request. In a separately trusted native signer, independently decode and review the actual transaction action and authorization; descriptive request text and a raw digest are not sufficient human review. Sign `Transaction.from(request.transaction).signingDigest(request.chainId)` only after verifying the fields. Never copy an owner key into Studio or chat.
3. Return only the public `SIG_K1_…`/`SIG_R1_…` signature. Studio submits the exact stored transaction and verifies irreversible inclusion/current revoked state through its separately selected RPC.
4. On timeout, use Reconcile. Do not create a replacement transaction to work around an unknown result.

Only grant revocation is supported. It stops future reserve/consume, including reserved work; it does not delete completed public records, transfer funds, rotate keys or remove the application's ownership. Existing admin/upgrade/RPC trust remains.

## Process isolation: prepared, blocked here, NOT established

`scripts/isolate-gateway.ts` provides a macOS Seatbelt launch recipe with a deny-default profile, code/dependency read allowlist, exact operational-config access, one writable data directory, restricted process execution and a sanitized environment. It starts the gateway alone; Vite must be started separately and receives no gateway environment. Owner/admin files are not allowlisted. Implicit `.env` loading is disabled for this path. A disposable outside-directory read canary must be denied before any restricted operational configuration is loaded; any activation/probe failure aborts without an unsandboxed fallback.

Both implementation and independent-review probes returned `sandbox_apply: Operation not permitted` inside the current executor. The new launcher also stopped as intended. **The policy's successful activation, runtime compatibility, complete file/IPC/process isolation and resistance to sandbox escape remain unverified.** A passing canary alone is not a complete audit. This recipe does not isolate the entire host, protect against administrator compromise or move keys into a hardware wallet.

From an ordinary macOS terminal in the repository, the next host check is:

```sh
node --import tsx scripts/isolate-gateway.ts --probe
```

Only after reviewing/proving the boundary, stop the prior gateway and use the launcher without `--probe`; run Vite separately with a clean environment. Verify denial of owner/admin files, symlink aliases, process inspection, unintended IPC and writes outside the data directory before relying on it. Linux production should use a separately restricted user/container or VM, with external owner signing and no owner/admin secret mounted into the gateway. Existing plain demo startup remains an explicitly unisolated developer mode.

The original isolation pass did not move, delete or rotate owner/admin keys. The later active-key rotation is recorded below; owner recovery authority remains unchanged. Deleting local recovery material before an external wallet is verified would risk losing control.

## Journal startup and recovery

The native gateway now opens an **existing journal by default**. Missing/zero-byte/corrupt/identity-less journals or missing required tables fail closed. Schema versions distinguish a compatible older-journal migration from missing current tables. Stored transaction bindings/statuses are checked on startup. Explicit `create` is for a genuinely new deployment/test fixture only; it must never be used as a repair for a live journal. Database integrity checks cannot detect every malicious deletion of otherwise valid rows or prove complete history.

Schema initialization, domain identity and recovery lock creation commit together. A crash during initialization leaves an unusable incomplete journal, not an accepted empty history. Existing databases are migrated without changing their domain fingerprint or signed transactions.

A valid exported native write can reconstruct an operation in a separate **submission-locked recovery journal**:

```sh
node --import tsx scripts/recover-native.ts OPERATIONAL_CONFIG EXPORT_JSON SEPARATE_RECOVERY_DIRECTORY
```

The imported transaction must match the configured domain and restricted signer. Claimed success in the export is ignored: import starts UNKNOWN, then independently checks chain inclusion and state. RPC failure leaves UNKNOWN. This does not broadcast, restore owner-operation history, prove completeness, or automatically permit new writes. Even after one receipt is verified, the recovery journal remains locked. A failed import also leaves its initialized destination locked. Use trusted complete backups or a separately reviewed migration/new grant to resume service; no automatic unlock or capacity release exists.

For backups, stop all writers and copy a consistent SQLite backup (including WAL handling), not only a live `.sqlite` file. Keep backups outside the gateway's writable boundary. This pass does not implement a general backup service or prove recovery after total loss without any retained transaction evidence.

## Verification and remaining work

`tests/native-recovery.test.ts` kills a real gateway process with SIGKILL after preparation, before remote acceptance, after simulated acceptance and after UNKNOWN persistence. Restart preserves the status and does not resend uncertain work. Remote acceptance is a fixture, not live Jungle4. Additional tests reject corrupted/missing files, lost tables and tampered signed rows; restore an exported write through fresh chain checks; and preserve the submission lock across failed imports/restarts.

`tests/owner-app-studio.test.ts` covers owner signatures, wrong keys/chains/actions, stale or unsupported authority, unhealthy agent permission, operational/owner key reuse, actual WASM revocation, and owner-request timeout/restart without resend. Independent review found and prompted fixes to the emergency-revocation dependency and recovery initialization/table checks.

Remaining production gates: full owner-controlled custody; live verification of external registration/grant approval with both allocator and owner signatures; validated OS/deployment isolation; full backup-loss and key-rotation drills; upgrade governance; verified VaultRAM backing. No new live revocation or deployment is claimed by these local tests.

`tests/owner-wallet.test.ts` adds seven local cryptographic boundary tests for exact signatures, request domain, changed wallet transactions, signer/key/chain mismatch, expiry and missing connected wallet. Independent code review also inspected the installed SDK broadcast behavior; it found no blocker in this narrow adapter scope.

The Anchor adapter verifies the SDK's encoded `resolved.transaction`, not its decoded display transaction, so verification needs no inferred action ABI. A regression test covers the real SDK response shape with decoded action data. Fail-closed diagnostics distinguish chain, signer, transaction-byte, signature-count and recovered-public-key mismatches; no private keys are logged. Full suite: 143 tests with all three WASM builds required. Real-wallet revocation is now separately verified; see the current status above and chronological record below.

## Historical diagnostic (superseded by successful revocation) — 2026-10-19

The active authority of vrya3iayygzy was rotated to the user-supplied active public key in transaction ba3b9397cc74051448c8b01da8c70bb331c7051694083357a8e3277874c25ff8, block 292905995; a separate RPC had irreversible block 292906026 when checked. The original owner recovery authority remains unchanged. This is partial custody migration, not complete key isolation.

Anchor connected as vrya3iayygzy@active, but its signature for prepared request 00a85b86-bbe7-4794-97ed-96824ee05560 recovered the public key intended for owner instead of the current on-chain active key. The adapter rejected it before broadcast. This establishes a wallet/key binding mismatch, not a transaction failure on Jungle4. The exact transaction, chain, signer and signature-count checks passed before the public-key check failed.

Correct the wallet's local active-key association using the separately backed-up active key. Do not change on-chain authority or bypass signature verification to accommodate the incorrectly imported wallet. Then repeat a fresh, user-approved revoke, submit the checked signature, independently verify irreversibility and test rejection of subsequent delegated writes. These checks were pending at this diagnostic stage; see the subsequent completion record. No private key was read or included in this diagnostic.

## Local wallet binding repaired — 2026-10-19

The incorrect local Anchor account record was removed with user authorization, retaining both saved keys. Anchor used https://jungle4.api.eosnation.io and displayed a failed connection. A direct public lookup through https://jungle4.greymass.com/v1/chain/get_accounts_by_authorizers returned vrya3iayygzy@active for the intended active public key. After switching Anchor to that node, automatic detection found the same account under that key; the user authorized its import.

Anchor closed during the password/import flow, but after reopening, its public Key Management view showed the intended active key (6MVH…) linked to one account and the intended owner key (8J18…) linked to zero. Both keys remained listed. The preceding account overview contained vrya3iayygzy and showed no currently selected account. This verifies the saved local association, not a successful signing ceremony or complete custody migration.

The local macOS crash report records Anchor 1.3.12 running translated through Rosetta, EXC_BAD_ACCESS/SIGSEGV, with V8 frames on the faulting thread. The root cause is not established. No Anchor executable or private key was modified or published. At this stage the signing and denial tests were pending; they subsequently passed. Wallet crash stability remains unverified.

## Live owner revocation verified — 2026-10-19

A fresh Anchor session returned a valid signature from the intended 6MVH… active key. Exact chain, signer, transaction bytes and recovered key checks passed. Following user approval, request 1a9632f0-39e7-4621-aad1-ba0686181988 was submitted. Initial UNKNOWN was reconciled without resubmission to IRREVERSIBLE through the separate verification RPC. Transaction 999bf2b693577eec1d48940106302ef271129b0b3208fe17fde8f08d620b7927 executed in irreversible block 292914270. The verified current grant 1 on vralzuwmebbx has revoked=1. Both saved wallet keys remain present.

This completes the real-wallet revocation ceremony. It does not establish full owner-key custody migration, operating-system isolation or resolution of the Anchor crash. The post-revocation denial test was completed on 2026-10-20 and is documented in the demo guide.

## Optional immediate submission after wallet approval

Owner revocation offers an explicit, default-off “Submit immediately after checked wallet approval” option. When selected, the browser verifies the returned Anchor signature and exact transaction before posting it once to the existing journaled endpoint. Manual signing/export remains available. This removes a chat/manual-submit delay without extending the 120-second transaction lifetime, changing wallet consent, accepting owner secrets, or retrying an uncertain submission. If the response is unknown, reconcile the existing request.
