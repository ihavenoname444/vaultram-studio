# Native authority in Studio

The Studio now has a native-authority workspace for public memory writes. It uses a real native actor and a narrowly delegated signing key, not an EVM owner asserted by the relayer. The original Templates / EVM demo remains a separate legacy path and retains its documented relayer trust.

## Deployment and acceptance

- Dedicated Studio contract: `vrsdgugozrrz`, Jungle4. The previous proof account `vradqgskurpl` was left unchanged.
- Identical reviewed authority WASM: `343556dd7fc819985b2b17d42035bbf7268d9dde3733ef63c1145363b03be716`.
- Native actor: `rlnmfc13nj2m@vrstudio`; principal: `vrya3iayygzy`.
- Deployment: block 292387292, transaction `9cb639752a7c306b60b2f841cc4b68156fd7e528f9c877e5f8e3104afe1cc756`.
- Grant 1: 100 bounded public writes, namespace `memory`, expires 2026-10-23 16:03:15 UTC. One acceptance write consumed one unit; 99 remain. The contract holds 9,899 unallocated root units after the separate one-unit revocation test.
- UI acceptance transaction: `214828ad7a0300fe32c437b3d328859717650e331483a0eae1a0a1c4becb1ff3`, irreversible block 292387751, effect 88867197012966.

The actual browser flow passed: prepare, review exact payload and native grant, execute, reconcile via independent CryptoLions RPC, export, reload and inspect the same effect and counter. The downloaded browser export also passed the separate command-line verifier. No MetaMask interaction or AI-provider call was involved.

The initial integration suite passed 76 tests with both WASM artifacts required, including six integration-safety tests. These cover UTF-8 size and app binding, grant bounds, persisted-before-broadcast ordering, ambiguous submission plus restart without resend, expired/tampered review and deployment-journal substitution. The separate AI reviewer identified the journal/domain binding gap; it was fixed and rechecked with no remaining blocker in that targeted review. This is not an external audit.

Live API checks rejected a missing session token, foreign origin and changed review hash. Replaying the completed operation returned the same transaction without another effect. Direct native transactions from the restricted key failed to create grants or transfer tokens. A separate grant 2 was created, reserved, revoked by the principal, and then could not be consumed. Failed RPC attempts and unchanged snapshots are observations, not irreversible rejection receipts. The three successful revocation-test transactions were independently checked for executed irreversible inclusion.

## Signing and recovery boundary

The native adapter reads only the restricted agent key from a local configuration file. It does not load the principal or deployment keys. Setup uses those keys in a separate operator CLI. The `vrstudio` permission is linked only to this contract's reserve and consume actions. Startup and submission verify its exact key, threshold, parent and links; direct key reuse and same-account permission references are rejected.

Preparation creates one signed transaction containing reserve and consume, with identical IDs and a payload hash. Execution commits both atomically. The public record includes the selected application ID; its content and that binding together must fit within 256 UTF-8 bytes. The native grant is scoped to the memory namespace, not to a particular application ID: a compromised agent key can write other content/app identifiers within that same bounded namespace. It cannot increase its grant's capacity.

SQLite records the signed transaction before broadcast and claims it with a conditional state update. The journal is bound to the deployment, grant, actor, permission, public key and pins. Exact actions, digest and signature are revalidated before use. Repeated execution or reconciliation never resends an operation. An uncertain outcome blocks preparation of additional operations until resolved. There is intentionally no automatic retry, automatic release, or abandonment after expiry; an unresolvable failed submission requires operator investigation. Cached irreversible evidence is marked historical if a fresh verification becomes unavailable.

The gateway remains loopback only, with host/origin checks and a per-session request token. The local operator controls signing and can use the full delegated budget; this is not noncustodial user-wallet authorization. Production principal controls, separate operators and native-wallet onboarding remain open.

## Run and verify

For this configured local installation:

```sh
pnpm demo:authority
```

Open the existing local Studio URL. Native authority is the default workspace; Templates / EVM demo switches to the old workflow. Configuration and keys live under ignored `.data/authority-studio/`; the operation journal lives in the demo data directory. Do not copy those directories into a public release.

For a fresh deployment, build the authority artifacts first, then use the explicit operator steps `scripts/setup-authority-studio.ts provision` and `deploy`. They create a new account and a seven-day grant; never point them at mainnet. The current setup spent 76 free test EOS (70 RAM, 5 CPU and 1 NET), funded through the official Jungle faucet. This is not a mainnet price estimate.

Read-only export verification requires no private key:

```sh
node --import tsx scripts/verify-native.ts browser-export.json vrsdgugozrrz
```

Pin the expected account and reviewed build separately. The verifier checks the exact reserve/consume actions and their binding to the payload, grant, actor, permission and reservation; transaction digest; independent executed irreversible inclusion; current code/ABI pins; and the resulting protected rows. The archived grant snapshot is context, not an independently authenticated historical grant proof.

The operator acceptance runner `scripts/test-native-studio.ts OUTPUT_DIRECTORY` requires a completed browser write and an unused revocation-test grant ID 2. It is not an automatic test or a safe blind rerun. It uses local administrator keys only for the dedicated grant/revocation test.

## What this establishes—and what remains

We have demonstrated an end-to-end Studio public-memory write bounded by native contract authority, with independent inclusion/effect verification and replay-safe local handling. Agent creation, service publication and status updates in the old template are not migrated. Full arbitrary-agent execution, cross-domain conservation, native-wallet onboarding, external security audit, code-upgrade governance, V economics and comparative benchmarks remain open.

V is not used by this implementation. It supports a concrete security argument for the tested mechanism; it does not establish that Vaulta is the safest chain, that everyone should connect, or that V is economically necessary. Those claims need defined threat models, competitor baselines and additional evidence. See AUTHORITY_PROOF.md for contract limitations, including global-ID squatting and immutable quarantine.

The subsequent security pass passed 83 tests and hardened private-file serving, concurrent submission guards and evidence validation. See HARDENING.md for findings, verification and remaining production blockers.
