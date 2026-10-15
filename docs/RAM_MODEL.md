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
