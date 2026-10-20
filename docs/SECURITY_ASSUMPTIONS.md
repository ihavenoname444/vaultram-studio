# Security assumptions and directive alignment

**Latest implementation:** external registration/grant, write, owner revocation and subsequent denial are live verified; the standalone verifier covers this lifecycle and now audits whole-deployment accounting. See [next integration work](NEXT_AEGIS_V_INTEGRATION.md) and [owner signing/recovery](OWNER_SIGNING_RECOVERY.md). Full custody isolation, authenticated Aegis history and real VaultRAM/V backing remain unverified. Older gap descriptions below must be read with these completed milestones.

## Intended product

Build an application for VaultRAM that lets people and agents create applications without becoming protocol engineers. Studio handles construction and understandable review; native authority constrains execution; VaultRAM capacity should back production authority; Mesh transports proofs across domains; Vaulta holds canonical ownership, permissions, state and receipts. Cloud, payments, automatic infrastructure selection and developer deployment are future product layers, not implemented services. The V relationship must follow VaultRAM's actual economic and contract interfaces, not a new token model invented by this application.

The architecture/security directive is the target, not a description of completed features. No test establishes that Vaulta is the safest chain, that an application cannot be hacked, or that any AI universally chooses V. The demonstrated claim is narrower: the reviewed native contract rejects specified violations while preserving its write accounting.

## Confirmed implementation and trusted components

- Actual native owner/app v2 WASM enforces consent at registration/grant, immutable full spec hash, restricted permission, app/namespace, count, byte limit, expiry, revocation and replay tombstones. A separately recorded Jungle4 deployment and irreversible write exist.
- The gateway prepares a signed atomic reserve/consume transaction. Independent receipt verification reconstructs it and checks inclusion, irreversibility and matching native rows through a separately selected, trusted RPC. This is not a light client or historical Merkle proof.
- The manifest is a current RPC observation, not authority. It derives limits from grant fields; unknown backing claims cannot promote its fixed `UNAVAILABLE` status. Review-time observations may become stale; contract checks at execution remain decisive.
- Test owner, allocator and upgrade administration are controlled locally. A restricted key alone cannot issue grants or alter native ownership under the checked setup. A process compromise can reach same-user files; separate configuration files and mode 0600 do not establish an isolation boundary.
- Gateway signing is operator-controlled. There is no separate native signed user intent. A stolen signer can choose any content within all grants assigned to it. AppSpec hash binding does not enforce a dollar budget, arbitrary contract whitelist or payload semantics.
- Contract administrator, Vaulta consensus and RPC observations remain trusted. Pinning detects observed changes, not transient upgrades or a check/execution race.

## Capacity model — missing production dependency

`root.total` and grant counters are unbacked test-write units. Root/child conservation prevents duplication of this counter; it does not prove scarce backing, RAM ownership, a V claim or a lease. Observed transaction RAM is separate from write accounting and is not independently proven RAM attribution. Payment/accounting analytics and externally attested compute must never be presented as native resource proofs.

Before a real adapter, obtain verified contract/account/ABI/version and answers from VaultRAM for: backing unit; position ownership; exclusive lock/reservation interface; conversion to available native RAM; payer/delegation semantics; renewals, expiry, reclaim and liquidation; V's exact access/claim role; and testnet availability. In particular, determine whether backing can be removed while authority or external execution remains live. A position ID or balance lookup alone is insufficient.

Production issuance must atomically verify owner consent and backing, reserve exclusive capacity, record policy/domain/nonce and issue authority on canonical Vaulta state. No direct-RAM fallback may satisfy this requirement. The current API rejects requests requiring `VAULTRAM_BACKED`; native proof mode is intentionally still available. That admission gate is not an on-chain backing implementation and can be bypassed by direct calls to the test contract.

## Cross-chain model and protocol state machine — not implemented

Choose one external chain only after native backed authority works. Reserve canonical capacity before exporting execution capability. Bind owner/agent, policy, chain/domain, target contract/action, payload, nonce/session, expiry and capacity position in the signed proof. Require destination consumption tracking and canonical in-flight accounting. A pluggable verifier must name its trust model and finality assumptions; no invented Vaulta consensus key or light-client capability.

Target states: available → reserved → authorized → in-flight → settled → released, with revoked, expired-unused, disputed, recovery-required and failed-verified branches. Unknown external outcomes remain reserved/in-flight. Timeout is not proof of non-execution; expiry cannot release capacity while any exported capability can execute. Settlement must be idempotent and capacity may not be reused across destinations. None of these external settlement transitions is demonstrated by a native consume test.

Current native states: available → reserved → consumed, or reserved → quarantined. Quarantine is permanent; revocation/expiry stop future execution and do not reverse completed records. Gateway PREPARED → PENDING → IRREVERSIBLE/UNKNOWN tracks submission evidence, not external capacity settlement. No automated release exists.

## Human safety, agent safety and recovery

Keep AI output descriptive within deterministic templates. Before execution, show exact app/owner, permitted action, target, write/capacity unit, expiry and revocation route. Do not offer unsupported spend limits as security. General AI-generated code needs sandboxing/review before broader deployment. Public state cannot hold secrets. AI must never receive owner seeds, treasury credentials or card details.

Next custody boundary: native owner signs registration/grant/revoke outside the gateway, with admin credentials inaccessible to its OS identity. Recovery, scoped-key rotation, app suspension/freeze, policy reduction and upgrade governance require explicit designs and drills. Revoking Studio must preserve ownership and independently usable receipts/state.

Existing ambiguity handling blocks retries and retains prepared transactions. Missing drills include full journal loss, corrupted records, RPC disagreement/outage, stale capability after revocation, restart during submission, lost receipts, chain fork/finality failure and external settlement disagreement. Do not report recovery success until a reproducible drill demonstrates no duplicate effects or premature capacity reuse.

## Smallest delivery plan

1. Preserve the working native v2 deployment. Show its real permission manifest, explicitly reject backed requirements, and test hostile operational signers directly against WASM, including successful abuse inside the grant. This pass implements that boundary and fixes legacy/v2 documentation ambiguity.
2. While VaultRAM interface details are pending, implement external native owner signing and isolate admin secrets; verify registration/grant/revoke, key rotation and restart/ambiguous-result recovery. No paid AI provider is required for the deterministic builder.
3. With verified VaultRAM interfaces, implement atomic backing → authority → native execution → receipt. Prove capacity conservation against concurrent grants, backing withdrawal/reclaim and expiry. This completes the directive's first production-oriented milestone; it is not complete today.
4. Prove malicious agent and gateway behavior with separate signed intents and actual credential isolation. Then implement exactly one external destination, adversarial settlement/replay tests and recovery chaos tests.
5. Complete the human builder loop: idea → specification → readable permissions → owner approval → backed deployment → measured usage → independently checkable receipt → revoke/recover. Add further chains, payments and cloud only when this path is reliable.

For each change: required-WASM tests, gateway integration, build/typecheck, explicit residual risks, independent review and release allowlist/secret checks. Map claims to AUTHORITY_INVARIANTS.md and preserve native live evidence separately from local VM/network fixtures. Never turn a future requirement into a passing mock test and call it production proof.
