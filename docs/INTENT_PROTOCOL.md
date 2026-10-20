# Signed intent protocol v1

The authoritative definitions are IntentSchema, intentTypes and typedData in packages/core/src/index.ts. Never reconstruct a signing payload from this prose alone.

Domain name is VaultRAM Studio; version is 1. Domain chainId is the wallet’s external EVM identity context. Domain salt hashes destination chain, runtime account and version. A signature is not an EVM transaction, payment approval or proof that anything happened on that source chain. Positive source chain IDs up to 2147483647 are accepted as identity contexts; no origin-chain consensus is verified.

The signed message binds owner, app ID/full hash, Jungle4 destination, runtime account/code hash/version, policy, action, canonical payload and its hash, nonce, expiry and RAM admission allowance. Owner addresses are lowercase. ABI pins are verified by the gateway/verifier but are not an additional signed message field. Only EOA signatures are supported; EIP-1271 is not implemented.

Lifetime is at most 300 seconds, normally 240. IDs are decimal strings, 1 through uint64 max. Nonces start at one and must increase exactly by one; uint64 max is rejected to prevent overflow. Expiry and nonce are checked by gateway and contract. Changing app, destination, runtime, payload or source identity context invalidates the original signature.

SQLite uniquely reserves app/owner/nonce. The chain commits business state and nonce together. Once a signed Vaulta transaction is saved, an ambiguous response stays UNKNOWN. Reconciliation verifies actual inclusion and irreversibility. Do not blindly rebroadcast or advance the nonce to resolve uncertainty. Expired exact replays are rejected; valid duplicate requests return their existing local record.

The runtime stores latest nonce/intent hash per app and owner, plus business state. Full origin context, payload and signatures reside in the local export and chain action data; the current table is not a complete historical audit log. Back up local evidence securely and provide an archival RPC for long-term verification.
