# Phase 0 hardening record — 2026-10-15

## Changes prompted by the technical review

- Browser review binds returned intent to the displayed app, owner, chain, runtime/code hash, action, canonical payload and exact allowance. It rechecks before signing and checks account/chain again afterwards. Finality is green only for IRREVERSIBLE.
- RPC requests, including SDK calls, have a 15-second timeout. Chain ID is rechecked before transaction preparation; block numbers and RAM usage reject invalid numeric responses.
- Queue depth is bounded. HTTP responses disable caching and MIME sniffing. A different full app hash cannot overwrite an existing truncated app ID.
- Reservations cannot be released after preparation/broadcast. Unresolved operations and stale RPC nonces block new intents. The stale-nonce condition was observed during the real calibration run and then reproduced in regression coverage.
- Five separate child processes are killed with SIGKILL after reservation, after preparation, before acceptance, after acceptance and before receipt persistence. Restart preserves reservations, avoids rebroadcast, and reconciles accepted transactions. The chain in these tests is deliberately simulated; gateway, SQLite, signatures and process death are real.
- AI output is a strict descriptive-field schema before merging into the fixed app template. Tests cover unexpected fields, invalid values, UTF-8 limits, repair and incomplete responses. These are provider-response fixtures, not 20–50 tests of an actual language model.
- Receipts validate their complete schema and cross-field consistency, even when a malformed claim has a valid signature. Simulation cannot claim chain metrics; trace transaction IDs must match.
- New proof exports contain deployment metadata. ABI hash remains separately pinned, not signed by protocol v1. The CLI reconstructs the exact action using the pinned ABI.
- Execution traces replace account differences as the primary reported RAM observation. See RAM_MODEL.md for 18 samples and trust limits.

## Dependency check

The production dependency audit reported zero known advisories at the recorded check. The full development tree reported one low-severity advisory, GHSA-848j-6mx2-7j84, in elliptic through the VeRT/test-only SDK dependency; no fixed release was reported. The production Wharfkit 4.0.2 signing implementation uses noble curves. This is a time-bound dependency check, not proof of absence of vulnerabilities or an external security audit.

## Remaining acceptance gates

A human-operated external wallet is unverified. The demo operator has chosen manual ChatGPT collaboration instead of an integrated AI service, so real AI-provider calls are outside current demo acceptance. The automated provider remains unverified. No paid API calls, payment authorization or mainnet operations were performed. Creating a test EOA does not substitute for testing the user's wallet. Current UI supports injected EIP-1193 wallets; WalletConnect/mobile pairing is not implemented.

The 18-sample RAM matrix is insufficient to promote a model to calibrated production estimation. Historical trace retrieval is unavailable at the two tested endpoints. Account observations and receipt state commitments are not independently verified historical state proofs. The runtime still trusts the relayer and administrator. The gateway remains loopback-only. Production/mainnet needs a separate design and independent audit.

## Native Studio security pass — 2026-10-16

This is a tested prototype, not a production security certification. The pass found and fixed two concrete boundary gaps:

- The development server inherited workspace-wide filesystem access. Sensitive `.data` JSON files were not included in Vite's default deny list, and a synthetic canary test showed that a symlink in a served directory could bypass the first hardening attempt. Explicit frontend-only roots, private-file deny rules and canonical-path checks now cover direct URLs, raw imports and public-directory symlinks. CORS is disabled; frame embedding is denied. Test canaries contained no real credentials. No evidence of actual key exfiltration was found; this was not a retrospective forensic audit. Vite remains a development server, not a production security boundary.
- Preparing two operations before the first submission became uncertain allowed the second to bypass the preparation-time unresolved guard. Submission now checks unresolved operations too, and claims the journal slot with one conditional SQL update. Two independent SQLite connections competing for prepared submissions produce at most one broadcast.

Additional hardening rejects malformed grant counters, expiry and limits rather than trusting JavaScript numeric coercion. The gateway and standalone verifier share positive integer/finality checks, exact block identity and executed-transaction inclusion checks, and all effect/reservation bindings. Saved UI evidence displays its verification timestamp and explicitly asks for reconciliation for a fresh check.

Validation: 83 tests passed across 13 files with both contract WASM artifacts required and no skips; typecheck, production build and formatting passed. The actual authority WASM was tested with reserve and consume in a single transaction: a substituted payload failed and rolled back the reservation and counters, followed by one successful bounded write. Native permission tests reject widened links, changed keys/thresholds/parents, waits and same-account authority reuse. HTTP filesystem tests use synthetic canaries, not real keys. The hardened CLI independently reverified the existing irreversible browser acceptance transaction without another chain write.

The production dependency audit reported zero known advisories. The full dependency audit still reports the test-only low-severity elliptic advisory GHSA-848j-6mx2-7j84 with no patched release reported. A separate AI agent inspected the changed boundaries and found no additional blocker; it did not run the tests and is not an external audit.

### Production blockers remain explicit

The contract upgrade administrator and principal still have powerful keys. Local operator custody, same-actor grants, namespace-only scope (application IDs are data, not on-chain app isolation), globally shared caller-selected IDs, finite RAM provisioning and permanent quarantine remain limitations. Cross-account delegation of the agent key cannot be comprehensively discovered by this gateway. Code pins are observations, not protection against an administrator upgrading between verification and execution. Independent RPC verification still trusts that RPC and consensus; it is not a light-client proof. A compromised authorized agent can spend its delegated capacity on unwanted public content.

Production requires a separately reviewed administrator/key-management design, native-wallet authorization, recovery and incident handling, hostile multi-actor testing, resource/availability limits, and an external security audit. Agent/service/status legacy flows are not migrated. Neither V's necessity nor comparative superiority over other chains is established. Do not use real funds or private content in this prototype.
