# Verification record

Recorded during implementation on 2026-10-15. This file distinguishes checks from intended capability.

## Confirmed so far

- Final TypeScript checking, production Vite build and formatting checks pass.
- 56 automated tests pass with REQUIRE_WASM=1 and none skipped: protocol binding, UTF-8/uint64 boundaries, persistent gateway and atomic replay/owner handling, RPC finality handling, independent CLI positive/tampering checks, source publication exclusion/secret/symlink checks, and execution of the actual compiled WASM in VeRT.
- Official CDT 4.1.1 compiled the runtime in a free temporary Binder Linux session. Two builds produced byte-identical WASM and ABI files. Only public contract source was uploaded; deployment keys stayed local. Build hashes and reproduction instructions are in BUILD_PROOF.md.
- In-app-browser manual flow compiled the example, activated local runtime, created an agent, published a service, wrote a memory, updated status and verified the receipt signature. All three rows and four receipts remained after reload.
- Mobile viewport 390×844 passed a visual layout check; document width equals viewport width (390 px), with no horizontal overflow. Desktop view was restored.
- Exported simulation evidence passes the independent CLI. Local evidence is excluded from publication; the CLI test creates its own ephemeral keys and evidence.
- Two dedicated Jungle4 accounts were created through the official faucet and read back through RPC; operational details remain local.
- A child permission was linked to runtime execution and its transaction inclusion and irreversibility were verified. Reconciliation handles the observed difference between a preliminary block number and actual inclusion.

## Browser and recovery checks

Two Playwright tests passed in free Binder Linux with the Playwright Chromium headless shell. They cover compile/deploy, simulation, receipt check, export, reload/persistence, mobile-width overflow, all four actions through a controlled EIP-1193 test provider, and rejection of substituted review data before any signature. Local macOS browser startup was blocked by the OS sandbox; the successful Linux run is separate evidence. Only audited public source was uploaded; no deployment keys or local operational data were sent.

Five SIGKILL recovery cases are included in the 56-test suite. They use real gateway processes, SQLite and cryptographic signatures against a controlled fake chain. See HARDENING.md for the exact boundaries.

Reproduce on a Linux host with Node 22+: `pnpm install --frozen-lockfile`, `pnpm exec playwright install --with-deps chromium`, `pnpm test:e2e`. The test configuration uses dedicated loopback ports and a fresh data directory, forces simulation and disables AI-provider credentials.

## Live Jungle4 proof

The reviewed WASM and app registration are irreversible. All four actions executed through the live gateway, producing three rows and nonce 4. Independent verification through CryptoLions RPC checked EOA and receipt signatures, exact intent-to-transaction binding, pinned code/ABI and irreversible inclusion for all four transactions. An additional 18-action, two-owner matrix is irreversible and passes the same independent verifier. The gateway submitted through Greymass RPC. Keys remained local. This is RPC-based verification, not a trustless light-client proof.

## Not yet confirmed

- External browser-wallet integration remains untested.
- RAM traces are recorded for 18 additional irreversible actions, with a versioned dataset in RAM_MODEL.md. Historical RAM trace verification and held-out estimator validation remain open.
- No external browser wallet was used. Live tests used a separate locally generated EOA and real EIP-712 signatures.
- OpenAI integration is implemented but no key/model was supplied, so no provider call was tested.
- A real human-operated wallet application is still untested. The automated browser provider uses an ephemeral EOA; it does not validate MetaMask or mobile-wallet UX.

Official CDT Linux binaries cannot run directly on ARM macOS. Earlier local and IDE alternatives did not produce artifacts. The successful Binder build uses the official Linux compiler and its pinned package checksum.

## Public review and CI

Source is published for review in https://github.com/ihavenoname444/vaultram-studio/pull/1. An explicit source allowlist excludes private environment, keys, databases and local operational records. Source packaging uses the same audit.

GitHub did not allocate a runner: initial runs and a retry stopped before any build step because of an account-level restriction. The successful build and checks were performed independently of GitHub Actions. No payment was made. The workflow still requires WASM tests when a runner is available.
