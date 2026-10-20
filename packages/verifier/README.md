# Jungle4 evidence checker for the Aegis work

A small, read-only bridge between the Studio demo's public evidence and an
external reviewer. This directory runs by itself: **no Studio, gateway, wallet,
private key, `.env`, database, TypeScript compiler or contract build is needed**.
Requires Node.js 22.16+ and npm. Dependencies are installed from the included
lockfile; install scripts are disabled.

## Run

Copy/download this directory, then run inside it:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs examples/jungle4-lifecycle.json --offline
node verify.mjs examples/jungle4-lifecycle.json --rpc cryptolions
```

For a second separately selected RPC:

```sh
node verify.mjs examples/jungle4-lifecycle.json --rpc greymass
```

No transactions are signed or sent. Network calls are limited to public chain
information, code/ABI hashes, blocks and table reads. The evidence cannot
choose endpoints or local files. Only the two explicit Jungle4 RPC selections
are supported in this version; there is no automatic fallback that hides a
failed or disagreeing endpoint.

Exit codes:

- `0`: the selected checks passed; **read individual claim levels**.
- `1`: invalid/inconsistent evidence, profile mismatch or invalid command.
- `2`: RPC verification unavailable/inconclusive. Never treat this as a pass.

Offline returns `OFFLINE_CHECKS_PASSED`; online returns
`PUBLIC_CHAIN_CHECKS_PASSED`. Neither is a general security certification or
permission to execute. The JSON output can be saved and shared.

## What is checked

The bundled `profile.json` pins one reviewed Jungle4 deployment, owner/app/grant,
native signers, code and ABI. Review these pins independently; a bundle cannot
replace them. The package and its dependencies are part of the reviewer's trust
boundary. This version deliberately does not accept arbitrary deployments.

| Claim                                                        | Result class and meaning                                                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Signatures and exact native actions                          | `VERIFIED_LOCAL`: chain-bound signature recovery against pinned keys; exact write reserve/consume, owner revoke and denied reserve bodies |
| Successful write and revoke                                  | `VERIFIED_RPC`: selected RPC reports executed inclusion in the expected irreversible blocks                                               |
| Current code/ABI and state                                   | `VERIFIED_RPC`: current pins, app binding, revoked grant, conservation of that grant's counters, retained reservation/effect              |
| Historical rejected attempt                                  | `RECORDED_ONLY`: saved error and matching snapshots are internally consistent, but their provenance/submission is not authenticated       |
| RAM bytes                                                    | `RECORDED_ONLY`: saved submitting-RPC trace; not independently measured, a byte quota, lease or V claim                                   |
| Full AppSpec and historical registration/grant consent       | `NOT_CHECKED`: the app hash is pinned, but the full specification/creation transactions are not part of this format                       |
| Historical code/permission keys                              | `NOT_CHECKED`: current pins and recovered signatures cannot establish these histories                                                     |
| VaultRAM backing, V economics, general cross-chain authority | `UNSUPPORTED`                                                                                                                             |

Historical RPC statements are not authenticated merely because they are in a
signed-transaction bundle. Transaction signatures cover transaction bodies, not
the accompanying error, RAM metadata, block labels or snapshots. A fabricated
but internally consistent observation can remain `RECORDED_ONLY`; it must never
be upgraded to independently verified evidence.

Online reads trust the chosen RPC and Vaulta/Jungle4 consensus. They are not a
light client, historical state proof, atomic snapshot, proof of no transient
upgrade, or proof that no unrelated state changed. Recovering a pinned key does
not itself prove its historical on-chain permission. Successful inclusion is
checked separately by transaction ID.

The sample records a memory write, a later owner revocation, and a denied new
reservation. The denial was reported through **one RPC, Greymass**; two RPCs
provided the saved unchanged state observations. This checker never reruns that
signed transaction or asks for signing keys. It can verify the retained
successful history after grant expiry; it does not authorize new use of a grant.

## Relationship to Aegis

[AEGIS-V Reference](https://github.com/ihavenoname444/aegis) already contains
`aegis.verify(effect, proof, policy, state)`, the authority-policy reference
model. This package does **not** replace or duplicate that kernel, and does not
call it with fabricated/default canonical state.

The local reference reviewed is v0.0.17. Its high-assurance acceptance requires
authority-universe/root bindings, authenticated canonical state and capacity
evidence that this native memory demo does not provide. Therefore every result
reports **`aegisPolicyVerdict: NOT_EVALUATED`**.

This is the evidence-reading layer needed before a real integration can be
made. A future authenticated adapter must supply the actual Aegis proof/state
model and retain Aegis's caller-chosen policy. It must not map
`PUBLIC_CHAIN_CHECKS_PASSED` to `Aegis VALID`, fabricate a V certificate, or treat
a historical execution check as a fresh capability.

## Evidence format and tests

`examples/jungle4-lifecycle.json` contains the public native write, owner
revocation, signed denied attempt and explicitly labelled observations. Its
schema version is `1`; changing profiles or adding security claims requires
an explicit reviewed format/version change. No private material is included.

Source public records in the Studio repository are
`docs/evidence/owner-app-v2/{native-write,owner-revocation,post-revoke-denial}.json`.
The checker needs only the derived bundle, bundled ABI/profile and this package.

```sh
npm test
```

Tests use the recorded public transactions and **RPC fixtures**, including
signature/action/profile substitutions, grant/state/block changes, unavailable
RPCs, read-only endpoint enforcement and preservation of observation labels.
Passing these tests is separate from a fresh live RPC run.

This package is distributed as source/archive in the repository. It has not
been published to npm; do not run an unrelated `npx` package with a similar name.

## Validation record — 2026-10-20

A clean temporary directory containing only this package installed its five
dependencies with `npm ci --ignore-scripts`. All 46 tests passed there, as did
the offline check and fresh read-only checks against both CryptoLions and
Greymass (11:45 UTC). Studio's 150 existing tests, with all three actual WASM
builds required, also passed; typecheck and application build passed.

An independent AI reviewer separately rejected 20 altered bundles and 14
malicious RPC fixtures, and confirmed that submission methods are blocked
before transport. No blocking finding remained in this scoped review. This is
not an external professional security audit. The reviewer recommended the
implemented ending ABI recheck and confirmed that the full Aegis policy should
remain unevaluated.
