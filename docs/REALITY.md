# Reality and trust

**Owner control and recovery:** Anchor signing adapter for native owner-signed revocation and conservative journal recovery are implemented and locally tested. OS isolation is a fail-closed launch recipe that cannot activate in this executor; real external-wallet signing and key-custody migration remain unverified. See [details and limitations](OWNER_SIGNING_RECOVERY.md).

**Current owner/app milestone:** the separate [v2 Studio native-authority flow](OWNER_APP_AUTHORITY.md) is built and live-tested on Jungle4. Native owner consent and immutable app scope are enforced on chain; 143 local tests pass, with 16 earlier live/API acceptance checks recorded separately. The manifest/security pass changes no deployed contract. Historical counts and legacy relayer trust below describe earlier components, not v2 ownership. Native-wallet onboarding, V integration and production deployment remain open.

**Current security boundary:** [SECURITY_ASSUMPTIONS.md](SECURITY_ASSUMPTIONS.md) distinguishes native test-write conservation from verified VaultRAM backing, which is missing. The local signer can originate in-scope writes; same-user owner/admin files are not isolated from process compromise. [AUTHORITY_INVARIANTS.md](AUTHORITY_INVARIANTS.md) maps the directive's 18 requirements to actual evidence and gaps.

## REAL, verified locally

The deterministic compiler validates AppSpec v1 and produces inspectable React source and manifests from controlled templates. Real EOA signatures use EIP-712 and are verified cryptographically. The local gateway persists state, nonces and Ed25519-signed receipts. Tests cover tampering, replay, ownership and expiry. The browser flow and mobile layout were manually exercised.

## SIMULATED

The default mode is SIMULATED. The demo signer is a locally generated EOA, not an external browser wallet. State is in local SQLite. Transaction IDs, block numbers and actual RAM fields are null. Fixture compilation returns the same example regardless of prompt and is visibly labelled FIXTURE. These are not evidence of a Jungle4 application write.

## TESTNET infrastructure, separately verified

Two dedicated Jungle4 accounts exist. A child relayer permission was created and linked to runtime execution; that permission transaction was verified irreversible. No real-money transfer is required. Account creation does not establish the application proof.

## LIVE TESTNET core, verified

The C++ runtime compiled with official CDT 4.1.1 in a free Binder Linux session. Repeated builds are byte-identical and all six actual-WASM VeRT tests pass; the full suite passes 56 tests without skips. GitHub Actions remains unavailable, but is no longer needed for this build. The runtime and app are now deployed on Jungle4. The original four real EIP-712 signed actions produced three state rows. Eighteen additional actions in calibration-v1 are also irreversible, with all 22 transactions verified through a separately operated RPC. Four subsequent human-confirmed MetaMask actions also passed independent verification and reload checks, bringing the original runtime record to 26. Mobile-wallet UX remains untested.

The OpenAI provider is configurable, but no provider call has been tested with a user key. A controlled EIP-1193 provider exercises browser signing separately from a human wallet application. RAM execution traces are now recorded for 18 actions, but are submitting-RPC observations, not independent historical trace proofs. Admission estimates remain uncalibrated pending held-out validation.

## TRUSTED IN PHASE 0

The gateway verifies EVM signatures; the contract trusts the relayer. It does not recover EVM signatures. The runtime administrator can upgrade code. RPCs supply chain observations. The receipt signer attests observations, not a trustless proof. Independently pin its key and the runtime ABI/code, and use an independent RPC to verify exports. The gateway must remain on loopback.

## PLANNED

Reputation beyond agent status, payments, interoperable messaging, Solana/exSat adapters, arbitrary application templates, integration of scoped autonomous authority into Studio, managed RAM, finance and token economics are not implemented. No independent security audit has occurred. “Reviewed template” means reviewed during implementation, not externally audited.

## Separate native authority proof

A dedicated Jungle4 contract implements native-principal grants, conserved write capacity, reservation, atomic consumption, revocation, expiry and irreversible quarantine. It is separate from the Studio EVM-owner flow. See [AUTHORITY_PROOF.md](AUTHORITY_PROOF.md) for pins, evidence and the remaining Aegis gaps. It establishes neither cross-domain conservation nor V token necessity.
