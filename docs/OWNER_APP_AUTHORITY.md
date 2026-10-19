# Owner/app authority v2 — verified Jungle4 slice

This is an independent application intended for the VaultRAM ecosystem. It does not implement the VaultRAM protocol, RAM leasing or V economics. The working slice is **native owner → registered Studio app → delegated grant → bounded public memory → verifiable receipt**.

## What changed

V1 bound a native actor and namespace but treated app ID as opaque payload metadata. V2 registers an immutable native owner and full Studio specification hash on chain. Its canonical app identity is `(chain ID, contract account, app ID)`; identical numeric IDs on other deployments are unrelated.

- `regapp` requires the root allocator and native app owner to authorize with `active`. Neither party can attribute an app to an unrelated owner without consent. Registration count is bounded by root capacity.
- `grant` requires both parties again and derives the owner from the registry. App ID, actor, exact delegated permission, namespace, write budget, expiry and payload limit are immutable.
- `reserve` checks the typed app ID against the grant. `consume` derives app and owner from that grant, checks expiry/revocation again and commits the protected effect and budget spend atomically.
- Only the app owner can revoke or quarantine. Revocation stops reserved work; completed effects are not reversed and spent/quarantined units are not recycled.
- Owner/app routing fields are not inferred from public JSON content. Content mentioning a different app cannot move the effect there.
- Gateway prepare, submit, reconciliation, UI and standalone verifier bind the same registry/grant/effect. The local compiled specification must match both app ID and full registered hash.

Native account ownership is separate from legacy MetaMask identity. Registration is not proof of ownership of an EVM/Solana wallet. An app specification commitment also does not establish that all its features or policies are executed by this small memory contract.

## Build and live evidence — 2026-10-19

Official CDT 4.1.1 compiled the public source twice in temporary free Binder Linux infrastructure. Outputs were byte-identical; the session was shut down. No private keys were uploaded.

| Artifact | SHA-256                                                            |
| -------- | ------------------------------------------------------------------ |
| Source   | `c7c4a1588dddbf1b903a801bbb3af69db741d83090b807dcc1b0cc0e04d13255` |
| WASM     | `fadd779a8decc9c09e78cde0369c4aa7fff611ea7a39e36af9ce560564b75557` |
| ABI JSON | `fe8d8cb20c46b9c0f5a6f5ea23756e7b64602a784a1cee28ea0104fcd3cd7fb7` |

- New contract: `vralzuwmebbx`, Jungle4 only. V1 contracts and proof artifacts remain unchanged.
- Deployment transaction: `b641fa6cab5c3d05d77f8c5497a1734393c007442ce7cd7b38efb42461297a00`, irreversible block **292894061**.
- Example app: **Agent Commons**, ID `7707187089270261976`, native owner `vrya3iayygzy`.
- Specification hash (Keccak-256 of canonical validated AppSpec): `6af56dd2c16e48d8dac6cfc93c3b51f37d48b77c083acf4ba3fb27a551ae2d98`.
- Actor: `rlnmfc13nj2m@vrapp`, a newly generated separate key/permission linked only to this contract's `reserve` and `consume`.
- Grant 1: 100 bounded writes, memory namespace, max 256 payload bytes, expiry **2026-10-26 14:33:15 UTC**. One UI write consumed one unit; 99 remain at verification.
- UI write transaction: `77faae605bd7e167347474a1f1f86e3ef80d34e0df96cd8be1ec1d1de15e8a75`, irreversible block **292894234**, effect `42779262017618`.
- Submitting RPC observed **1,293 RAM bytes** for this transaction and **99 payload bytes**. This includes contract bookkeeping; it is not a marginal storage price, independently verified RAM trace or demonstrated V saving.
- Provisioning used **91 free test EOS**: 85 RAM, 5 CPU, 1 NET. No mainnet assets, paid API or GitHub runner was used. This is not a mainnet cost estimate.

The standalone verifier used CryptoLions independently of the submitting Greymass RPC to check transaction digest, exact typed actions, executed irreversible block inclusion, current code/ABI pins, immutable app/grant binding and protected effect/reservation rows. RPC/consensus and contract upgrade administration remain trusted; this is not a light-client proof of historical execution code.

## Verification scope

The full local suite passed **115 tests**, with legacy runtime, v1 authority and v2 authority WASM all required (no skipped contract suites). V2 includes 17 direct WASM tests and five gateway/binding tests. Gateway integration tests execute the signed transaction actions in WASM; their RPC/finality responses are explicitly fixtures, not live evidence.

The separate live acceptance run completed **16 checks**: three HTTP rejections, replay returning the same effect, eight direct chain rejections with unchanged table snapshots, and four successful independently confirmed transactions. These cover owner consent, cross-app substitution, grant escalation, transfer isolation, namespace substitution, atomic rollback and revoke-after-reserve. The second application's registration was co-signed by distinct real native owner and allocator accounts. Rejected attempts are RPC observations, not finalized rejection receipts.

An independent AI agent reviewed the model and implementation and separately ran the 17 WASM tests. No blocking owner/app authorization bypass was identified in that review. This is a targeted review, not an external production audit.

## Reproduce

```sh
pnpm exec tsx scripts/build-authority.ts owner-app-v2
REQUIRE_WASM=1 REQUIRE_AUTHORITY=1 REQUIRE_OWNER_APP=1 pnpm test
pnpm typecheck
pnpm build
pnpm demo:owner-app
node --import tsx scripts/verify-native.ts export.json vralzuwmebbx
```

Build legacy artifacts separately with `build-contract.ts` and `build-authority.ts` before running the full required suite. No artifacts means failure when the corresponding REQUIRE flag is set. Public live evidence is under `docs/evidence/owner-app-v2/`.

Fresh operator setup uses `scripts/setup-owner-app.ts provision` then `deploy`. It uses `.data/owner-app-studio/`, refuses existing deployed code and creates a separate key/permission. `pnpm demo:owner-app` uses `.data/demo-owner-app/` for its journal. Neither directory belongs in a release. The web gateway receives only restricted signing keys. If setup outcome is uncertain, reconcile the saved signed transaction before recovering configuration; never blindly repeat setup or overwrite v1.

`scripts/test-owner-app.ts OUTPUT_DIRECTORY` is an explicit one-run operator acceptance harness. It expects the fresh deployment, unused test grant 2, unused app ID immediately following the example ID, and a completed UI write. It journals signed actions before sending and refuses an existing acceptance file. Do not run it against unrelated deployments or repeatedly against an ambiguous result.

## Remaining boundaries and next step

The local operator still holds the owner's/admin keys outside the gateway. Native wallet approval and self-service owner onboarding are not implemented. The UI cannot register arbitrary apps or issue grants by itself. Legacy template agent/service/status actions retain their separate relayer model. An agent key can use every grant explicitly assigned to its actor/permission pair; separate keys/permissions are needed for isolation between apps at the key level. Parent account authorities retain ultimate native control.

The contract provides bounded public writes, not dollar limits, a byte RAM lease cap, arbitrary execution, arbitrary multichain authority or a hosted multi-tenant service. Global reservation IDs can be squatted; grants/rows are append-only; ambiguous failed submissions still need operator reconciliation. Code-upgrade governance, resource exhaustion, owner recovery and independent production audit remain open.

Next: add native-wallet owner registration and grant/revoke approval using this verified contract boundary. In parallel, obtain VaultRAM's actual leasing flow, RAM payer/permissions, reclaim/expiry terms and how V participates. Integrate those observed interfaces without inventing a V requirement. This proof makes no comparative claim that Vaulta is the safest chain.
