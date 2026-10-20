# Next Aegis and VaultRAM integration boundary

## Decision — 2026-10-20

Continue the native authority/state foundation before expanding Studio's general builder, chains or payments. The independent review found a concrete gap: the lifecycle checker verified one grant and one retained write, but did not reconcile the shared root against every app, grant, reservation and effect. A whole-deployment read-only audit now closes that accounting gap under the stated RPC trust model. No contract deployment, owner approval or private key is needed.

The reviewed Aegis reference is v0.0.17 (`src/verifier.js`, `src/authority-universe.js`, `src/capacity-kernel.js`, and `specs/12-protected-authority-state-v0.md`). This is an implementation comparison against that reference, not a claim of full Aegis compatibility or a current protocol specification from VaultRAM.

## Delivered now

From the standalone `packages/verifier` directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node audit-state.mjs --rpc cryptolions
node audit-state.mjs --rpc greymass
```

The auditor pins the deployment code/ABI and the root principal/total. It reads all five tables twice, with explicit completeness and size checks, and rechecks deployment pins and chain/finality metadata. A changing response is inconclusive and never automatically retried. A truncated/ambiguous response cannot pass. Two equal reads are not an atomic or consensus-authenticated snapshot.

It checks:

- Root available capacity plus all grant budgets equals the pinned root total.
- Registered app count matches complete app rows; grants bind real app owners.
- Every grant's available/reserved/quarantined/consumed counters conserve its budget.
- Reservation status counts match each grant's counters.
- Reservation, obligation, nullifier and allocated effect identifiers are unique across grants.
- Every consumed reservation has exactly one matching effect, and unconsumed/quarantined reservations have no effect.
- All effects bind the correct grant/app/owner/actor/permission/namespace and exact payload hash/size.

The output includes the normalized public rows and an `observationDigest` for comparing reads. **That digest is not an Aegis authority-state root, accepted checkpoint, consensus proof or capacity certificate.** Current table rows are not proven to belong to the reported irreversible block. The RPC and chain governance remain trusted, and current pins cannot prove historical code/permission continuity or exclude transient upgrades.

[Recorded live observations](evidence/owner-app-v2/whole-state-audit.json) from CryptoLions and Greymass matched at **14:15 UTC / 16:15 Amsterdam on 2026-10-20**:

| Accounting observation                              |           Value |
| --------------------------------------------------- | --------------: |
| Apps / grants                                       |           3 / 3 |
| Reservations / committed effects                    |           3 / 2 |
| Root total                                          |          10,000 |
| Root available                                      |           9,894 |
| Allocated grant units                               |             106 |
| Grant available / reserved / quarantined / consumed | 103 / 1 / 0 / 2 |

These are **unbacked test-write units**, not RAM bytes or V. Available accounting balances may be revoked or expired and are not a claim of executable authority. No new write was sent to obtain these observations.

## Next work we control

1. Design and test authenticated checkpoint/transition ingestion for this exact native deployment: bind chain, contract, code/ABI, prior accepted checkpoint, complete state and transition order. Persist the reviewer's accepted history, reject conflicting roots and fail closed on missing history. This requires authenticating the source of the history; hashing RPC responses alone cannot satisfy it. No `defaultState()` substitution and no automatic promotion of a historical consumed effect into fresh Aegis execution authority.
2. Isolate operational signing from owner/recovery/admin credentials at the OS/process boundary and run recovery/rotation drills. Separate files under one user are insufficient. The current operator key is shared by explicitly assigned grants; per-app key isolation remains separate work.
3. Keep Studio's narrow owner-approved application loop as the product surface. Add supported resource allocation only when its real contract interface is verified. Broader generated applications, external destinations and payment execution follow complete mediation and backing.

Aegis's stronger protocol-protected state target also requires validator/protocol work and accepted upgrade governance; an application cannot establish that property unilaterally. An RPC-trusting overlay must remain labelled as such.

## What VaultRAM must confirm before real V integration

Provide an authoritative integration example for the intended test environment, including:

- Chain ID, deployment accounts, source/version and ABI; supported app/data access actions.
- V asset contract/symbol/precision and its actual role: fee, access, claim, collateral or another specified function. Do not assume every role or invent V-to-RAM conversion.
- Resource/position ownership, RAM payer/delegation rules, unit and usable capacity.
- Whether exclusive reservation/encumbrance is supported, how it is enforced, and whether concurrent apps can claim the same capacity.
- Expiry, renewal, withdrawal/reclaim and settlement rules while a grant or in-flight operation remains live; test deployments and expected denial cases.

A balance or position lookup alone does not establish exclusive backing. If VaultRAM's actual product does not support the reference model's exclusive encumbrance, document that mismatch and design an agreed extension; do not manufacture a certificate.

With those interfaces, the next integration test is **real resource reservation → bounded authority issuance → protected write → verifiable receipt → revoke/expiry/reclaim**, including concurrent issuance and attempted withdrawal while authority remains live. This test is blocked on verified interfaces, not on more frontend work. The existing `VAULTRAM_BACKED` requirement remains rejected.

## Acceptance and residual gaps

The new auditor adds 62 adversarial tests; all 152 standalone tests passed in a clean temporary package with only five locked dependencies. Both live read-only endpoint runs passed and returned the same observation digest. Tests use public fixtures; live checks are separately recorded.

Full Aegis acceptance remains `NOT_EVALUATED`: authenticated checkpoint/history, authority-universe/root bindings, caller-selected policy, real exclusive backing and complete mediation are not supplied. Actual VaultRAM/V integration remains unavailable. These checks do not certify production readiness or comparative chain safety.

The independent AI reviewer found no blocker, ran the then-current 151 tests, rejected 12 additional ledger mutations, checked a valid unrelated owner/actor grant and changing-snapshot handling. The unrelated-grant case is now also a permanent regression test, bringing the suite to 152 tests. The reviewer used local fixtures, not live RPC checks.
