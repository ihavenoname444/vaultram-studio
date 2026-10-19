# Architecture and evidence

## Mission and current native owner/app v2 path

Studio is an application being built for the VaultRAM ecosystem, not the VaultRAM protocol itself. The target is usable infrastructure for human builders and autonomous agents: idea → deterministic specification → understandable permission approval → verified capacity → bounded execution → canonical state → independently checkable receipt. Other networks may supply users, payments, execution or compute; Vaulta supplies authority and canonical state where that provides a real advantage. The target does not require moving every application to Vaulta.

Current v2: deterministic AppSpec → native owner/allocator coauthorization → immutable app ID/full hash registry → restricted actor grant → atomic reserve + consume → public native record → irreversible inclusion checked through a separately selected RPC. See OWNER_APP_AUTHORITY.md for deployment and live evidence. Studio now displays a manifest derived from the observed registry and grant. A specification hash identifies an app; it does not execute every descriptive feature in that specification.

The native contract enforces owner/app, actor permission, namespace, write count, payload size, expiry and revocation. These are **unbacked test write units**, not RAM-byte quotas or VaultRAM/$V positions. A request requiring `VAULTRAM_BACKED` is rejected before preparation; this local admission check does not retrofit backing into the deployed contract. Native test mode remains explicitly usable.

The gateway currently signs with a local operational key and can originate in-scope writes. It is not yet an untrusted transport-only relay. Local owner/admin files under the same OS identity are not isolated from gateway process compromise. Production requires externally controlled owner signing, isolated credentials and a verified capacity provider. No cross-chain execution or settlement is implemented. See SECURITY_ASSUMPTIONS.md and AUTHORITY_INVARIANTS.md for the implementation boundary and next steps.

## Legacy EVM-signature runtime (separate deployment)

The remaining sections describe the original EVM-signature/relayer flow. They must not be used to describe the native v2 owner/app contract above.

### Execution path

Prompt → provider produces descriptive fields → strict AppSpec v1 → reviewed deterministic template → explicit action payload → EIP-712 EOA signature → gateway validation and persistent reservation → Jungle4 transaction → RPC observations → Ed25519 receipt → independent CLI.

The provider can choose only the application name, description and accent. Entities, actions, limits and permissions come from code. Generated React source uses escaped text and callbacks; it does not evaluate model-generated JavaScript. The built-in preview binds the same specification to the Studio's fixed marketplace interface.

## Specification and hashing

One template: `agent-marketplace`, with agents, services and public memories. Actions: `createagent`, `pubservice`, `writemem`, `setstate`. No arbitrary account, action, ABI, transfer or executable-code fields are accepted. Unknown properties are rejected.

Canonical JSON sorts object keys by JavaScript string order, preserves array order, and accepts strings, booleans, null and safe integers. IDs and nonces are decimal strings. There is no Unicode normalization. The app hash is Keccak-256 of canonical AppSpec JSON. The app ID is the first 64 bits of that hash, with zero mapped to one. Full hash comparison prevents accepting a different spec under a colliding truncated ID.

Names/descriptions/memories have UTF-8 byte limits. C++ repeats field sizes, ownership, parent binding, expiry, nonce, app hash and row limits. An app has at most 1,000 state rows; runtime registration has a 64-app cap. Nonce rows persist and are never deleted.

## What a wallet authorizes

The EIP-712 domain includes the source EVM chain ID and a salt derived from destination chain, runtime account and version. The message binds owner, app ID/hash, Jungle4 chain ID, runtime account/code hash/version, policy version, action, exact canonical payload/hash, nonce, expiry and RAM admission allowance. Lifetime is at most five minutes.

A signature is authorization for the trusted gateway. It is not an EVM transaction, bridge proof, token approval or proof of origin-chain execution. EIP-1271 contract wallets and cross-chain finality verification are outside this version.

## Trust and permissions

The contract checks `relayer@relay`; it does **not** recover EVM signatures. A compromised relayer can invent owners and actions inside the contract's bounded policy. A compromised runtime administrator can upgrade the policy. A pinned code hash detects an unexpected upgrade at observation time; it cannot remove an administrator's power or prevent a race between checking and execution.

The deployment tool creates `relay` as a child permission and links it only to `runtime::execute`. Runtime admin and relayer admin keys stay in the local deployment file; only the restricted relay key goes into gateway configuration. Receipts use a separate Ed25519 key. The included demo EOA key is simulation-only.

Gateway HTTP is loopback-only with Host/Origin checks and a per-process request token on writes. These protect against ordinary cross-origin requests, not compromised local software. Do not expose it on the internet. SQLite and keys are local; backup `.data` securely if continuity matters.

## Replay and crash handling

SQLite reserves `(app, owner, nonce)` uniquely and stores the signed transaction before any broadcast. Writes are serialized in one gateway process with a bounded pending queue. Unresolved reservations or an RPC nonce behind durable local state block new signing requests. Simulation business state, nonce and receipt commit in one SQLite transaction. The C++ business row and nonce update commit in one chain transaction.

Before-broadcast preparation failure releases the reservation with a retained REJECTED record. Once a signed transaction is persisted, an ambiguous network error remains UNKNOWN. No automatic retry with a new nonce and no blind rebroadcast occurs. Reconcile queries the transaction status and then checks block inclusion and last irreversible block.

A crash with a RESERVED record and no prepared transaction requires operator review with the gateway stopped. A crash after preparation preserves the transaction ID for reconciliation. If the RPC no longer retains the transaction, use an archival RPC; do not assume failure from absence. This prototype deliberately prefers a stuck reservation over a possible duplicate write.

## RAM claims

The estimator uses canonical payload bytes plus a conservative allowance, labelled uncalibrated. It is not a measured range or a protocol-enforced hard spending ceiling. The C++ check is admission policy, not exact RAM metering.

Live receipts keep before/after payer account observations with null delta and `attributable: false`. A separate, transaction-bound `executionTrace` records the submitting RPC's RAM deltas when its trace is unambiguous. It is explicitly not independently verified. See RAM_MODEL.md for the 18-action dataset and remaining calibration limits. State and RAM observations are not historical Merkle proofs. Simulation leaves all chain/RAM fields null.

## Independent verifier

Export includes AppSpec, intent, EOA signature, receipt attestation, deployment metadata and the prepared transaction in live mode. Protocol v1 signs the code hash; ABI is separately pinned and explicitly marked `abiHashSigned: false`. A signed deployment commitment including ABI belongs to a future protocol version. Pin the Ed25519 public key via a separate trusted channel. The UI's check uses this installation's gateway key and is only a local signature check.

The CLI verifies both signatures and their binding, reconstructs the exact one-action transaction from a separately pinned ABI, checks transaction digest, current code/ABI pins, inclusion and irreversibility using an independently selected Jungle4 RPC. It still trusts that RPC; it is not a light client. It does not prove historical RAM attribution, receipt timestamp, or absence of a temporary code upgrade between observations.
