# RAM model and measurement

## Current estimator

estimate(payload) measures canonical JSON UTF-8 bytes. New rows use payloadBytes + 96 as a provisional lower value and payloadBytes + 2048 as an admission allowance; status updates use zero for the lower value. These constants have not been calibrated against this contract. They are engineering allowances, not documented exact Vaulta table overhead or a statistical confidence interval.

The contract independently requires title bytes + content bytes + 2048 <= ram_budget <= 10000. This admission rule does not meter the transaction’s exact RAM usage or enforce a hard byte spending cap. Fields, application count (64) and rows per application (1000) are bounded. Nonce rows are retained to preserve replay protection. A compromised relayer can still consume the dedicated account’s available RAM inside these limits.

## Payer and observation

Runtime administration pays for configuration/app rows. The relayer pays for business rows and nonce/index rows. Live execution reads relayer ram_usage before and after broadcast. The receipt records the two observations and difference; simulation records null. No application measurement exists yet.

One gateway serializes writes, but external transactions can affect the same account, and observations are not historical snapshots. Therefore attributable is always false. A receipt signature protects the recorded values from modification; it does not prove causal RAM attribution. Reconciliation must not invent a missing before/after sample.

## Calibration acceptance procedure

1. Use a dedicated payer with no other writers. Record deployment code/ABI hashes, chain ID and account quota.
2. Measure first agent for a new owner, another agent for the same owner, first/repeat service and memory rows, and both status transitions.
3. Repeat with short, maximum-size and multibyte UTF-8 text, including table/index initialization and new owner nonce costs.
4. Record transaction inclusion, irreversible block, row data and account observations. Exclude ambiguous or concurrent runs from calibration.
5. Report sample count, distribution and worst observed error per operation; version the dataset and estimator together. Validate held-out samples before changing the allowance.

Do not quote dollar cost from these byte estimates. Mainnet RAM price, CPU/NET provision and operational expenses require current measurements and a separate launch decision. Jungle4 faucet resources are test assets.
