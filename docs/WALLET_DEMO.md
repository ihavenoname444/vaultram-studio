# External wallet demo — operator checklist

## Scope

This demo uses a new empty EVM EOA wallet to sign one bounded EIP-712 intent at a time. No ETH, Base ETH, EOS or A tokens are needed in that wallet. The gateway pays Jungle4 resources from the dedicated test relayer. Do not add Jungle4 as a custom EVM network: Jungle4 is the destination reached by the gateway, not a network MetaMask must connect to. The wallet's existing Ethereum network can remain selected; its actual chain ID is bound to the identity signature.

For this version use MetaMask Extension in Chrome on the same computer as the gateway. A mobile wallet alone cannot reach the local loopback app, and WalletConnect/QR pairing is not implemented. Do not expose the gateway to the internet to work around this. Smart-contract wallets are outside the EOA-only scope.

Install via [MetaMask's official instructions](https://support.metamask.io/start/getting-started-with-metamask/) and select [Create a new wallet](https://support.metamask.io/start/creating-a-new-wallet/). Create the wallet yourself; keep its recovery phrase and password private. Send only the public address if needed, never the phrase or private key. No deposits or token approvals are part of this demo.

## Start and checks

From the repository directory, run `pnpm demo:check`, then `pnpm demo`. These commands read private `.env.jungle4`, match the chain/code/ABI/local artifacts, verify runtime configuration, the dedicated relay key and permission link, app registration and available resources. Checks are read-only on chain. Startup seeds only local example metadata, then starts the existing loopback UI and gateway. It does not deploy, sign transactions or request faucet funds.

This entry point explicitly disables AI API credentials and uses the fixture specification. ChatGPT-assisted edits can be reviewed and integrated manually outside the app; the prompt box is not an automated ChatGPT connection. The dedicated local data directory `.data/demo-jungle4` retains wallet receipts and reservations across restarts. Preserve it.

Open `http://127.0.0.1:5173` in Chrome. Check the **JUNGLE4** badge and **Runtime ready**. The startup preflight is a current observation; resource availability and chain state can change later.

## Human signature sequence

1. Unlock the new MetaMask wallet. Click **Connect wallet** in Studio and approve account access.
2. Create an agent named `VaultRAM demo agent` with a short public description. Click **Prepare action**.
3. Check the full owner address, action, payload, wallet chain ID and Jungle4 runtime. Expand **Full signed intent** to inspect all signed bindings. Click **Sign and submit**, then personally confirm the expected typed-data request in MetaMask before the countdown expires. This authorizes a real bounded testnet write through the trusted gateway, even though it is not an EVM transaction.
4. Inspect the receipt. Use **Check chain finality** until it reports **IRREVERSIBLE**. If UNKNOWN, reconcile instead of making a replacement action.
5. Publish a service, write a short public memory, and pause the agent. Each needs its own reviewed signature. Wait for irreversibility between actions.
6. Check **State**, reload, and confirm the records persist. Reconnect the wallet after reload if needed. For each receipt use **Check signature**, then **Export evidence**.
7. Have the operator run `scripts/verify.ts` for all four exports against an independent RPC with separately pinned receipt key, code hash, ABI and relayer. A local green signature check alone is not independent chain verification.

## Acceptance record

Requests expire after a short bounded lifetime. Preparing a request does not reserve an unlimited signing window. If it expires, dismiss any stale wallet prompt and click **Refresh expired request** in Studio. This preserves the reviewed action payload and obtains a new bounded intent; it does not sign automatically. Review it again, click **Sign and submit**, and confirm the new MetaMask request. A signature returned after expiry is rejected without submitting that expired request.

Record wallet application/version, browser/version, public address, observed wallet chain ID, four transaction IDs and irreversible blocks, exported receipts, independently checked signatures/bindings and observed RAM trace deltas. No seed phrase, private key, API credential or password belongs in the record.

The final human-wallet acceptance gate remains OPEN until this sequence succeeds. Controlled-provider browser tests and previous CLI-signed Jungle4 actions are separate evidence. Human rejection of a signature should leave no new submission; account/network changes require a fresh review. Close the server with Ctrl+C when finished; `pnpm demo` resumes the same local journal next time.
