# RAM model and measurement

## Current estimator

estimate(payload) measures canonical JSON UTF-8 bytes. New rows use payloadBytes + 96 as a provisional lower value and payloadBytes + 2048 as an admission allowance; status updates use zero for the lower value. These constants have not been calibrated against this contract. They are engineering allowances, not documented exact Vaulta table overhead or a statistical confidence interval.

The contract independently requires title bytes + content bytes + 2048 <= ram_budget <= 10000. This admission rule does not meter the transaction’s exact RAM usage or enforce a hard byte spending cap. Fields, application count (64) and rows per application (1000) are bounded. Nonce rows are retained to preserve replay protection. A compromised relayer can still consume the dedicated account’s available RAM inside these limits.

## Payer and observation

Runtime administration pays for configuration/app rows. The relayer pays for business rows and nonce/index rows. New live receipts keep `ram_usage` before/after as secondary observations and leave their `delta` null. They can be stale or include unrelated writes. The original four-action proof reported immediate differences of zero despite later aggregate growth of 1,270 bytes; those old receipts remain historical evidence, not zero-cost claims.

The primary reported measurement is now `ram.executionTrace`: the relayer's `account_ram_deltas` from the exact single `execute` action returned by `send_transaction`. Missing, malformed, duplicate-account or ambiguous trace shapes produce unknown, not zero. An explicit empty delta list can represent a real zero. The trace is bound to the transaction ID in the signed receipt. It is a submitting-RPC observation, not an independently reconstructed historical proof: `independentlyVerified` remains false. Historical transaction endpoints on the two tested RPCs returned 404.

Dataset **calibration-v1** has 18 irreversible actions, nine each from two fresh test owners in a fresh app, under the pinned runtime in BUILD_PROOF.md. Independent CryptoLions verification checked all 18 transactions; Greymass supplied the execution traces. The two owners shared the dedicated relayer. The experiment did not prove the absence of all external account writers; action traces, rather than account differences, are used below.

| Operation                                        | Owner 1 bytes | Owner 2 bytes |
| ------------------------------------------------ | ------------: | ------------: |
| First agent, 1-byte name + 1-byte description    |           802 |           578 |
| Second agent, 60 + 500 bytes                     |           742 |           742 |
| Service, 1 + 1 bytes                             |           183 |           183 |
| Service, 80 + 500 bytes                          |           762 |           762 |
| Memory, 1 byte                                   |           182 |           182 |
| Memory, 1,024 ASCII bytes                        |         1,206 |         1,206 |
| Memory, 256 whale characters / 1,024 UTF-8 bytes |         1,206 |         1,206 |
| Pause agent                                      |             0 |             0 |
| Reactivate agent                                 |             0 |             0 |

A candidate fit is 179 fixed bytes plus serialized title/content string lengths and bytes, with 395 extra bytes for a new owner's nonce and 224 for initial app tables. This is an inference from this small dataset, not an independently validated protocol constant. No held-out validation or confidence interval exists. The production admission estimator remains **conservative-admission-v1, calibrated: false**; these observations do not justify replacing its safety allowance. Dataset exports preserve each intent, signed receipt, transaction, estimate and observed trace delta.

One gateway serializes writes, but external transactions can affect the same account. `attributable` remains false for the account observations. Receipt signatures protect recorded values from modification; they do not make RPC observations trustless. Reconciliation never invents missing RAM samples.

## Calibration acceptance procedure

1. Use a dedicated payer with no other writers. Record deployment code/ABI hashes, chain ID and account quota.
2. Measure first agent for a new owner, another agent for the same owner, first/repeat service and memory rows, and both status transitions.
3. Repeat with short, maximum-size and multibyte UTF-8 text, including table/index initialization and new owner nonce costs.
4. Record transaction inclusion, irreversible block, row data and account observations. Exclude ambiguous or concurrent runs from calibration.
5. Report sample count, distribution and worst observed error per operation; version the dataset and estimator together. Validate held-out samples before changing the allowance.

Do not quote dollar cost from these byte estimates. Mainnet RAM price, CPU/NET provision and operational expenses require current measurements and a separate launch decision. Jungle4 faucet resources are test assets.

## Native authority and RAM in one operation — 2026-10-16

The native memory workflow records a RAM observation against the same transaction ID as its reserve+consume actions. Only an executed response containing exactly those two top-level actions, the expected contract/receiver, no inline traces and unambiguous integer RAM deltas for the contract payer is accepted. Missing/ambiguous observations remain unknown; old operations are not backfilled with invented values. Observations persist in SQLite and are included in native evidence exports and the app view. Payload bytes include the application binding. This measures consumption, not a byte spending cap, RAM savings or V-token consumption. Independent verification authenticates transaction inclusion/effect via RPC; it does not authenticate the submitting RPC's historical RAM trace. Fourteen focused tests and typecheck passed.

## Actual VaultRAM/V integration boundary

We are an independent application intended to demonstrate utility on VaultRAM, not the VaultRAM platform itself. The deployed application currently uses a dedicated Jungle4 contract and its own allocated RAM. No VaultRAM SDK, data service or V settlement is integrated.

The official https://vaultram.com homepage, inspected 2026-10-16, names `token.rms`, describes V for data access/verification fees, incentives and governance, and presents a RAM-byte equivalence. These statements do not provide an executable application integration or redemption specification. No developer SDK/API specification was found on the inspected homepage; that does not establish that none exists elsewhere.

Before a real V integration we need authoritative network/account/code/ABI references; the supported application registration and data-access interface; RAM allocation and payer rules; V fee calculation, precision, authorization and settlement semantics; and a supported test deployment. A claimed byte equivalence is not sufficient to implement a V-to-RAM conversion. These must be confirmed from deployed contracts and official integration documentation, then tested with bounded permissions. No mainnet transfer or invented V charge is part of this demo. Comparing RAM efficiency requires a controlled baseline with identical workloads before claiming savings.

### Recorded native run

On 2026-10-16, the running app API prepared, submitted and reconciled transaction `110d360f2e50e30501ad9a8359a8704b76944d78c76a8caa944d5ce0d752e9c0` on Jungle4. The independent verifier confirmed irreversible inclusion in block **292402257** and the expected effect. Grant 1 decreased from **99 to 98**. The submitting RPC reported **866 RAM bytes** for payer `vrsdgugozrrz`, with **143 payload bytes** including the application binding. This was one real app API operation, not a new wallet-signature test. The RAM number remains an observation, not independently verified savings. Typecheck, production build and 14 focused tests passed. No V was charged.
