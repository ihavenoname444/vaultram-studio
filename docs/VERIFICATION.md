# Verification record

Recorded during implementation on 2026-10-15. This file distinguishes checks from intended capability.

## Confirmed so far

- Final TypeScript checking, production Vite build and formatting checks pass.
- 24 automated tests pass: protocol binding, UTF-8/uint64 boundaries, persistent gateway and atomic replay/owner handling, RPC finality handling, and independent CLI positive/tampering checks. Four WASM tests are skipped locally because artifacts are absent; CI requires them.
- In-app-browser manual flow compiled the example, activated local runtime, created an agent, published a service, wrote a memory, updated status and verified the receipt signature. All three rows and four receipts remained after reload.
- Mobile viewport 390×844 passed a visual layout check; document width equals viewport width (390 px), with no horizontal overflow. Desktop view was restored.
- Exported simulation evidence passes the independent CLI. Local evidence is excluded from publication; the CLI test creates its own ephemeral keys and evidence.
- Two dedicated Jungle4 accounts were created through the official faucet and read back through RPC; operational details remain local.
- A child permission was linked to runtime execution and its transaction inclusion and irreversibility were verified. Reconciliation handles the observed difference between a preliminary block number and actual inclusion.

## Not yet confirmed

- The C++ runtime has not yet compiled, passed WASM tests, or been deployed.
- No real Jungle4 application state write, RAM calibration or live receipt verification has occurred.
- No external browser wallet was used; simulation used a local demo EOA and real cryptographic signatures.
- OpenAI integration is implemented but no key/model was supplied, so no provider call was tested.
- Standalone Playwright failed to start Chrome in this desktop sandbox. This is an environment startup failure, not a passing E2E result. Manual browser checks are separate.

Official CDT Linux binaries cannot run directly on ARM macOS. The old x86 macOS binary requires unavailable architecture support; the IDE remote compiler failed DNS resolution. An experimental local Zig/CDT-header combination failed and produced no deployable artifact. No untested substitute binary was deployed.
