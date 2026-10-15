# Three-to-five minute demonstration

## Readiness gate

Read REALITY.md first. The local simulation walkthrough, actual compiled WASM tests and 22 live Jungle4 actions are verified. The live proof used a dedicated local EOA and independently checked irreversible receipts. A human external-wallet walkthrough is still pending. The controlled EIP-1193 test provider is a separate automated test, not proof of a real wallet application.

## Verified local walkthrough

1. Start pnpm dev and open the loopback URL. Point out SIMULATED and FIXTURE before interacting.
2. Enter the agent marketplace prompt and compile. Explain that fixture mode returns the fixed example; configured AI can only supply descriptive fields.
3. Open generated AppSpec, manifest and React source. Show bounded actions and public-data limits.
4. Activate local deployment, select the explicit demo signer, create an agent, publish a service, write a short public memory, then pause the agent.
5. Inspect the three persistent state rows. Reload to demonstrate persistence. Open a receipt, verify its signature and export evidence.
6. Show the null chain/RAM fields. Explain the trusted gateway and the exact outstanding live checks.

## Live walkthrough after the gate passes

Use `pnpm demo:check` then `pnpm demo` for the configured dedicated runtime and restricted relay key; follow [WALLET_DEMO.md](WALLET_DEMO.md). Compile and register the exact app ID. Connect an injected EVM EOA wallet; its existing Ethereum network may remain selected because it provides an identity signature only. Signing requires no EVM gas. Review the complete payload, expiry, nonce, runtime pin and RAM allowance before signing.

Execute one action, then reconcile until its actual block includes the transaction and is irreversible. Read the state through RPC. Show the real transaction ID, submitting-RPC execution RAM trace and its trust limitation. Keep account before/after observations secondary. Export evidence and run the CLI against a separately chosen Jungle4 RPC with independently pinned receipt key and ABI. Demonstrate service, memory and status only after the first loop is established.

If submission is UNKNOWN, stop the narrative and reconcile; do not repeat the click to manufacture success. If AI is unavailable, say FIXTURE. If external wallet interaction has not been tested, do not describe a CLI signer as that wallet test. End by explaining that future adapters must prove their own security model.
