import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Braces,
  Check,
  ChevronRight,
  Code2,
  Database,
  Download,
  FileCode2,
  Fingerprint,
  Layers3,
  LoaderCircle,
  Play,
  Plus,
  Radio,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
  X,
} from "lucide-react";
import {
  createWalletClient,
  custom,
  type EIP1193Provider,
  type Hex,
} from "viem";
import {
  canonical,
  typedData,
  estimate,
  validateReviewIntent,
  type Compiled,
  type Intent,
  type Payload,
  type SignedReceipt,
  type StateRow,
} from "../../../packages/core/src/index.ts";
import "./style.css";
import { AuthorityPanel } from "./AuthorityPanel.tsx";
declare global {
  interface Window {
    ethereum?: EIP1193Provider & {
      on?: (name: string, fn: () => void) => void;
      removeListener?: (name: string, fn: () => void) => void;
    };
  }
}
type Config = {
  authorityEnabled?: boolean;
  ownerControlEnabled?: boolean;
  mode: "SIMULATED" | "JUNGLE4";
  runtime: string;
  runtimeCodeHash: string;
  token: string;
  ai: string;
  receiptPublicKey: string;
  demoOwner?: string;
  trust: string;
};
type App = Compiled & {
  deployed?: boolean;
  provenance?: string;
  note?: string;
};
type Submission = {
  hash: string;
  status: string;
  receipt: SignedReceipt | null;
};
const short = (s: string) => s.slice(0, 7) + "…" + s.slice(-5);
function Studio() {
  const [workspace, setWorkspace] = useState<"authority" | "templates">(
    "authority",
  );
  const [config, setConfig] = useState<Config>();
  const [apps, setApps] = useState<App[]>([]);
  const [app, setApp] = useState<App>();
  const [rows, setRows] = useState<StateRow[]>([]);
  const [receipts, setReceipts] = useState<Submission[]>([]);
  const [prompt, setPrompt] = useState(
    "Build a marketplace where AI agents publish their services and keep small public memories.",
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"preview" | "source" | "state">("preview");
  const [file, setFile] = useState("app.spec.json");
  const [owner, setOwner] = useState("");
  const [demo, setDemo] = useState(false);
  const [chainId, setChainId] = useState(1);
  const [action, setAction] = useState<Payload["action"]>("createagent");
  const [name, setName] = useState("Research agent");
  const [content, setContent] = useState(
    "Finds and summarizes public technical documentation.",
  );
  const [parent, setParent] = useState("");
  const [status, setStatus] = useState<"active" | "paused">("paused");
  const [review, setReview] = useState<{ payload: Payload; intent?: Intent }>();
  const [reviewNow, setReviewNow] = useState(() =>
    Math.floor(Date.now() / 1000),
  );
  const reviewExpired = !!review?.intent && review.intent.expires <= reviewNow;
  useEffect(() => {
    setReviewNow(Math.floor(Date.now() / 1000));
    if (!review?.intent) return;
    const timer = setInterval(
      () => setReviewNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [review?.intent?.expires]);
  const [selected, setSelected] = useState<Submission>();
  const [logs, setLogs] = useState<string[]>([
    "Studio initialized. Compile a specification to begin.",
  ]);
  function log(message: string) {
    setLogs((x) =>
      [new Date().toLocaleTimeString("en-GB") + "  " + message, ...x].slice(
        0,
        30,
      ),
    );
  }
  async function api<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch("/api" + path, {
      method: body ? "POST" : "GET",
      headers: body
        ? {
            "content-type": "application/json",
            "x-vaultram-token": config?.token ?? "",
          }
        : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }
  async function task(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      log("ERROR · " + (e instanceof Error ? e.message : "Request failed"));
    } finally {
      setBusy("");
    }
  }
  async function refresh(id?: string) {
    const list = await api<App[]>("/apps");
    setApps(list);
    const current = list.find((x) => x.appId === id) ?? list[0];
    if (current) {
      setApp(current);
      setRows(await api<StateRow[]>("/apps/" + current.appId + "/state"));
    }
    setReceipts(await api<Submission[]>("/receipts"));
  }
  useEffect(() => {
    fetch("/api/config")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setConfig)
      .catch(() =>
        setError("Gateway unavailable. Start the app with pnpm dev."),
      );
  }, []);
  useEffect(() => {
    if (config) void refresh().catch((e) => setError(e.message));
  }, [config]);
  useEffect(() => {
    setParent("");
    setReview(undefined);
  }, [app?.appId, owner]);
  useEffect(() => {
    const reset = () => {
      setOwner("");
      setDemo(false);
      setReview(undefined);
    };
    window.ethereum?.on?.("accountsChanged", reset);
    window.ethereum?.on?.("chainChanged", reset);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", reset);
      window.ethereum?.removeListener?.("chainChanged", reset);
    };
  }, []);
  const ownAgents = rows.filter(
    (r) => r.action === "createagent" && r.owner === owner.toLowerCase(),
  );
  async function connect() {
    await task("Connecting wallet", async () => {
      if (!window.ethereum)
        throw new Error(
          "No browser wallet detected. Open this local URL in a browser with an EVM wallet, or use the explicitly labelled demo signer in simulation mode.",
        );
      const client = createWalletClient({ transport: custom(window.ethereum) });
      const [address] = await client.requestAddresses();
      if (!address) throw new Error("No wallet account selected.");
      setChainId(await client.getChainId());
      setOwner(address.toLowerCase());
      setDemo(false);
      log("EOA wallet connected. No transaction or token approval requested.");
    });
  }
  async function build() {
    await task("Compiling specification", async () => {
      const generated = await api<App>("/compile", { prompt });
      setApp(generated);
      setFile("app.spec.json");
      setTab("preview");
      setRows([]);
      setNotice(generated.note ?? "");
      log(
        (generated.provenance ?? "") +
          " · AppSpec validated; template v1 compiled.",
      );
      const list = await api<App[]>("/apps");
      setApps(list);
    });
  }
  async function deploy() {
    if (!app) return;
    await task("Checking deployment", async () => {
      const result = await api<{ status: string }>("/deploy", {
        appId: app.appId,
      });
      setApp({ ...app, deployed: true });
      log(result.status + " · Runtime ready for scoped actions.");
    });
  }
  async function prepare() {
    if (!app) return;
    await task("Preparing intent", async () => {
      if (!owner)
        throw new Error(
          config?.mode === "JUNGLE4"
            ? "Connect a wallet first. Jungle4 requires your signature."
            : "Connect a wallet or select the demo signer first.",
        );
      const id = Date.now().toString();
      const agent = parent || ownAgents[0]?.id;
      const payload: Payload =
        action === "createagent"
          ? { action, id, name, description: content }
          : action === "pubservice"
            ? {
                action,
                id,
                agentId: agent ?? "",
                title: name,
                description: content,
              }
            : action === "writemem"
              ? { action, id, agentId: agent ?? "", content }
              : { action, id: agent ?? "", status };
      if (demo) setReview({ payload });
      else {
        const result = await api<{ intent: Intent }>("/intent", {
          appId: app.appId,
          payload,
          owner,
          sourceChainId: chainId,
        });
        if (!config) throw new Error("Gateway configuration unavailable");
        validateReviewIntent(result.intent, {
          app,
          payload,
          owner,
          sourceChainId: chainId,
          runtime: config.runtime,
          runtimeCodeHash: config.runtimeCodeHash,
        });
        setReview({ payload, intent: result.intent });
      }
    });
  }
  async function renewReview() {
    if (!review || !app || !config) return;
    const payload = review.payload;
    await task("Refreshing signing request", async () => {
      const result = await api<{ intent: Intent }>("/intent", {
        appId: app.appId,
        payload,
        owner,
        sourceChainId: chainId,
      });
      validateReviewIntent(result.intent, {
        app,
        payload,
        owner,
        sourceChainId: chainId,
        runtime: config.runtime,
        runtimeCodeHash: config.runtimeCodeHash,
      });
      setReview({ payload, intent: result.intent });
      setNotice("Fresh request prepared. Review it, then sign again.");
    });
  }
  async function submit() {
    if (!review || !app) return;
    await task(
      demo ? "Running simulation" : "Waiting for wallet signature",
      async () => {
        let result: Submission;
        if (demo)
          result = await api("/simulate", {
            appId: app.appId,
            payload: review.payload,
          });
        else {
          if (!window.ethereum || !review.intent || !config)
            throw new Error("Wallet disconnected");
          validateReviewIntent(review.intent, {
            app,
            payload: review.payload,
            owner,
            sourceChainId: chainId,
            runtime: config.runtime,
            runtimeCodeHash: config.runtimeCodeHash,
          });
          const client = createWalletClient({
            transport: custom(window.ethereum),
          });
          const [account] = await client.getAddresses();
          if (
            !account ||
            account.toLowerCase() !== owner ||
            (await client.getChainId()) !== chainId
          )
            throw new Error("Wallet changed. Prepare a new intent.");
          const signature = await client.signTypedData({
            ...typedData(review.intent),
            account,
          });
          if (review.intent.expires <= Math.floor(Date.now() / 1000))
            throw new Error(
              "The signature arrived after this request expired. Refresh the expired request, review it and sign again. Nothing was submitted.",
            );
          const [currentAccount] = await client.getAddresses();
          if (
            !currentAccount ||
            currentAccount.toLowerCase() !== owner ||
            (await client.getChainId()) !== chainId
          )
            throw new Error(
              "Wallet changed during signing. Prepare a new intent.",
            );
          result = await api("/execute", { intent: review.intent, signature });
        }
        setReview(undefined);
        await refresh(app.appId);
        setSelected(result);
        log(
          result.status +
            " · " +
            review.payload.action +
            " · " +
            short(result.hash),
        );
      },
    );
  }
  async function download(hash: string) {
    await task("Exporting evidence", async () => {
      const data = await api("/export/" + hash);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "vaultram-" + hash.slice(2, 10) + ".json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  async function verifyLocal(record: Submission) {
    await task("Verifying receipt", async () => {
      if (!record.receipt || !config) throw new Error("No signed receipt");
      const r = record.receipt;
      if (r.publicKey !== config.receiptPublicKey)
        throw new Error("Receipt key differs from this installation");
      const bytes = Uint8Array.from(
        atob(r.publicKey.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
        (c) => c.charCodeAt(0),
      );
      const key = await crypto.subtle.importKey(
        "spki",
        bytes,
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      const valid = await crypto.subtle.verify(
        "Ed25519",
        key,
        Uint8Array.from(atob(r.signature), (c) => c.charCodeAt(0)),
        new TextEncoder().encode(canonical(r.receipt)),
      );
      if (!valid) throw new Error("Invalid receipt signature");
      setNotice(
        "Receipt signature is valid against this gateway’s key. This does not prove blockchain execution. Export evidence for the independent CLI verifier.",
      );
      log("Ed25519 receipt signature verified.");
    });
  }
  const activeReceipts = receipts.filter(
    (r) => r.receipt?.receipt.appId === app?.appId,
  );
  if (config?.authorityEnabled && workspace === "authority")
    return (
      <div className="shell">
        <header className="topbar">
          <a className="brand" href="/">
            {" "}
            <span className="brand-mark">V</span>VaultRAM{" "}
            <span className="slash">/</span>
            <span className="muted">studio</span>
          </a>
          <div className="top-meta">
            <span className="badge green">NATIVE AUTHORITY · JUNGLE4</span>
            <button
              className="button small"
              onClick={() => setWorkspace("templates")}
            >
              Templates / EVM demo
            </button>
          </div>
        </header>
        <AuthorityPanel
          ownerControlEnabled={config.ownerControlEnabled}
          token={config.token}
          appId={app?.appId}
          appName={app?.spec.name}
          appHash={app?.appHash}
        />
      </div>
    );
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="VaultRAM Studio home">
          <span className="brand-mark">V</span>VaultRAM{" "}
          <span className="slash">/</span>
          <span className="muted">studio</span>
        </a>
        <div className="top-meta">
          {config?.authorityEnabled && (
            <button
              className="button small"
              onClick={() => setWorkspace("authority")}
            >
              Native authority
            </button>
          )}
          <span className="network">
            <span className="dot" />
            Jungle4 target
          </span>
          <span
            className={
              "badge " + (config?.mode === "JUNGLE4" ? "green" : "amber")
            }
          >
            {config?.mode ?? "CONNECTING"}
          </span>
          <button className="button small" onClick={connect} disabled={!!busy}>
            <Wallet size={14} />
            {owner ? short(owner) : "Connect wallet"}
          </button>
        </div>
      </header>
      <div className="subbar">
        <div>
          <Layers3 size={15} />
          <span>Workspace</span>
          <ChevronRight size={12} />
          <select
            aria-label="Select application"
            value={app?.appId ?? ""}
            onChange={(e) =>
              void task("Opening app", () => refresh(e.target.value))
            }
          >
            <option value="" disabled>
              New application
            </option>
            {apps.map((a) => (
              <option key={a.appId} value={a.appId}>
                {a.spec.name}
              </option>
            ))}
          </select>
        </div>
        <span className="mono subtle">
          LOCAL WORKSPACE <span className="tiny-dot">·</span> TEMPLATE v1
        </span>
      </div>
      <div className="workspace">
        <aside className="explorer">
          <div className="panel-heading">
            EXPLORER <FileCode2 size={14} />
          </div>
          <div className="folder">
            <ChevronRight size={13} />{" "}
            {app ? "agent-marketplace" : "your-application"}
          </div>
          <div className="files">
            {Object.keys(app?.files ?? { "app.spec.json": "" }).map((f) => (
              <button
                key={f}
                className={
                  file === f && tab === "source" ? "file selected" : "file"
                }
                onClick={() => {
                  setFile(f);
                  setTab("source");
                }}
              >
                <FileCode2 size={14} />
                {f.replace("generated/", "")}
                <span className="file-dot" />
              </button>
            ))}
          </div>
          <div className="explorer-rule" />
          <div className="panel-heading">BUILD CHECKLIST</div>
          {[
            ["Specification validated", !!app],
            ["Template compiled", !!app],
            ["Runtime ready", !!app?.deployed],
            ["Signed action recorded", activeReceipts.length > 0],
          ].map(([label, done], i) => (
            <div
              className={"checkstep " + (done ? "done" : "")}
              key={String(label)}
            >
              <span>{done ? <Check size={11} /> : i + 1}</span>
              {label}
            </div>
          ))}
          <div className="explorer-bottom">
            <ShieldCheck size={17} />
            <strong>Bounded by design</strong>
            <p>Explicit actions. Owner scopes. Short-lived signatures.</p>
            <span className="tiny muted">Trusted relayer · EOA wallets</span>
          </div>
        </aside>
        <main className="main">
          <div className="preview-bar">
            <div className="tabs">
              {(["preview", "source", "state"] as const).map((t) => (
                <button
                  className={tab === t ? "active" : ""}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {t === "preview" ? (
                    <Play size={13} />
                  ) : t === "source" ? (
                    <Code2 size={14} />
                  ) : (
                    <Database size={13} />
                  )}{" "}
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <button
              className="text-button"
              onClick={() => void task("Refreshing", () => refresh(app?.appId))}
            >
              <Radio size={13} />
              Refresh
            </button>
          </div>
          <div className="canvas">
            {error && (
              <div role="alert" className="alert error">
                <span>{error}</span>
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={14} />
                </button>
              </div>
            )}
            {notice && (
              <div role="status" className="alert">
                <span>{notice}</span>
                <button
                  aria-label="Dismiss notice"
                  onClick={() => setNotice("")}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {!app ? (
              <div className="welcome">
                <div className="orb">
                  <Layers3 size={32} />
                </div>
                <span className="eyebrow">FROM IDEA TO INSPECTABLE STATE</span>
                <h1>
                  A home for your
                  <br />
                  <em>agents’ next move.</em>
                </h1>
                <p>
                  Describe an application. Compile a bounded runtime.
                  <br />
                  Inspect every signed action and its receipt.
                </p>
                <button
                  className="button primary"
                  onClick={build}
                  disabled={!!busy || !config}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  Build example application
                  <ArrowRight size={15} />
                </button>
                <div className="welcome-steps">
                  <span>
                    <Braces size={17} />
                    Describe
                  </span>
                  <i />
                  <span>
                    <Layers3 size={17} />
                    Compile
                  </span>
                  <i />
                  <span>
                    <Fingerprint size={17} />
                    Verify
                  </span>
                </div>
                <p className="tiny">
                  Example mode works locally. Real Jungle4 execution requires a
                  deployed runtime.
                </p>
              </div>
            ) : tab === "source" ? (
              <div className="source-pane">
                <div className="source-title">
                  <FileCode2 size={15} />
                  {file}
                  <span className="badge">DETERMINISTIC</span>
                </div>
                <pre>{app.files[file as keyof typeof app.files] ?? ""}</pre>
                <div className="source-foot mono">App hash {app.appHash}</div>
              </div>
            ) : tab === "state" ? (
              <div className="state-pane">
                <div className="section-title">
                  <h2>State inspector</h2>
                  <span className="badge">
                    {config?.mode === "SIMULATED"
                      ? "LOCAL SQLITE"
                      : "RPC OBSERVATION"}
                  </span>
                </div>
                <p className="muted">
                  Public application state. Never store secrets or personal
                  data.
                </p>
                {rows.length ? (
                  <div className="state-list">
                    {rows.map((row) => (
                      <details key={row.id}>
                        <summary>
                          <Database size={14} />
                          {row.action}
                          <code>#{row.id}</code>
                          <span>{short(row.owner)}</span>
                        </summary>
                        <pre>{JSON.stringify(row, null, 2)}</pre>
                      </details>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    No state yet. Execute your first bounded action.
                  </div>
                )}
              </div>
            ) : (
              <div className={"app-preview accent-" + app.spec.accent}>
                <div className="app-nav">
                  <span>
                    <span className="mini-logo">a</span>
                    {app.spec.name}
                  </span>
                  <span className="tiny muted">
                    GENERATED PREVIEW <span className="tiny-dot">·</span> v1
                  </span>
                </div>
                <div className="app-intro">
                  <div>
                    <span className="eyebrow">THE AGENT COMMONS</span>
                    <h1>
                      Small actions.
                      <br />
                      Lasting state.
                    </h1>
                    <p>{app.spec.description}</p>
                  </div>
                  <div className="state-symbol">
                    <Database size={40} strokeWidth={1} />
                    <span className="satellite one" />
                    <span className="satellite two" />
                  </div>
                </div>
                <div className="stats">
                  {[
                    [
                      "Agents",
                      rows.filter((r) => r.action === "createagent").length,
                    ],
                    [
                      "Services",
                      rows.filter((r) => r.action === "pubservice").length,
                    ],
                    [
                      "Memories",
                      rows.filter((r) => r.action === "writemem").length,
                    ],
                  ].map(([label, count]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{String(count).padStart(2, "0")}</strong>
                      <small>public records</small>
                    </div>
                  ))}
                </div>
                <div className="section-title">
                  <h2>Public agents</h2>
                  <span className="tiny muted">OWNERS SHOWN BELOW</span>
                </div>
                <div className="agents">
                  {rows.filter((r) => r.action === "createagent").length ? (
                    rows
                      .filter((r) => r.action === "createagent")
                      .map((row) => (
                        <div className="agent-card" key={row.id}>
                          <div className="agent-top">
                            <span className="avatar">
                              <Sparkles size={19} />
                            </span>
                            <span
                              className={
                                "badge " +
                                (row.status === "active" ? "green" : "amber")
                              }
                            >
                              {row.status}
                            </span>
                          </div>
                          <h3>{"name" in row.data ? row.data.name : ""}</h3>
                          <p>
                            {"description" in row.data
                              ? row.data.description
                              : ""}
                          </p>
                          <div className="card-bottom">
                            <code>{short(row.owner)}</code>
                            <button
                              className="text-button"
                              onClick={() => setTab("state")}
                            >
                              Inspect
                              <ArrowUpRight size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                  ) : (
                    <div className="empty agent-empty">
                      <Plus size={22} />
                      <strong>Your first agent starts here</strong>
                      <span>
                        Connect a signer, then create a public agent below.
                      </span>
                    </div>
                  )}
                </div>
                <div className="action-panel">
                  <div className="section-title">
                    <h2>Execute an action</h2>
                    <span className="badge">
                      {app.deployed ? "RUNTIME READY" : "DEPLOY REQUIRED"}
                    </span>
                  </div>
                  <div className="action-tabs">
                    {(
                      [
                        "createagent",
                        "pubservice",
                        "writemem",
                        "setstate",
                      ] as const
                    ).map((a, i) => (
                      <button
                        className={action === a ? "active" : ""}
                        key={a}
                        onClick={() => {
                          setAction(a);
                          setReview(undefined);
                        }}
                      >
                        {
                          [
                            "Create agent",
                            "Publish service",
                            "Write memory",
                            "Update status",
                          ][i]
                        }
                      </button>
                    ))}
                  </div>
                  <div className="form-grid">
                    {action !== "createagent" && (
                      <label>
                        Agent
                        <select
                          value={parent || ownAgents[0]?.id || ""}
                          onChange={(e) => setParent(e.target.value)}
                        >
                          <option value="" disabled>
                            Select an agent you own
                          </option>
                          {ownAgents.map((r) => (
                            <option key={r.id} value={r.id}>
                              {"name" in r.data ? r.data.name : r.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {(action === "createagent" || action === "pubservice") && (
                      <label>
                        {action === "createagent"
                          ? "Agent name"
                          : "Service title"}
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          maxLength={action === "createagent" ? 60 : 80}
                        />
                      </label>
                    )}
                    {action !== "setstate" ? (
                      <label className="wide">
                        {action === "writemem"
                          ? "Public memory"
                          : "Description"}
                        <textarea
                          value={content}
                          onChange={(e) => setContent(e.target.value)}
                          maxLength={action === "writemem" ? 1024 : 500}
                        />
                      </label>
                    ) : (
                      <label>
                        Status
                        <select
                          value={status}
                          onChange={(e) =>
                            setStatus(e.target.value as "active" | "paused")
                          }
                        >
                          <option>paused</option>
                          <option>active</option>
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="action-bottom">
                    <span>
                      <ShieldCheck size={13} />
                      No token approval. No EVM transaction.
                    </span>
                    <button
                      className="button primary"
                      disabled={!!busy || !app.deployed}
                      onClick={prepare}
                    >
                      Prepare action
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="console">
            <div className="console-head">
              <span>
                <Terminal size={14} />
                Execution console
              </span>
              <span className="tiny">{activeReceipts.length} RECEIPTS</span>
            </div>
            <div className="console-content">
              <div className="logs">
                {logs.map((line, i) => (
                  <div key={i}>
                    <span className="log-mark">›</span>
                    {line}
                  </div>
                ))}
              </div>
              <div className="receipt-strip">
                {activeReceipts.slice(0, 3).map((r) => (
                  <button key={r.hash} onClick={() => setSelected(r)}>
                    <Fingerprint size={14} />
                    <code>{short(r.hash)}</code>
                    <span
                      className={
                        "badge " +
                        (r.status === "IRREVERSIBLE" ? "green" : "amber")
                      }
                    >
                      {r.status}
                    </span>
                    <ChevronRight size={12} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </main>
        <aside className="assistant">
          <div className="panel-heading">
            <span>
              <Sparkles size={14} />
              BUILD ASSISTANT
            </span>
            <span className="badge">{config?.ai ?? "…"}</span>
          </div>
          <div className="assistant-body">
            <div className="assistant-avatar">
              <Sparkles size={18} />
            </div>
            <h2>What will you build?</h2>
            <p>
              Start with one useful workflow. The compiler turns a validated
              specification into a bounded application.
            </p>
            <div className="template-chip">
              <Layers3 size={15} />
              <div>
                <strong>Agent marketplace</strong>
                <span>Versioned template · v1</span>
              </div>
              <Check size={14} />
            </div>
            <label className="prompt-label" htmlFor="prompt">
              DESCRIBE YOUR APP
            </label>
            <textarea
              id="prompt"
              className="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={4000}
            />
            <button
              className="button primary full"
              onClick={build}
              disabled={!!busy || !config}
            >
              {busy === "Compiling specification" ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Compile application
              <ArrowRight size={15} />
            </button>
            <p className="tiny muted">
              {config?.ai === "OPENAI"
                ? "AI drafts descriptive fields. Validated templates control code and permissions."
                : "Fixture mode: loads the example specification. Your prompt is not sent to an AI provider."}
            </p>
            <div className="side-rule" />
            <div className="section-title">
              <h3>Execution environment</h3>
              <span className="dot" />
            </div>
            <dl>
              <dt>Target network</dt>
              <dd>Jungle4</dd>
              <dt>Runtime</dt>
              <dd className="mono">{config?.runtime ?? "—"}</dd>
              <dt>Storage</dt>
              <dd>
                {config?.mode === "SIMULATED" ? "Local SQLite" : "Vaulta RAM"}
              </dd>
              <dt>Finality</dt>
              <dd>
                {config?.mode === "SIMULATED"
                  ? "Not applicable"
                  : "Check each receipt"}
              </dd>
            </dl>
            <button
              className="button full"
              onClick={deploy}
              disabled={!app || !!busy || app.deployed}
            >
              <Layers3 size={15} />
              {app?.deployed
                ? "Runtime ready"
                : config?.mode === "SIMULATED"
                  ? "Deploy locally"
                  : "Verify deployment"}
              {app?.deployed && <Check size={15} />}
            </button>
            {config?.mode === "SIMULATED" && (
              <button
                className="button full demo-button"
                disabled={!!busy}
                onClick={() => {
                  setOwner(config.demoOwner!);
                  setDemo(true);
                  log("Demo signer selected · simulation only.");
                }}
              >
                <Wallet size={14} />
                {demo ? "Demo signer connected" : "Use demo signer"}
                {demo && <Check size={14} />}
              </button>
            )}
            <div className="trust-note">
              <ShieldCheck size={17} />
              <p>
                Gateway verifies wallet signatures. The contract trusts its
                relayer. No bridge or origin-chain execution is claimed.
              </p>
            </div>
          </div>
          <div className="assistant-footer">
            <span className="dot" /> {busy || "Ready when you are"}
          </div>
        </aside>
      </div>
      <footer className="statusbar">
        <span>
          <span className="dot" />
          VaultRAM Studio · local
        </span>
        <span>
          {config?.mode === "SIMULATED"
            ? "SIMULATED — no chain transactions"
            : "JUNGLE4 — testnet assets only"}
        </span>
        <span>Public data only</span>
      </footer>
      {review && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
          >
            <button
              className="modal-close"
              aria-label="Close review"
              disabled={!!busy}
              onClick={() => setReview(undefined)}
            >
              <X size={18} />
            </button>
            <Fingerprint className="modal-icon" size={30} />
            <h2 id="review-title">Review your bounded action</h2>
            {error && (
              <div role="alert" className="alert error">
                {error}
              </div>
            )}
            <p>
              {demo
                ? "This uses a local demo key and writes only to the simulation database."
                : "Your wallet signs this intent. It grants one specific action to the gateway."}
            </p>
            <dl>
              <dt>Action</dt>
              <dd>{review.payload.action}</dd>
              <dt>Signer</dt>
              <dd style={{ overflowWrap: "anywhere" }}>{owner}</dd>
              {review.intent && (
                <>
                  <dt>Wallet network ID</dt>
                  <dd>{review.intent.sourceChainId} · identity only</dd>
                  <dt>Destination</dt>
                  <dd>Jungle4 · {review.intent.runtime}</dd>
                </>
              )}
              <dt>Estimated RAM range</dt>
              <dd>
                {estimate(review.payload).minBytes}–
                {estimate(review.payload).maxBytes} B
              </dd>
              <dt>Calibration</dt>
              <dd>Uncalibrated</dd>
            </dl>
            <p className="tiny amber-text">
              RAM estimate is an admission allowance, not an exact on-chain
              spending cap.
            </p>
            <pre>{JSON.stringify(review.payload, null, 2)}</pre>
            {review.intent && (
              <>
                <p className="tiny muted">
                  Nonce {review.intent.nonce} · expires{" "}
                  {new Date(review.intent.expires * 1000).toLocaleTimeString()}{" "}
                  · {review.intent.runtime}
                </p>
                <p
                  role="status"
                  className={reviewExpired ? "tiny amber-text" : "tiny muted"}
                >
                  {reviewExpired
                    ? "Expired. Refresh this request, review it, then sign again."
                    : `${Math.max(0, review.intent.expires - reviewNow)} seconds left to sign.`}
                </p>
                <details>
                  <summary>Full signed intent</summary>
                  <pre>{JSON.stringify(review.intent, null, 2)}</pre>
                </details>
              </>
            )}
            <button
              className="button primary full"
              disabled={!!busy}
              onClick={reviewExpired ? renewReview : submit}
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Fingerprint size={15} />
              )}{" "}
              {demo
                ? "Run simulation"
                : reviewExpired
                  ? "Refresh expired request"
                  : "Sign and submit"}
            </button>
          </section>
        </div>
      )}
      {selected && (
        <div className="modal-backdrop">
          <section
            className="modal receipt-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-title"
          >
            <button
              className="modal-close"
              aria-label="Close receipt"
              onClick={() => setSelected(undefined)}
            >
              <X size={18} />
            </button>
            <ShieldCheck size={30} className="modal-icon" />
            <h2 id="receipt-title">Execution receipt</h2>
            {error && (
              <div role="alert" className="alert error">
                {error}
              </div>
            )}
            {notice && (
              <div role="status" className="alert">
                {notice}
              </div>
            )}
            <span
              className={
                "badge " +
                (selected.status === "IRREVERSIBLE" ? "green" : "amber")
              }
            >
              {selected.status}
            </span>
            <p>
              {selected.receipt?.receipt.trust ??
                "Submission recorded. No execution receipt is available yet."}
            </p>
            {selected.receipt?.receipt.ram.executionTrace && (
              <p>
                Execution trace:{" "}
                {selected.receipt.receipt.ram.executionTrace.delta} RAM bytes.
                Reported by the submitting RPC; historical RAM attribution has
                not been independently verified.
              </p>
            )}
            <pre>
              {JSON.stringify(selected.receipt?.receipt ?? selected, null, 2)}
            </pre>
            <div className="receipt-buttons">
              <button
                className="button"
                onClick={() => verifyLocal(selected)}
                disabled={!!busy || !selected.receipt}
              >
                <ShieldCheck size={14} />
                Check signature
              </button>
              <button
                className="button"
                onClick={() => download(selected.hash)}
                disabled={!!busy}
              >
                <Download size={14} />
                Export evidence
              </button>
            </div>
            {config?.mode === "JUNGLE4" && (
              <button
                className="button full"
                disabled={!!busy}
                onClick={() =>
                  void task("Checking finality", async () => {
                    const updated = await api<Submission>("/reconcile", {
                      hash: selected.hash,
                    });
                    setSelected(updated);
                    await refresh(app?.appId);
                  })
                }
              >
                Check chain finality
              </button>
            )}
            <p className="tiny muted">
              Pin the receipt public key separately for independent
              verification.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Studio />
  </React.StrictMode>,
);
