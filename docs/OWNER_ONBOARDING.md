# Repeatable external owner app/grant approval

Status: external Anchor app/grant approval and a write in that new app were
verified live on Jungle4 on 2026-10-20. The new grant still needs its own
owner-revocation/denial ceremony. Earlier revocation evidence remains historical.
No contract upgrade was made.

- [App/grant evidence](evidence/owner-app-v2/external-app-grant.json): transaction
  `ca0fa708ded0c4cdb12217beca558079973119a3bf11115f3f69c2330abafff6`,
  irreversible block **293059135**, signed externally by the configured active key.
- [New app write](evidence/owner-app-v2/external-app-write.json): transaction
  `4b4c0ad36d52131c9f30909b1b164da85be5efa583ff5957c8a9078109358321`,
  irreversible block **293059227**. The submission trace reports **860 RAM bytes**
  for **114 payload bytes**; this is an RPC observation, not independent RAM proof.
- App `15400335351187373294`, grant `47633037276206`: five writes, 256-byte
  maximum payload, memory namespace, expires 2026-10-21 13:29:19 UTC. One write
  consumed and four remain. Same native account holds owner and allocator roles.
- An independent AI reviewer checked the exact actions, specification, recovered
  owner public key and write bindings from public evidence. Its network sandbox
  prevented its own RPC checks; the implementation agent checked live finality.

## Operator walkthrough

1. Start the configured Jungle4 owner/app demo. Open the native authority view
   and connect Anchor to the configured owner account with `active`.
2. Choose a unique app name, 1–100 test writes and 1–168 hours. Prepare the app
   and grant. Inspect the frozen specification/hash, owner, allocator, agent,
   contract, payload limit and expiry displayed below the inputs.
3. Approve the exact two-action transaction in Anchor. Both `regapp` and
   `grant` require owner and allocator consent. When one account holds both
   roles, one signature suffices. Distinct accounts require two distinct keys
   and two approvals of the same transaction; connect each account in turn.
4. Submit the checked signatures once. Reconcile until irreversible inclusion
   and matching app/grant state are verified through the independent RPC.
   Signing expires after about two minutes. Before submission, an expired
   request can be replaced. After submission, UNKNOWN must be reconciled;
   never blindly resend or reset the journal.
5. Select the new app workspace, prepare/approve a public memory write, and
   inspect its receipt and observed RAM measurement. Use the owner controls
   to approve revocation of this workspace's grant, then verify denial.
6. Repeat with a different specification/name. This path creates a new app
   and grant atomically; it does not renew an existing app's grant.

## Enforcement and recovery

- Browser and gateway independently reconstruct exactly two permitted actions
  from the same strict plan. App identity derives from the full specification.
  Extra actions, altered limits, wrong chain/account/key, delayed transactions
  and extra signatures fail verification.
- The gateway reads current owner/allocator authorities, code/ABI pins, actor
  permission and allocator capacity before submission. Only simple 1-of-1
  active authorities are supported. Owner/allocator private keys are never
  accepted by this path. The gateway retains its restricted operational key.
- Signed intent is journaled before the single network send. Each app/grant
  gets a separately bound durable journal created before submission.
  Missing journals fail closed. Recovery lock blocks new issuance/activation.
- Selection requires fresh verification, including executed transaction
  inclusion below LIB and matching current app/grant identity. A stored
  finalized block is only a locator: it is fetched and checked again if the
  transaction-status cache no longer retains the transaction.
- A slower failed reconciliation cannot overwrite a concurrently confirmed
  irreversible result. Historical success is not treated as fresh success
  when the RPC or state verification is unavailable.

## What this proves, and what it does not

Local tests execute the real contract WASM with fixture RPC/finality responses.
They cover same-account and distinct owner/allocator approval, write/revoke,
signature substitution, expiry, key rotation, insufficient capacity, journal
loss/corruption, UNKNOWN across restart, separate app contexts and concurrent
reconciliation. Live Anchor and HTTP/browser behavior need separate checks.

The configured owner/allocator and operational actor are fixed deployment
settings. This is not open account onboarding, delegated/multisig support or
arbitrary application execution. The current operator key serves all these
explicit grants; journal/app separation is not key isolation between apps.
Owner recovery/admin material remains local, and OS custody isolation is not
established. Emergency operations still depend on available chain/RPC access.

Write units are bounded test capacity, not RAM bytes, payment authority, V
claims or VaultRAM leasing. RPC-backed verification is not a consensus light
client, proof of historical execution code, or full Aegis acceptance. The
existing standalone lifecycle verifier has its own pinned evidence schema;
this new onboarding export does not silently extend that schema.
