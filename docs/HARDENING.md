# Phase 0 hardening record — 2026-10-15

## Changes prompted by the technical review

- Browser review binds returned intent to the displayed app, owner, chain, runtime/code hash, action, canonical payload and exact allowance. It rechecks before signing and checks account/chain again afterwards. Finality is green only for IRREVERSIBLE.
- RPC requests, including SDK calls, have a 15-second timeout. Chain ID is rechecked before transaction preparation; block numbers and RAM usage reject invalid numeric responses.
- Queue depth is bounded. HTTP responses disable caching and MIME sniffing. A different full app hash cannot overwrite an existing truncated app ID.
- Reservations cannot be released after preparation/broadcast. Unresolved operations and stale RPC nonces block new intents. The stale-nonce condition was observed during the real calibration run and then reproduced in regression coverage.
- Five separate child processes are killed with SIGKILL after reservation, after preparation, before acceptance, after acceptance and before receipt persistence. Restart preserves reservations, avoids rebroadcast, and reconciles accepted transactions. The chain in these tests is deliberately simulated; gateway, SQLite, signatures and process death are real.
- AI output is a strict descriptive-field schema before merging into the fixed app template. Tests cover unexpected fields, invalid values, UTF-8 limits, repair and incomplete responses. These are provider-response fixtures, not 20–50 tests of an actual language model.
- Receipts validate their complete schema and cross-field consistency, even when a malformed claim has a valid signature. Simulation cannot claim chain metrics; trace transaction IDs must match.
- New proof exports contain deployment metadata. ABI hash remains separately pinned, not signed by protocol v1. The CLI reconstructs the exact action using the pinned ABI.
- Execution traces replace account differences as the primary reported RAM observation. See RAM_MODEL.md for 18 samples and trust limits.

## Dependency check

The production dependency audit reported zero known advisories at the recorded check. The full development tree reported one low-severity advisory, GHSA-848j-6mx2-7j84, in elliptic through the VeRT/test-only SDK dependency; no fixed release was reported. The production Wharfkit 4.0.2 signing implementation uses noble curves. This is a time-bound dependency check, not proof of absence of vulnerabilities or an external security audit.

## Remaining acceptance gates

A human-operated external wallet is unverified. The demo operator has chosen manual ChatGPT collaboration instead of an integrated AI service, so real AI-provider calls are outside current demo acceptance. The automated provider remains unverified. No paid API calls, payment authorization or mainnet operations were performed. Creating a test EOA does not substitute for testing the user's wallet. Current UI supports injected EIP-1193 wallets; WalletConnect/mobile pairing is not implemented.

The 18-sample RAM matrix is insufficient to promote a model to calibrated production estimation. Historical trace retrieval is unavailable at the two tested endpoints. Account observations and receipt state commitments are not independently verified historical state proofs. The runtime still trusts the relayer and administrator. The gateway remains loopback-only. Production/mainnet needs a separate design and independent audit.
