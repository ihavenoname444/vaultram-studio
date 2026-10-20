# Owner authority demo — current evidence

This is an independent app intended for the VaultRAM ecosystem, running on
Jungle4. The demonstrated boundary is **owner → app → restricted agent →
public memory write → owner revocation → denied agent request**.
It does not yet integrate VaultRAM leasing or the V token.

External reviewers can now use the [standalone evidence checker](../packages/verifier/README.md)
with its included public lifecycle bundle, without Studio, build artifacts or
private configuration. The live-denial runner below is a separate operator test
that submits an attempt; the public checker is strictly read-only.

## A three-minute walkthrough

1. Open Studio's native owner/app authority view. Identify contract
   `vralzuwmebbx`, app `7707187089270261976`, native owner `vrya3iayygzy`
   and delegated agent `rlnmfc13nj2m@vrapp`.
2. Show the completed memory write and its exported receipt:
   [native-write.json](evidence/owner-app-v2/native-write.json).
   Transaction `77faae605bd7e167347474a1f1f86e3ef80d34e0df96cd8be1ec1d1de15e8a75`
   is included in irreversible block **292894234**. The submitting RPC observed
   **1,293 RAM bytes** for **99 payload bytes**, including bookkeeping.
   This is an observed allocation, not a RAM lease, saving, price or V backing proof.
3. Show owner control and the completed
   [Anchor revocation](evidence/owner-app-v2/owner-revocation.json).
   Transaction `999bf2b693577eec1d48940106302ef271129b0b3208fe17fde8f08d620b7927`
   is included in irreversible block **292914270**. The recovered signer matches
   the externally held active key. Grant 1 is revoked.
4. Show the [subsequent agent attempt](evidence/owner-app-v2/post-revoke-denial.json),
   observed on **2026-10-20**:
   `be23218523de2125fe704684ee10b2340f2d361a51d628b27eed7db13ec0ecde`.
   It was signed with the grant's restricted agent key and submitted directly
   to the deployed contract. The RPC returned `grant revoked`.
   Both Greymass and CryptoLions reported unchanged root, app, grant,
   reservation and effect tables before and after this attempt.
5. Explain the boundary: the contract denied a new reservation after owner
   revocation, so that request could not progress to a memory write.
   Live rejection is an RPC observation, **not an irreversible rejection receipt**.
   Tests with actual WASM and the earlier separate live acceptance fixture also
   cover revocation after a reservation but before consumption.

These are completed historical steps on this deployment. Grant 1 cannot be
unrevoked; its remaining 99 write units are unusable. Do not present a replay of
this evidence as a fresh wallet ceremony. A fresh end-to-end demonstration needs
a separately approved new app and grant. Studio now implements this through
[external owner/allocator signing](OWNER_ONBOARDING.md); its new live Anchor
ceremony remains pending.

## Recheck the live denial safely

The deployment operator can run:

```sh
node --import tsx scripts/test-owner-revocation.ts \
  docs/evidence/owner-app-v2/owner-revocation.json \
  /tmp/owner-revocation-check-NEW.json
```

Requires the existing private operational configuration and matching local
owner/app build artifacts. Private keys are not included in this repository.
The script is pinned to the reviewed Jungle4 demo contract and grant; it reads
only the restricted-agent configuration, not owner/admin key files.
It independently checks the original revocation's irreversible inclusion,
signature, current code/ABI, app/grant binding, and restricted permission.
The grant must still be unexpired and have capacity so the test isolates
revocation. This particular fixture expires on **2026-10-26**.

It journals the signed attempt before its single submission and refuses to
overwrite an existing journal. No automatic resend occurs. Transport failures,
different errors and changed state fail verification. After an UNKNOWN result,
inspect the existing journal and chain state; do not blindly create a new
attempt. RPC responses and current-code pins remain trust assumptions, not
light-client verification or proof of historical execution code.

## Before calling the broader product demo complete

- Complete a fresh live Anchor registration/grant ceremony using the new
  tested onboarding path, then write and revoke that new grant. General
  account onboarding is still outside this configured-owner demo.
- Prove gateway isolation from owner/admin files in its deployment environment;
  migrate and test owner recovery custody with safe backups.
- Obtain and verify VaultRAM's actual lease/claim interface, RAM payer model,
  expiry/reclaim rules and V role. Do not simulate a V integration as real.
- Resolve or characterize Anchor's observed desktop crash before promising
  reliable onboarding. One successful ceremony does not establish stability.

The bounded authority evidence walkthrough is ready. Production readiness,
arbitrary application generation, cross-chain enforcement, hosting and a claim
of being the safest chain are not established by this demo.
