# VaultRAM Studio

**Owner control and recovery:** Anchor signing adapter for native owner-signed revocation and conservative journal recovery are implemented and locally tested. OS isolation is a fail-closed launch recipe that cannot activate in this executor; real external-wallet signing and key-custody migration remain unverified. See [details and limitations](docs/OWNER_SIGNING_RECOVERY.md).

A local development studio for a bounded agent marketplace: describe an app, compile a versioned specification, sign an action, inspect state, export evidence.

**Current delivery:** a verified Jungle4 owner/app authority slice, alongside the earlier Phase 0 core and explicitly labelled local simulation. The current suite passes 142 tests with all three WASM builds required. Legacy history includes 26 irreversible application transactions, four manually confirmed MetaMask actions and two prior Linux browser tests. The legacy runtime trusts its relayer; this is not production infrastructure.

**Architecture/security alignment:** Studio now presents actual grant limits and explicitly unavailable VaultRAM backing. Requests requiring backed authority fail before signing. Direct hostile-signer tests demonstrate both rejected scope expansion and successful arbitrary content inside a grant. Gateway/owner custody is still local, not isolated. See [assumptions and delivery plan](docs/SECURITY_ASSUMPTIONS.md) and [all 18 directive invariants](docs/AUTHORITY_INVARIANTS.md).

**Owner/app v2:** native owner consent, immutable app/spec registration, app-bound grants and typed owner/app receipts are now connected through Studio and verified on a new Jungle4 deployment. The browser write and 16 live/API acceptance checks passed. Start the configured demo with `pnpm demo:owner-app`. See [owner/app evidence and limits](docs/OWNER_APP_AUTHORITY.md). This is an independent application intended for VaultRAM; V and VaultRAM RAM leasing are not yet integrated.

**Native Studio integration:** Public memory now has a real native-authority workspace. Prepare, execute, reconcile, export and reload passed on Jungle4 using a restricted agent key. Start the configured local demo with `pnpm demo:authority`. See [Native Studio](docs/NATIVE_STUDIO.md) for the exact scope and signing trust. The older EVM template remains separate.

**Separate native authority proof:** a second Jungle4 contract now enforces principal grants, conserved capacity, reserve/consume, revocation, expiry and quarantine. Its 33-case live matrix completed; deployment plus 14 successful matrix transactions passed independent inclusion checks. Rejections remain RPC observations. This is a narrow Aegis proof, not integration into Studio or a claim that V/A is the safest crypto. See [the authority report](docs/AUTHORITY_PROOF.md).

## Start

Requires Node 22.16+ and pnpm 11.25.0. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173. Choose **Compile application → Deploy locally → Use demo signer → Prepare action → Run simulation**. Publish a service, write a public memory, update status, inspect state, check a receipt signature, and export evidence. State survives restart.

The application is VaultRAM-branded and lives in `apps/studio`. Nothing needs to be hosted on Unicove. Unicove is a separate resource-management interface.

The example works without accounts or paid APIs. Optional OpenAI configuration in `.env` enables structured descriptive fields. Without both a key and model, the assistant explicitly loads a fixed example; it does not pretend to interpret the prompt.

## Prepared Jungle4 demonstration

For the already configured dedicated test deployment, run `pnpm demo:check` and then `pnpm demo`. Open the same loopback URL in Chrome with a new empty MetaMask wallet. This mode forces Jungle4 and disables paid AI calls. It reuses `.env.jungle4` without copying keys and stores demo receipts in `.data/demo-jungle4`. Follow [the wallet walkthrough](docs/WALLET_DEMO.md). No deposits or EVM gas are required.

## Commands

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm test:e2e
pnpm exec tsx scripts/package-sources.ts
pnpm preflight
pnpm exec tsx scripts/build-contract.ts
pnpm exec tsx scripts/deploy.ts inspect
```

See [deployment](docs/DEPLOYMENT.md), [protocol and trust](docs/ARCHITECTURE.md), [verification record](docs/VERIFICATION.md), and [next milestones](docs/ROADMAP.md).

## Review the proof

Read [Reality](docs/REALITY.md), [Threat model](docs/THREAT_MODEL.md), [AppSpec](docs/APP_SPEC.md), [Intent protocol](docs/INTENT_PROTOCOL.md), [RAM model](docs/RAM_MODEL.md), [Demo](docs/DEMO.md), and [Implementation plan](docs/IMPLEMENTATION_PLAN.md).

GitHub Actions did not allocate a runner. The official CDT build, repeated artifact comparison, required WASM tests and Linux browser tests passed independently using free infrastructure. Actions is optional and manual-only.

## Layout

- `apps/studio`: React/Vite workspace, preview, state inspector and signing review.
- `packages/core`: strict AppSpec, fixed template compiler, canonical serialization and EIP-712 policy.
- `services/gateway`: loopback-only API, SQLite journal, optional AI, receipt signer and Jungle4 adapter.
- `contracts/vaulta-runtime`: C++ multi-index runtime, bounded rows and persistent nonces.
- `scripts`: build, deploy, preflight and independent evidence verification.
- `tests`: signature, persistence, owner-scope and UI coverage.

## Operational boundaries

Public small records only. No USDC, payments, bridging, origin-chain execution, smart-contract wallets, autonomous agents, reputation engine or production SLA. The gateway validates EOA signatures; the contract trusts the relayer. The runtime administrator remains able to upgrade or pause the contract.

Keep `.data` and `.env*` private. They contain local keys and state. The gateway must remain bound to loopback; this release is a single-user local tool, not a multi-tenant hosted service. Never reuse the demo signer for real assets. Testnet keys are dedicated to Jungle4.

The latest security pass passed **83 tests** and hardened private-file access, unresolved submission handling and evidence verification. See [the hardening record](docs/HARDENING.md) for concrete findings and remaining production blockers. This remains a testnet prototype, not a security certification or proof of comparative chain superiority.
