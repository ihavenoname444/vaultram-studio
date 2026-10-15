# Reality and trust

## REAL, verified locally

The deterministic compiler validates AppSpec v1 and produces inspectable React source and manifests from controlled templates. Real EOA signatures use EIP-712 and are verified cryptographically. The local gateway persists state, nonces and Ed25519-signed receipts. Tests cover tampering, replay, ownership and expiry. The browser flow and mobile layout were manually exercised.

## SIMULATED

The default mode is SIMULATED. The demo signer is a locally generated EOA, not an external browser wallet. State is in local SQLite. Transaction IDs, block numbers and actual RAM fields are null. Fixture compilation returns the same example regardless of prompt and is visibly labelled FIXTURE. These are not evidence of a Jungle4 application write.

## TESTNET infrastructure, separately verified

Two dedicated Jungle4 accounts exist. A child relayer permission was created and linked to runtime execution; that permission transaction was verified irreversible. No real-money transfer is required. Account creation does not establish the application proof.

## IMPLEMENTED, not yet verified live

The C++ runtime compiled with official CDT 4.1.1 in a free Binder Linux session. Repeated builds are byte-identical and all four actual-WASM VeRT tests pass; the full suite passes 37 tests without skips. GitHub Actions remains unavailable, but is no longer needed for this build. Jungle4 deployment, application writes and independent live receipt verification remain pending. The primary real-wallet-to-real-state acceptance criterion is therefore open.

The OpenAI provider is configurable, but no provider call has been tested with a user key. No injected external-wallet signing flow has been tested. RAM estimates are uncalibrated; no actual application RAM delta has been measured.

## TRUSTED IN PHASE 0

The gateway verifies EVM signatures; the contract trusts the relayer. It does not recover EVM signatures. The runtime administrator can upgrade code. RPCs supply chain observations. The receipt signer attests observations, not a trustless proof. Independently pin its key and the runtime ABI/code, and use an independent RPC to verify exports. The gateway must remain on loopback.

## PLANNED

Reputation beyond agent status, payments, interoperable messaging, Solana/exSat adapters, arbitrary application templates, scoped autonomous authority, managed RAM, finance and token economics are not implemented. No independent security audit has occurred. “Reviewed template” means reviewed during implementation, not externally audited.
