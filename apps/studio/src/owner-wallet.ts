import {
  PublicKey,
  Signature,
  Transaction,
  UInt64,
  Serializer,
} from "@wharfkit/antelope";
import { JUNGLE4 } from "../../../packages/core/src/index.ts";
import type { Session } from "@wharfkit/session";
let session: Session | undefined;
let kit: import("@wharfkit/session").SessionKit | undefined;
export async function connectOwnerWallet() {
  if (!kit) {
    const [{ SessionKit }, { WebRenderer }, { WalletPluginAnchor }] =
      await Promise.all([
        import("@wharfkit/session"),
        import("@wharfkit/web-renderer"),
        import("@wharfkit/wallet-plugin-anchor"),
      ]);
    const ui = new WebRenderer();
    ui.appendDialogElement();
    const memory = new Map<string, string>();
    kit = new SessionKit(
      {
        appName: "vrstudio",
        chains: [{ id: JUNGLE4, url: "https://jungle4.greymass.com" }],
        ui,
        walletPlugins: [new WalletPluginAnchor()],
      },
      {
        allowModify: false,
        transactPlugins: [],
        storage: {
          async read(k) {
            return memory.get(k) ?? null;
          },
          async write(k, v) {
            memory.set(k, v);
          },
          async remove(k) {
            memory.delete(k);
          },
        },
      },
    );
  }
  const result = await kit.login({
    chain: JUNGLE4,
    walletPlugin: "anchor",
    setAsDefault: false,
  });
  if (
    String(result.session.chain.id) !== JUNGLE4 ||
    String(result.session.permission) !== "active"
  )
    throw Error("Select your native Jungle4 active permission");
  session = result.session;
  return String(session.actor) + "@active";
}
export function ownerWalletTransaction(request: any) {
  const tx = Transaction.from(request.transaction);
  const a = tx.actions[0];
  if (
    request.chainId !== JUNGLE4 ||
    String(tx.id) !== request.transactionId ||
    String(tx.signingDigest(JUNGLE4)) !== request.signingDigest ||
    tx.actions.length !== 1 ||
    tx.context_free_actions.length ||
    tx.transaction_extensions.length ||
    Number(tx.delay_sec) !== 0 ||
    String(a.account) !== request.contract ||
    String(a.name) !== "revoke" ||
    a.authorization.length !== 1 ||
    String(a.authorization[0].actor) !== request.owner ||
    String(a.authorization[0].permission) !== "active" ||
    String(a.data) !==
      String(Serializer.encode({ object: UInt64.from(request.grantId) }))
  )
    throw Error("Wallet request does not match the exact Jungle4 revocation");
  const ms = Date.parse(String(tx.expiration) + "Z") - Date.now();
  if (ms <= 0 || ms > 125000)
    throw Error("Request expired; prepare a new unsigned revocation");
  return tx;
}
export function verifyOwnerWalletResult(request: any, result: any) {
  const tx = ownerWalletTransaction(request);
  if (
    String(result.chain.id) !== JUNGLE4 ||
    String(result.signer.actor) !== request.owner ||
    String(result.signer.permission) !== "active" ||
    !result.transaction ||
    String(Transaction.from(result.transaction).id) !== String(tx.id) ||
    result.signatures.length !== 1 ||
    !Signature.from(result.signatures[0])
      .recoverDigest(tx.signingDigest(JUNGLE4))
      .equals(PublicKey.from(request.publicKey))
  )
    throw Error("Wallet returned a different signer, transaction or signature");
  return String(result.signatures[0]);
}
export async function signOwnerRevocation(request: any) {
  if (
    !session ||
    String(session.actor) !== request.owner ||
    String(session.permission) !== "active" ||
    String(session.chain.id) !== JUNGLE4
  )
    throw Error(
      "Connect Anchor with " + request.owner + "@active on Jungle4 first",
    );
  const tx = ownerWalletTransaction(request);
  const result = await session.transact(
    { transaction: tx },
    { broadcast: false, allowModify: false, transactPlugins: [] },
  );
  return verifyOwnerWalletResult(request, result);
}
