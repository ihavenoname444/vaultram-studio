# Jungle4 deployment

Use two dedicated testnet accounts: one runtime administrator and one relayer. The fixed destination is Jungle4, chain ID `73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d`.

Create accounts through the official Jungle4 faucet and retain private keys locally. Initial resources may not cover contract deployment; request free test tokens/RAM before deployment. Mainnet spending is outside this setup.

## Reproducible build

Use official Antelope CDT 4.1.1 on Linux x86_64. The GitHub workflow builds this standalone repository with read-only GitHub permissions and without deployment keys.

```sh
pnpm exec tsx scripts/build-contract.ts
```

Expected artifacts: `contracts/build/runtime.wasm` and `runtime.abi`. Run the WASM tests before deployment. A C++ source file alone is not a deployed runtime. The optional `--remote` build sends only runtime.cpp to the Vaulta IDE compiler, but that service was unavailable during initial setup; its compiler identity is not attested.

## Keys and permissions

`pnpm exec tsx scripts/testnet-keys.ts` creates new dedicated keys only if the private manifest is absent. Existing local keys must be preserved. `.data/testnet-keys.json` is private and excluded from source distribution. It is needed only for deployment/admin tasks.

```sh
pnpm exec tsx scripts/deploy.ts inspect
pnpm exec tsx scripts/deploy.ts permissions
pnpm exec tsx scripts/deploy.ts deploy
pnpm exec tsx scripts/deploy.ts register
```

The deploy script refuses a wrong chain or an account that already contains code. Deployment bundles setcode, setabi and init. It writes `.env.jungle4` with only the relay key and code/ABI pins; it never copies admin keys into the gateway environment. Registration defaults to the example AppSpec, or accepts a supplied `app.spec.json` path.

Stop the local server, securely copy `.env.jungle4` to `.env`, then start `pnpm dev`. The gateway refuses live mode if pins/configuration are missing or do not match RPC. Use a browser with an injected EVM wallet; the Codex in-app browser may not have one. Compile the same spec, select **Verify deployment**, connect the external wallet, review and sign. Check finality until irreversible.

## Verify evidence

Copy the receipt public key to a separately trusted location before collecting evidence. The private signer is never part of export.

```sh
pnpm verify evidence.json independently-pinned-receipt-public.pem
```

For live evidence additionally set `VERIFY_RPC`, `VERIFY_CODE_HASH`, `VERIFY_RELAYER`, and `VERIFY_ABI_PATH`. Choose a separately operated Jungle4 RPC and the reviewed local ABI. Verification fails closed if transaction inclusion or irreversibility cannot be established.

## Resource costs

Jungle4 uses faucet resources with no real monetary value. The observed account creation grants CPU/NET stake and about 4 KiB purchased RAM, with additional protocol accounting reflected by RPC. Contract code/ABI, app registration, state rows and persistent nonces require more RAM. Measure actual payer deltas before budgeting.

Local simulation has no per-action blockchain cost. AI calls only occur when you configure both an API key and model and explicitly compile; their provider charges are separate. Mainnet RAM prices fluctuate and must be quoted at deployment time; this package makes no fixed-cost mainnet promise.

## Recovery

Keep the gateway stopped during SQLite maintenance. Preserve the database, receipt signer and testnet manifest together in a private backup. Never release an UNKNOWN nonce merely because the RPC timed out. Reconcile by stored transaction ID and verify with an archival RPC if necessary. RESERVED without a prepared transaction indicates a pre-broadcast interruption, but operator review is required before release. No destructive reset command is included.
