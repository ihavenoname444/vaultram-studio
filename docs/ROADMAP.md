# Delivery milestones

1. **Local proof:** deterministic bounded app, working UI, real EOA signatures, persistence, replay/owner tests, signed export and independent signature verifier.
2. **Jungle4 proof:** compile with pinned CDT, exercise the actual WASM in VeRT, deploy under separate runtime/relayer accounts, sign externally, execute, reconcile and verify through a second RPC. Measure repeated first/repeat/update writes before calibrating estimates.
3. **Production decision:** external security review; operating model, key custody and rotation; deployment governance; quotas and abuse protection; archival RPC/indexing; backups and recovery drills; privacy/data deletion policy. Decide economic requirements from measured workload.
4. **Optional adapters:** Base/Ethereum remain EOA signing sources only. New app templates, reputation, autonomous execution, payments, exSat integration and mainnet are separate proposals with their own proof requirements.

Do not call milestone 2 complete based on simulation, account creation, compilation, or an RPC accepting a transaction. Require an irreversible transaction and independent evidence verification.
