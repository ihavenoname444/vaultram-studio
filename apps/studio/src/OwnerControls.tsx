import React, { useState } from "react";
import { connectOwnerWallet, signOwnerRevocation } from "./owner-wallet.ts";
export function OwnerControls({
  api,
  refresh,
  requests,
}: {
  api: (path: string, body?: object) => Promise<any>;
  refresh: () => Promise<void>;
  requests: any[];
}) {
  const [request, setRequest] = useState<any>();
  const [wallet, setWallet] = useState("");
  const [signature, setSignature] = useState("");
  const [sendAfterApproval, setSendAfterApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Owner request failed");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(request, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "owner-revoke-request.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="native-card" aria-label="External owner signing">
      <h2>Owner control</h2>
      <p>
        Revoke this grant using its native owner's external signer. The gateway
        prepares the request and checks the returned signature; it never signs
        this action. Completed records remain public.
      </p>
      <p className="muted">
        Connect Anchor on Jungle4, prepare the request, then approve it in your
        wallet. By default, submit the checked signature below. You can instead
        choose to submit immediately after a checked wallet approval. Create new
        apps and grants in the section above. Key-custody migration is not
        included. Never enter a private key or seed phrase.
      </p>
      <button
        className="button"
        disabled={busy}
        onClick={() =>
          void run(async () => setWallet(await connectOwnerWallet()))
        }
      >
        Connect Anchor
      </button>
      {wallet && <p>Connected: {wallet}</p>}
      <button
        className="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setRequest(await api("/owner/prepare", { action: "revoke" }));
            setSignature("");
            await refresh();
          })
        }
      >
        Prepare unsigned revocation
      </button>
      {request && (
        <>
          <p>
            Owner <strong>{request.owner}@active</strong> · Grant #
            {request.grantId} · Contract <code>{request.contract}</code>
          </p>
          <p>{request.review}</p>
          <p>
            Jungle4 · Expires {request.transaction.expiration} UTC. Verify the
            exact action and chain in the external signer.
          </p>
          <label>
            <input
              type="checkbox"
              checked={sendAfterApproval}
              disabled={busy}
              onChange={(e) => setSendAfterApproval(e.target.checked)}
            />
            Submit immediately after checked wallet approval
          </label>
          <button
            className="button"
            disabled={busy || !wallet}
            onClick={() =>
              void run(async () => {
                const checked = await signOwnerRevocation(request);
                setSignature(checked);
                if (sendAfterApproval) {
                  const result = await api("/owner/submit", {
                    id: request.id,
                    signatures: [checked],
                  });
                  setMessage(result.status);
                  await refresh();
                } else {
                  setMessage(
                    "Wallet signature checked. Submit signed revocation to send it.",
                  );
                }
              })
            }
          >
            {sendAfterApproval
              ? "Approve and submit with Anchor"
              : "Sign with Anchor"}
          </button>
          <button className="button" onClick={download}>
            Export unsigned request
          </button>
          <label htmlFor="owner-signature">
            Returned public signature (SIG_K1… or SIG_R1…)
          </label>
          <textarea
            id="owner-signature"
            value={signature}
            rows={2}
            onChange={(e) => setSignature(e.target.value)}
          />
          <button
            className="button"
            disabled={
              busy ||
              !/^SIG_(K1|R1)_[1-9A-HJ-NP-Za-km-z]+$/.test(signature.trim())
            }
            onClick={() =>
              void run(async () => {
                const r = await api("/owner/submit", {
                  id: request.id,
                  signatures: [signature.trim()],
                });
                setMessage(r.status);
                await refresh();
              })
            }
          >
            Submit signed revocation
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {requests.map((r) => (
        <div key={r.id}>
          <p>
            Owner request {r.id}: {r.status}
          </p>
          {r.status !== "PREPARED" && (
            <button
              className="button small"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api("/owner/reconcile", { id: r.id });
                  setMessage(result.status);
                  await refresh();
                })
              }
            >
              Reconcile owner request
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
