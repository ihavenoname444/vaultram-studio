import React, { useEffect, useState } from "react";
type Props = { token: string; appId?: string; appName?: string };
export function AuthorityPanel({ token, appId, appName }: Props) {
  const [state, setState] = useState<any>(),
    [review, setReview] = useState<any>(),
    [text, setText] = useState(
      "An agent may act only within its native grant.",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  async function api(path: string, body?: object) {
    const r = await fetch("/api/authority" + path, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "content-type": "application/json", "x-vaultram-token": token }
        : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error ?? "Native authority request failed");
    return j;
  }
  async function refresh() {
    setState(await api(""));
  }
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void task(refresh);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [token]);
  useEffect(() => setReview(undefined), [appId]);
  const g = state?.grant,
    c = state?.configuration;
  const usable =
    g &&
    !g.revoked &&
    Number(g.expires) * 1000 > now &&
    Number(g.available) > 0;
  const encoded = JSON.stringify({ appId, kind: "memory", text }),
    bytes = new TextEncoder().encode(encoded).length;
  const expired = review && Date.parse(review.expires + "Z") <= now;
  function download(evidence: unknown, id: string) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(evidence, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "vaultram-native-" + id + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className="native-workspace">
      <div className="native-intro">
        <span className="eyebrow">VAULTA · NATIVE AUTHORITY · JUNGLE4</span>
        <h1>Permission before action.</h1>
        <p>
          Write a public agent memory within a grant enforced by the Vaulta
          contract. Reservation and execution commit together.
        </p>
      </div>
      {error && (
        <div className="native-alert" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="native-card" aria-label="Native authority grant">
        <div className="native-heading">
          <h2>Agent authority</h2>
          <button
            className="button small"
            disabled={busy}
            onClick={() => void task(refresh)}
          >
            Refresh authority
          </button>
        </div>
        {!state ? (
          <p>Checking native deployment and grant…</p>
        ) : (
          <>
            <div className="native-grid">
              <div>
                <small>Native actor</small>
                <strong>
                  {c.actor}@{c.permission}
                </strong>
              </div>
              <div>
                <small>Grant / namespace</small>
                <strong>
                  #{g?.id} / {g?.space}
                </strong>
              </div>
              <div>
                <small>Remaining writes</small>
                <strong>
                  {g?.available} / {g?.budget}
                </strong>
              </div>
              <div>
                <small>Status</small>
                <strong>
                  {g?.revoked
                    ? "REVOKED"
                    : Number(g?.expires) * 1000 <= now
                      ? "EXPIRED"
                      : usable
                        ? "ACTIVE"
                        : "EXHAUSTED"}
                </strong>
              </div>
            </div>
            <p>
              Contract <code>{c.account}</code> · Expires{" "}
              {g ? new Date(Number(g.expires) * 1000).toLocaleString() : "—"}
            </p>
            <p className="muted">
              Local test operator signing with a restricted native key. MetaMask
              is not used for this flow. The key can reserve and consume; it
              cannot grant more capacity or transfer tokens.
            </p>
          </>
        )}
      </section>
      <section className="native-card">
        <h2>Write public memory</h2>
        <p>
          Application:{" "}
          <strong>
            {appName ?? "Choose or compile an application in Templates first"}
          </strong>
        </p>
        <label htmlFor="native-memory">Public memory</label>
        <textarea
          id="native-memory"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setReview(undefined);
          }}
          rows={4}
        />
        <div className="native-heading">
          <small>
            {bytes} / 256 UTF-8 bytes, including application binding
          </small>
          <button
            className="button primary"
            disabled={busy || !usable || !appId || !text || bytes > 256}
            onClick={() =>
              void task(async () =>
                setReview(await api("/prepare", { appId, text })),
              )
            }
          >
            Prepare native write
          </button>
        </div>
      </section>
      <section className="native-card">
        <h2>Chain evidence</h2>
        <p className="muted">
          Only an executed transaction in an irreversible block, checked through
          a separate RPC, receives an irreversible status. Refresh and reconcile
          never resubmit a write.
        </p>
        {state?.operations?.length === 0 && (
          <p>No native writes prepared yet.</p>
        )}
        {state?.operations?.map((op: any) => (
          <article className="native-operation" key={op.id}>
            <strong>{op.status}</strong>
            <code>{op.txid}</code>
            {op.evidence && (
              <p>
                Irreversible block {op.evidence.block} · Effect #
                {op.evidence.effect.id}
              </p>
            )}
            {op.error && <p>{op.error}</p>}
            <div className="native-buttons">
              <button
                className="button small"
                disabled={busy || op.status === "PREPARED"}
                onClick={() =>
                  void task(async () => {
                    const r = await api("/reconcile", { id: op.id });
                    await refresh();
                    setNotice(
                      r.verificationUnavailable
                        ? "Fresh verification unavailable; any displayed evidence is historical."
                        : r.status === "IRREVERSIBLE"
                          ? "Native write independently verified as irreversible."
                          : "Still awaiting independent finality. No resubmission occurred.",
                    );
                  })
                }
              >
                Reconcile native write
              </button>
              <button
                className="button small"
                disabled={!op.evidence}
                onClick={() => download(op.evidence, op.id)}
              >
                Export native evidence
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="native-card">
        <h2>Public state</h2>
        {state?.effects?.length === 0 ? (
          <p>No protected effects yet.</p>
        ) : (
          state?.effects?.map((e: any) => (
            <article className="native-operation" key={e.id}>
              <strong>Effect #{e.id}</strong>
              <pre>{e.payload}</pre>
            </article>
          ))
        )}
        <p className="muted">
          The contract administrator can upgrade code; chain and RPC trust
          remain. This demonstrates bounded native writes, not cross-chain
          authority or a comparative safety ranking.
        </p>
      </section>
      {review && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Review native authority write"
          >
            <button
              className="modal-close"
              aria-label="Close native review"
              disabled={busy}
              onClick={() => setReview(undefined)}
            >
              ×
            </button>
            <h2>Review native authority write</h2>
            <p>
              One unit from grant #{review.grant.id}. Actor{" "}
              {review.configuration.actor}@{review.configuration.permission}.
              Jungle4 contract {review.configuration.account}.
            </p>
            <pre>{review.payload}</pre>
            <p>
              {expired
                ? "Review expired. Close and prepare again."
                : "Valid until " +
                  new Date(review.expires + "Z").toLocaleTimeString()}
            </p>
            <p>
              The local restricted agent key signs this public write. No wallet
              approval or token transfer is requested.
            </p>
            <button
              className="button primary full"
              disabled={busy || expired}
              onClick={() =>
                void task(async () => {
                  const r = await api("/execute", {
                    id: review.id,
                    payloadHash: review.payloadHash,
                  });
                  setReview(undefined);
                  await refresh();
                  setNotice(
                    r.status === "IRREVERSIBLE"
                      ? "Native write independently verified as irreversible."
                      : "Submitted once. Use Reconcile native write to check finality.",
                  );
                })
              }
            >
              {busy ? "Checking chain…" : "Execute native write"}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
