# Aegis accounting in Studio

This independent application is being built for the VaultRAM/V ecosystem. Aegis is the author's reference implementation, not an official VaultRAM standard. Studio now uses its actual, unmodified v0.0.17 `conservationReport()` for a narrow read-only accounting check. It does not create a substitute verifier or claim full Aegis acceptance.

## Reproduce without Studio or keys

From a reviewed checkout, with Node 22.16+:

```sh
npm ci --prefix packages/verifier --ignore-scripts
node packages/aegis-bridge/check.mjs cryptolions
node packages/aegis-bridge/check.mjs greymass
node --test packages/aegis-bridge/test/*.test.mjs
```

The bridge uses only the standalone verifier's locked dependencies. No wallet, environment file, API key or signing process is required. Exit 0 means this accounting check completed; it does not authorize execution. Nonzero exit means invalid or inconclusive, with no successful accounting report.

Studio exposes `GET /api/authority/aegis` and a **Check with Aegis** button. The route uses a fixed public RPC and validates the configured deployment against the reviewed profile. It accepts no query parameters or caller-provided proof, capacity, source or RPC URL. It is deployment-wide and independent of app recovery/session state. Concurrent requests share only an in-flight read; later requests read fresh state. Failed refreshes remove the previous displayed result. JSON observations can be downloaded.

## What the check does

1. Pin chain, contract code and serialized ABI; read every root, app, grant, reservation and effect row twice, rejecting pagination, instability and inconsistent relationships.
2. Validate the complete native test ledger with the existing standalone validator.
3. Check the vendored kernel's SHA-256 before executing those exact bytes. Source, commit and license are recorded in `packages/aegis-bridge/provenance.json`.
4. Project root/grant available balances into holders, and native one-write reservations into RESERVED, CONSUMED and QUARANTINED buckets.
5. Run the real upstream function and cross-check every accounting total against the native validator. Bind the report to the normalized observation digest.

Revoked and expired grants still contribute retained balances. Their inclusion in conservation is not permission to execute. Released reservations are not represented by this native contract; the released counter is zero. This projection is not a complete executable Aegis state.

## Recorded validation — 20 October 2026

`docs/evidence/owner-app-v2/aegis-accounting.json` contains fresh matching observations from CryptoLions and Greymass at approximately 14:28 UTC:

- Root total and accounted: 10,000 UNBACKED_TEST_WRITE units.
- Available: 9,997; reserved: 1; consumed: 2; quarantined: 0.
- Digest: `4dcbfc6d8472049c39fcbec8997ba9b17b8b4956375f9f234da5ff27d4ce8b79`.
- 161 Studio/contract tests, 152 standalone verifier tests and 15 bridge tests passed; contract WASM tests were required, not skipped. Typecheck and production build passed.
- Independent agent review checked upstream byte identity, projection, source integrity and assurance boundaries. Its finding about app-context journal coupling was corrected: the audit route checks the root configuration without resolving a child context.
- Live HTTP checks confirmed successful audit with an unrelated context header and rejection of provider-query injection and POST. Browser testing confirmed the real report and caught a React key collision, corrected using a unique panel-key prefix.

This is development review and test evidence, not a professional external security audit.

## What remains

The report deliberately returns `executionAuthorized: false`, `aegisPolicyVerdict: NOT_EVALUATED` and `vaultRamBacking: UNAVAILABLE`.

Full Aegis evaluation still needs authenticated authority history and accepted universe/root/policy bindings. Production enforcement also needs complete mediation, custody isolation and recovery/upgrade controls. Matching RPC snapshots are not an atomic authenticated checkpoint and cannot establish these claims.

Actual V integration requires VaultRAM's authoritative deployed contract/interface, network and code/ABI version; V position or lease identity and its owner; the specified capacity unit and backing rules; allocation/encumbrance, release, expiry and revocation semantics; and a test environment with test positions. V token ownership alone must not be interpreted as allocated usable RAM. The current write budget has no V/RAM-byte conversion.

The next self-contained milestone is a specified authority-event/history binding with adversarial replay tests. Agree that interface before inventing certificates or adding a new chain. Connect a V backing adapter only after the upstream capacity interface can be verified.

## Current test-resource issue

Both public RPCs reported zero available CPU for `rlnmfc13nj2m`, while NET had approximately 30 KB available. Request additional Jungle4 CPU delegation before more transaction demos. Read-only audits need no account CPU. The current local UI verification session blocks transaction endpoints; restart the normal `npm run demo:owner-app` after resource preflight succeeds. No mainnet funds are needed for these tests.

## Check an exported report offline

After installing the standalone dependencies above, verify a single JSON report downloaded from Studio or produced by the live CLI:

```sh
node packages/aegis-bridge/verify-recorded.mjs EXPORTED_REPORT.json
```

This recomputes accounting from the supplied snapshot and requires the entire reported Aegis result, source pin, deployment profile and digest to match. Altered totals, V backing, authorization or extra Aegis certificates fail. A consistent result is labeled RECORDED_ACCOUNTING_CONSISTENT, with chainStateAuthenticated=false and currentStateChecked=false. A fabricated but internally consistent snapshot can still pass: offline checking does not prove that data came from the chain. Use the live CLI separately for a fresh RPC observation. Neither mode establishes an authenticated checkpoint.

The CLI reads a regular JSON file of at most 2 MB, returns nonzero on failure, and does not echo malformed input or local filesystem paths. The input is one {observation,aegis} report, not the two-provider comparison wrapper.

On 20 October 2026, a clean public download of commit 136f25b91f83bad9bfee3320aa12a23ce44729fc installed only the verifier's five locked transitive/direct packages (install scripts disabled), then reproduced the live digest above without Studio, local configuration or keys. The follow-on recorded-report verifier was tested against that clean dependency installation. All 28 bridge tests passed (15 existing, 13 new); independent agent review found no blocker. This follow-on changes no signing or execution code.

## Verify the lifecycle and accounting together

```sh
node packages/aegis-bridge/verify-flow.mjs packages/verifier/examples/jungle4-external-lifecycle.json cryptolions
node packages/aegis-bridge/verify-flow.mjs packages/verifier/examples/jungle4-external-lifecycle.json greymass
```

This read-only composition forces the reviewed external-v2 deployment profile. It checks signed consent locally before network access, audits the complete ledger, runs the existing lifecycle verifier with its current-row queries bound to that exact ledger, then audits again. Block inclusion, code/ABI and chain metadata come from the same selected RPC. An allowlisted snapshot adapter supplies only the exact app/grant/reservation/effect rows; it does not perform separate filtered RPC queries that could describe a different ledger. Returned rows are cloned and normalized without mutating the audited snapshot.

Success requires equal whole-ledger digests across the lifecycle checks and nonregressing head/irreversible metadata throughout the observation window. Any ledger change or window regression is inconclusive; no automatic retry, provider fallback or submission occurs. Malformed evidence or mismatched consent/state/inclusion fails. CLI exit codes: 0 = bounded observed-flow checks passed, 1 = invalid, 2 = unavailable/inconclusive. Existing claim levels are preserved, including recorded-only historical denial and RAM traces.

The result includes the exact signed registration, write and revocation transaction IDs plus app/hash/owner/grant/reservation identifiers and observation digest. Its status is `OBSERVED_LIFECYCLE_ACCOUNTING_MATCH`, **not** full Aegis acceptance. `authenticatedCheckpoint`, `completeAuthorityHistory` and `executionAuthorized` remain false. All test budgets remain unbacked test-write units.

Both live provider runs matched on 20 October 2026 at approximately 14:41 UTC / 16:41 Amsterdam. Public results are in [combined-flow.json](evidence/owner-app-v2/combined-flow.json). Twelve additional adversarial tests cover altered consent, incorrect owner/revocation/payload/inclusion, changes to unrelated grants, code swaps, provider loss and regressing observation windows. All 40 bridge tests and 152 standalone verifier tests passed. No contract, signing, Studio session or execution-path change was required.

Equal sampled reads do not detect all transient changes or prove state at a particular block. This composition is an incremental consistency check; it does not close the authenticated-history work item below.

Independent agent review of the combined verifier found no blocking issue and independently ran all 40 bridge tests. Its review did not use live RPC; the two live provider runs above were performed separately. The 12 new tests also passed with the isolated standalone dependency installation.
