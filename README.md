# VaultRAM Studio

A local development studio for a bounded agent marketplace: describe an app, compile a versioned specification, sign an action, inspect state, export evidence.

**Current delivery:** functional local simulation with real EIP-712 intent signatures, persistent SQLite state and Ed25519 receipts. Jungle4 integration and C++ runtime are provided; consult `docs/VERIFICATION.md` for what has actually run. Simulation is always visibly labelled and never claims blockchain execution.

## Start

Requires Node 22.16+ and pnpm 11.25.0. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173. Choose **Build example application → Deploy locally → Use demo signer → Prepare action → Run simulation**. Publish a service, write a public memory, update status, inspect state, check a receipt signature, and export evidence. State survives restart.

The application is VaultRAM-branded and lives in `apps/studio`. Nothing needs to be hosted on Unicove. Unicove is a separate resource-management interface.

The example works without accounts or paid APIs. Optional OpenAI configuration in `.env` enables structured descriptive fields. Without both a key and model, the assistant explicitly loads a fixed example; it does not pretend to interpret the prompt.

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
