# Directive invariants: evidence and gaps

Scope: deployed owner/app v2 native test-write contract. Local WASM tests are not new live-chain evidence. The independent agent review is not an external professional audit. Contract source and previous Jungle4 deployment are unchanged by the manifest pass.

| #   | Requirement                                  | Actual status / evidence boundary                                                                                                                |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | Authority requires verified backing          | Missing on chain. API rejects a backed requirement; native test mode uses unbacked units.                                                        |
| 02  | Reserved + in-flight ≤ backing               | Only test-write counter conservation is WASM-tested. No backing or external in-flight model.                                                     |
| 03  | Gateway cannot amplify authority             | Restricted signer cannot enlarge native grants. Full host compromise is not isolated.                                                            |
| 04  | No replay                                    | Native reservation/obligation/nullifier/effect tombstones; WASM duplicate tests and gateway submit-once tests.                                   |
| 05  | Chain binding                                | Native signing digest binds Jungle4; no external destination verifier.                                                                           |
| 06  | Target binding                               | Exact gateway transaction account/action and native app/namespace binding; no external target adapter.                                           |
| 07  | Revoked authority cannot act                 | Native reserve and consume reject revoked grant, including already reserved work.                                                                |
| 08  | Expired authority cannot act                 | Native reserve/consume check expiry, including exact deadline in WASM.                                                                           |
| 09  | Idempotent settlement                        | Native consume rejects duplicates; external settlement absent.                                                                                   |
| 10  | Unresolved capacity cannot be reused         | Native tombstones/quarantine retain units; gateway blocks UNKNOWN. No external release model.                                                    |
| 11  | Operational key cannot become owner          | Direct grant/revoke escalation rejected under native permission model. Same-user admin files remain a host-compromise exposure.                  |
| 12  | Generated code cannot silently escalate      | Fixed descriptive template and strict schema only; arbitrary generated executable code is unsupported.                                           |
| 13  | Signed-field mutation fails                  | Exact transaction/payload binding checked. Signer can create a new valid in-scope write; no separate native user intent.                         |
| 14  | Compromised gateway cannot steal treasury    | Not proven for process/host compromise. Current restricted permission has no token-transfer link; no custody isolation.                          |
| 15  | Agent compromise stays scoped                | Direct WASM attacks reject wrong app/namespace, extra budget and replay. Arbitrary in-scope content succeeds; shared key reaches all its grants. |
| 16  | No cross-domain rehypothecation              | Not implemented; no external authority/capacity issuance.                                                                                        |
| 17  | User revokes Studio without losing ownership | Native owner revokes individual grant without deleting app/effects. External owner custody and recovery UI absent.                               |
| 18  | Receipt matches canonical execution          | Native receipt reconstruction, irreversible inclusion and rows checked via trusted independent RPC; not historical consensus/state proof.        |

## Reproduce local attack tests

`REQUIRE_OWNER_APP=1 pnpm exec vitest run tests/owner-app.test.ts tests/owner-app-studio.test.ts tests/authority-manifest.test.ts`

The WASM suite calls the contract directly, bypassing Studio/HTTP. Failed attacks compare all authority tables before/after and recheck counter conservation. Hostile-signer tests also prove the negative limitation: attacker-authored content within its grant succeeds; using both legitimately assigned apps succeeds; expansion/replay fails. VM authorization fixtures do not prove real-world key custody or node signature validation. Live permission checks and existing Jungle4 evidence are separate.

The manifest/integration tests reject identity/permission/namespace substitution, malformed or nonconserving counters and forged backing claims; check current consumed/revoked state; and require backed requests to stop before RPC, journal creation or broadcast. They do not claim implementation of invariants 01/02/16.
