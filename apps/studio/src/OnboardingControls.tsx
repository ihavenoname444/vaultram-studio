import React, { useEffect, useState } from "react";
import { compile, exampleSpec } from "../../../packages/core/src/index.ts";
import {
  ownerWalletTransaction,
  connectOwnerWallet,
  signOwnerRequest,
} from "./owner-wallet.ts";
export function OnboardingControls({
  token,
  contextId,
  activate,
  blocked,
}: {
  token: string;
  contextId: string;
  activate: (id: string) => void;
  blocked: boolean;
}) {
  const [name, setName] = useState(
    "Agent Safe " + new Date().toISOString().slice(0, 16),
  );
  const [budget, setBudget] = useState(5),
    [hours, setHours] = useState(24);
  const [requests, setRequests] = useState<any[]>([]),
    [request, setRequest] = useState<any>();
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [wallet, setWallet] = useState(""),
    [working, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const busy = working || blocked;
  async function api(path = "", body?: object) {
    const response = await fetch("/api/authority/onboarding" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-vaultram-token": token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error ?? "Onboarding failed");
    return result;
  }
  async function refresh() {
    setRequests((await api()).requests);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Onboarding failed");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(refresh);
  }, [token]);
  function exportEvidence(row: any) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(row.evidence, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "owner-app-grant-" + row.id + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="native-card" aria-label="Create app and grant">
      <h2>Create an app and bounded grant</h2>
      <p>
        Your native owner and the resource allocator approve one transaction. It
        registers the specification and grants public memory writes atomically.
      </p>
      <p className="muted">
        Jungle4 only. These are test-write units, not RAM bytes, token spending
        or VaultRAM-backed capacity. The same restricted operator key serves
        these demo grants; this is not key isolation between apps.
        Owner/recovery credentials must remain outside the gateway; OS isolation
        is not established here.
      </p>
      <label>
        New app name{" "}
        <input
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Maximum writes (1–100){" "}
        <input
          type="number"
          min={1}
          max={100}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
        />
      </label>
      <label>
        Lifetime in hours (1–168){" "}
        <input
          type="number"
          min={1}
          max={168}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        />
      </label>
      <button
        className="button"
        disabled={busy}
        onClick={() =>
          void run(async () => setWallet(await connectOwnerWallet()))
        }
      >
        Connect Anchor for app approval
      </button>
      {wallet && <p>Connected: {wallet}</p>}
      <button
        className="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const spec = { ...exampleSpec, name };
            const r = await api("/prepare", {
              spec,
              budget,
              maxPayload: 256,
              hours,
            });
            ownerWalletTransaction(r);
            if (
              JSON.stringify(r.spec) !== JSON.stringify(compile(spec).spec) ||
              r.budget !== budget ||
              r.maxPayload !== 256 ||
              Math.abs(
                r.expires - (Math.floor(Date.now() / 1000) + hours * 3600),
              ) > 30
            )
              throw Error(
                "Prepared request differs from the selected app/limits",
              );
            setRequest(r);
            setSignatures({});
            await refresh();
          })
        }
      >
        Prepare app and grant
      </button>
      {request && (
        <div>
          <h3>Review the exact grant</h3>
          <p>
            <strong>{request.spec.name}</strong> · App #
            {compile(request.spec).appId}
          </p>
          <p>
            Owner: {request.owner}@active · Allocator: {request.allocator}
            @active.
            {request.owner === request.allocator
              ? " One account holds both roles; one approval covers both."
              : " Both distinct accounts must approve."}
          </p>
          <p>
            Contract: {request.contract} · Agent: {request.actor}@
            {request.permission} · Namespace: memory.
          </p>
          <p>
            <strong>
              {request.budget} writes, up to {request.maxPayload} UTF-8 bytes
              per payload.
            </strong>{" "}
            Grant expires {new Date(request.expires * 1000).toISOString()}.
          </p>
          <p>
            Actions: register app + issue grant. The grant permits
            reserve/consume only. It does not authorize payments or arbitrary
            calls.
          </p>
          <p>
            Specification hash: <code>{compile(request.spec).appHash}</code>
          </p>
          <details>
            <summary>Registered specification</summary>
            <pre>{JSON.stringify(request.spec, null, 2)}</pre>
          </details>
          <p>
            Sign before {request.transaction.expiration} UTC. Signing does not
            broadcast.
          </p>
          {request.signers.map((s: any) => (
            <div key={s.actor}>
              <button
                className="button"
                disabled={busy || wallet !== s.actor + "@active"}
                onClick={() =>
                  void run(async () => {
                    const signature = await signOwnerRequest(request, s.actor);
                    setSignatures((old) => ({ ...old, [s.actor]: signature }));
                    setMessage(
                      "Signature checked. Submit only after every required approval.",
                    );
                  })
                }
              >
                Sign app and grant as {s.actor}
              </button>
              <span>
                {signatures[s.actor]
                  ? " Signature verified"
                  : " Approval needed"}
              </span>
            </div>
          ))}
          <button
            className="button primary"
            disabled={
              busy || !request.signers.every((s: any) => signatures[s.actor])
            }
            onClick={() =>
              void run(async () => {
                const r = await api("/submit", {
                  id: request.id,
                  signatures: request.signers.map(
                    (s: any) => signatures[s.actor],
                  ),
                });
                setSignatures({});
                setRequest(undefined);
                setMessage(
                  r.status === "IRREVERSIBLE"
                    ? "App and grant verified. Select the new app below."
                    : "Submitted once. Reconcile before any retry.",
                );
                await refresh();
              })
            }
          >
            Submit approved app and grant
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <h3>App workspaces</h3>
      <button
        className="button small"
        disabled={busy}
        onClick={() => activate("")}
      >
        Original demo workspace
      </button>
      {requests.map((r) => (
        <div key={r.id}>
          <p>
            {r.request.spec.name} · {r.status}
            {contextId === r.id ? " · selected" : ""}
          </p>
          {r.status !== "PREPARED" && (
            <button
              className="button small"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api("/reconcile", { id: r.id });
                  setMessage(
                    result.verificationUnavailable
                      ? "Fresh verification unavailable; do not treat historical status as fresh confirmation."
                      : result.status,
                  );
                  await refresh();
                })
              }
            >
              Reconcile app and grant
            </button>
          )}
          {r.status === "IRREVERSIBLE" && (
            <button
              className="button small"
              disabled={busy}
              onClick={() => activate(r.id)}
            >
              Use this app
            </button>
          )}
          {r.evidence && (
            <button className="button small" onClick={() => exportEvidence(r)}>
              Export app/grant evidence
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
