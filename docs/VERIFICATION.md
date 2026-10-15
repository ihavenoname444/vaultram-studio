# Verification record

Recorded during implementation on 2026-10-15. This file distinguishes checks from intended capability.

## Confirmed so far

- Final TypeScript checking, production Vite build and formatting checks pass.
- 37 automated tests pass with REQUIRE_WASM=1 and none skipped: protocol binding, UTF-8/uint64 boundaries, persistent gateway and atomic replay/owner handling, RPC finality handling, independent CLI positive/tampering checks, source publication exclusion/secret/symlink checks, and execution of the actual compiled WASM in VeRT.
- Official CDT 4.1.1 compiled the runtime in a free temporary Binder Linux session. Two builds produced byte-identical WASM and ABI files. Only public contract source was uploaded; deployment keys stayed local. Build hashes and reproduction instructions are in BUILD_PROOF.md.
- In-app-browser manual flow compiled the example, activated local runtime, created an agent, published a service, wrote a memory, updated status and verified the receipt signature. All three rows and four receipts remained after reload.
- Mobile viewport 390×844 passed a visual layout check; document width equals viewport width (390 px), with no horizontal overflow. Desktop view was restored.
- Exported simulation evidence passes the independent CLI. Local evidence is excluded from publication; the CLI test creates its own ephemeral keys and evidence.
- Two dedicated Jungle4 accounts were created through the official faucet and read back through RPC; operational details remain local.
- A child permission was linked to runtime execution and its transaction inclusion and irreversibility were verified. Reconciliation handles the observed difference between a preliminary block number and actual inclusion.

## Live Jungle4 proof

The reviewed WASM and app registration are irreversible. All four actions executed through the live gateway, producing three rows and nonce 4. Independent verification through CryptoLions RPC checked EOA and receipt signatures, exact intent-to-transaction binding, pinned code/ABI and irreversible inclusion for all four transactions. The gateway submitted through Greymass RPC. Keys remained local. This is RPC-based verification, not a trustless light-client proof.

## Not yet confirmed

- External browser-wallet integration remains untested.
- RAM calibration remains open: immediate per-action account observations returned zero despite aggregate growth; these are not evidence of zero RAM cost.
- No external browser wallet was used. Live tests used a separate locally generated EOA and real EIP-712 signatures.
- OpenAI integration is implemented but no key/model was supplied, so no provider call was tested.
- Standalone Playwright failed to start Chrome in this desktop sandbox. This is an environment startup failure, not a passing E2E result. Manual browser checks are separate.

Official CDT Linux binaries cannot run directly on ARM macOS. Earlier local and IDE alternatives did not produce artifacts. The successful Binder build uses the official Linux compiler and its pinned package checksum.

## Public review and CI

Source is published for review in https://github.com/ihavenoname444/vaultram-studio/pull/1. An explicit source allowlist excludes private environment, keys, databases and local operational records. Source packaging uses the same audit.

GitHub did not allocate a runner: initial runs and a retry stopped before any build step because of an account-level restriction. The successful build and checks were performed independently of GitHub Actions. No payment was made. The workflow still requires WASM tests when a runner is available.
