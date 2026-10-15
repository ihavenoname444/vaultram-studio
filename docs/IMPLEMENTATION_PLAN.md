# Implementation plan and acceptance gates

This record describes the current implementation and remaining work. It is not a claim that all milestones passed.

## Decisions

Use a standalone public repository, separate from the existing Aegis project. Keep one local gateway process and one reviewed bounded runtime, with a strict TypeScript core. React/Vite provide the Studio; Zod validates specifications and actions; viem handles EIP-712; Wharfkit serializes/signs Vaulta transactions; SQLite persists local state and reservations; Ed25519 protects receipt integrity. Exact dependency versions and pnpm lockfile are committed. GitHub Actions pins actions and the official CDT package checksum.

The trusted-computing base includes the gateway, relayer key, runtime administrator, RPCs, dependencies and local host. No bridge or origin-chain consensus proof is claimed. No tokens or paid financial operations are part of the test.

## Increments

1. Strict spec/compiler, simulation, persistent nonce/ownership checks, UI and signed exports: implemented and locally tested.
2. Runtime source, VeRT tests, Jungle4 adapter and deployment tools: implemented; actual WASM execution passes in VeRT.
3. Official CDT build and required WASM tests: completed outside GitHub Actions using free Binder Linux. Two builds are byte-identical; all 37 tests pass without skips.
4. Dedicated testnet deployment, exact app registration, four locally signed EOA actions, irreversible state writes and independent receipt verification: completed. External injected-wallet UI remains separate.
5. Repeated RAM measurement and calibration, external injected-wallet UI exercise, provider integration call and automated browser suite: pending infrastructure/configuration.
6. External security review and production operating model: separate project before mainnet.

## Test strategy

Unit/integration tests cover canonical spec/hash binding, UTF-8/uint64 boundaries, signature tampering, expiry, gateway replay/ownership atomicity, persistence, finality and independent receipt verification. Runtime tests require the actual WASM artifact in CI and cover all four actions plus authorization, expiry, pause, bounds and atomic failures. Manual browser checks are recorded separately from the Playwright suite, which could not start Chrome in the local sandbox.

CI must pass install, publication audit, compiler, typecheck, required runtime/unit tests, production build and formatting. A runner that never started is neither a pass nor a contract failure. Static lint and broader observability are hardening gaps; current typecheck/format are not mislabelled as lint.

## Open risks

Uncalibrated RAM; trusted relay/admin upgrade powers; local-only HTTP; unavailable historical transaction RPC; ambiguous broadcast recovery; no real provider or external wallet exercise; no external security audit. Completion requires evidence for the real loop, not a polished simulation.
