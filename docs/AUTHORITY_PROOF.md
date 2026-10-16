# Native authority proof on Vaulta Jungle4

This is a separate, single-runtime proof of part of the Aegis authority thesis. It does not replace the Phase 0 Studio contract or make its EVM-owner flow trustless.

## Why the previous demo was insufficient

The Studio gateway verifies EIP-712 signatures, but its contract accepts the relayer's owner field. A compromised authorized relayer can therefore fabricate an EVM owner. A restricted native relayer permission limits callable actions; it does not establish the truth of that owner field or conserve delegated capacity.

The Aegis reference model describes stronger authority conservation and cross-domain ambitions. The review used its main README at commit `01bcce77bce0bd13ae2bb10d691f5c6c4a7c6038`. This implementation demonstrates a narrow subset, not the full model.

## Implemented boundary

A new contract, `contracts/authority-proof/authority.cpp`, has six actions: init, grant, reserve, consume, revoke and quarantine.

- Initialization requires both the contract account and native principal. The root capacity is immutable and capped at 10,000 units.
- Only the native principal grants capacity. Allocation subtracts from the root; two actors cannot each receive copies of the same capacity.
- Each grant binds a native actor, namespace, budget, expiry and payload-size limit.
- Reservation moves one unit from available to reserved and permanently binds obligation, nullifier, effect ID and payload hash.
- Consumption checks the actor, expiry, revocation, payload and reservation again. It atomically appends the protected public record and spends the reserved unit.
- Revocation blocks future consumption, including reservations created before revocation. An effect committed before revocation remains committed.
- Quarantine permanently removes a pending unit from executable capacity. It cannot be released or reused in this proof.

One unit means one public write of at most 256 bytes. It does not mean one RAM byte, one token, or monetary spending authority. Enforcement is scoped to this contract's effects table, not arbitrary actions elsewhere.

The accounting invariant is:

```text
root.available + sum(grant.available + grant.reserved
                     + grant.quarantined + grant.consumed) = root.total
```

Each grant's counters also sum to its original budget. Consumed units correspond one-to-one with effects; reservation IDs, obligations, nullifiers and effect IDs never repeat.

## Build and deployment pins

- Network: Jungle4, chain ID `73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d`.
- New contract account: `vradqgskurpl`; native principal: `vrya3iayygzy`; first actor: `rlnmfc13nj2m`.
- Deployment irreversible block: `292385282`.
- Source SHA-256: `3e8fcaf426b092511288305e7e702610c74e72b6cad929e970bbf46c2532efeb`.
- WASM SHA-256: `343556dd7fc819985b2b17d42035bbf7268d9dde3733ef63c1145363b03be716`.
- ABI JSON SHA-256: `fd222d89586f737cb018fdf93a81c9bed7afd1c8f4bc10013b7f49e93b0a3ec7`.

Official CDT 4.1.1 ran in a temporary free Binder Linux session. Two builds produced identical WASM and ABI. Only the public contract source was uploaded; signing stayed local. The temporary session was shut down afterward. The compiler package SHA-256 is `d946e6b64f297442d19e486401aa49f956080b07a1fa6335f29976106175b588`.

Provisioning and additional CPU/RAM used 96 test EOS in total: 70 for RAM, 26 staked for CPU/NET across the accounts. These are testnet resource allocations, not fiat charges or a mainnet cost estimate. Initial CPU and RAM failures were inspected before retry. The first matrix attempt stopped on error-format handling before any successful matrix writes; its journal was retained, empty tables independently checked, then the error parser was fixed.

## Evidence and verification boundaries

The live harness records 33 cases (35 transaction attempts: two race candidates plus one fresh loser retry). Successful transactions are checked as executed and irreversible through the separately operated CryptoLions RPC. Submission uses Greymass. The matrix covers invalid principal/actor, root overflow, namespace/payload/size substitution, replay, identifier reuse, quarantine, revocation, expiry and two concurrent submissions competing for one unit.

The verifier binds the deployment's source/WASM/ABI hashes and chain ID to the local build, compares the deployed code and serialized ABI, verifies successful transaction digests and irreversible block inclusion, and checks current accounting and exact final-state equality. It requires every case in order, consistent snapshots, expected rejection messages and unchanged state, and one irreversible race winner with an unchanged-state exhaustion rejection on a fresh retry of the other candidate.

**Rejected transactions have no irreversible rejection receipt.** Their error messages and before/after snapshots are recorded RPC observations. The validator checks the matrix's structure, outcomes and transaction targets, not every label's action arguments. It does not cryptographically prove negative attempts. Historical per-step snapshots are also observations; the final current state and positive inclusions receive the independent RPC check.

The independent reviewer found two verification gaps (missing build binding and missing matrix completeness checks); both were fixed. This was a separate implementation review by an AI agent, not an external security audit or formal proof.

## Recorded outcome, 2026-10-16

The matrix completed. Independent verification passed 15 successful transaction inclusions: deployment plus 14 matrix transactions. Nineteen ordinary rejected cases and one rejected fresh race-loser retry left their observed state unchanged. These rejection records remain observations, as described above.

The race initially returned local application acknowledgements for competing candidates; the old harness stopped before persisting responses because one lacked finality. The signed candidates and interrupted journal were preserved. Recovery resubmitted neither original. Candidate 21 finalized in block 292385460; candidate 20 was later reported FAILED by the independent RPC. Its fresh same-action retry was rejected for exhausted capacity. This is not an irreversible rejection receipt for the original loser.

Deployment transaction: `6c5dcad7d48c82eba7053cd277516a998793e38a965a5b9024724552f25e0f16`. Final matrix transaction: block `292385717`.

Final accounting: root available 0; allocated grant balances total 10,000 = 9,995 available + 1 reserved + 2 quarantined + 2 consumed. The two consumed units produced exactly two protected effects. The reserved unit belongs to a revoked grant and cannot execute. Available counters include expired/revoked capacity: they are accounting balances, not a promise that all 9,995 remain executable.

The complete automated suite passed 70 tests with both WASM artifacts required and no skipped tests: 56 existing tests, 11 native-authority WASM tests and 3 evidence-integrity tests. Typecheck and the production build also passed. Existing browser acceptance evidence is unchanged; this new proof is CLI/contract based and has no new UI flow.

## Reproduce

On Linux with official CDT 4.1.1 and the pinned Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm exec tsx scripts/build-authority.ts
REQUIRE_AUTHORITY=1 pnpm exec vitest run tests/authority.test.ts tests/authority-evidence.test.ts
```

Build the older runtime too before running the full suite with both REQUIRE_WASM=1 and REQUIRE_AUTHORITY=1.

The public proof archive contains `evidence/deployment.json`, `evidence/run.json`, `evidence/verification.json`, and `contracts/build/authority/`. Extract those paths into a source checkout and run:

```sh
AUTHORITY_EVIDENCE_DIR=evidence node --import tsx scripts/authority-proof.ts verify
```

Verification requires network access and no private keys. Independently pin this document's hashes; archive checksums alone establish internal consistency, not provenance. The submitting command deliberately refuses blind reruns. Provision/deploy/run are operator commands requiring locally provisioned native account keys; do not point them at mainnet.

## Still missing for the broader Aegis/VaultRAM claim

1. Bind the actual Studio owner identity to authority enforced by the chain: native wallet flow or carefully specified on-chain EVM-signature verification, domain separation and nonce/revocation semantics.
2. Complete protected-effect integration across Studio. Public memory now uses native authority (see NATIVE_STUDIO.md); agent, service and status flows still use the original relayer-trusting runtime.
3. Specify and implement cross-runtime/domain conservation, transfer/settlement and finality handling. This proof has one chain and one enforcement contract.
4. Extend the model only with tested lifecycle rules: no subdelegation, renewal, refund, release from quarantine or capacity recycling exists here.
5. Define production administrator controls and recovery, then commission an external audit and adversarial testing. The upgrade administrator can replace the enforcement code; principal and native account permissions can also be changed by their controllers.
6. Establish any claimed role for V with a separate economic/security argument. The proof does not use V and does not establish that V, A, or any chain is the safest cryptocurrency for agents.

Further limits: all native keys are controlled by one local test operator, not independent organizations; public data only; no agent inference/provider calls; no mainnet deployment; no protection against chain consensus compromise. Global caller-selected IDs permit a granted actor to squat another actor's intended ID, consuming its own bounded capacity and causing denial of service. Records are permanent and paid from contract RAM; the finite 10,000-unit cap bounds record count but resource provisioning can still limit availability. Quarantine is deliberately irreversible and trades availability for safety.
