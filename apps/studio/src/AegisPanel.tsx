import React, { useState } from "react";
import type { AegisAccounting } from "../../../packages/aegis-bridge/bridge.mjs";
type Report = {
  aegis: AegisAccounting;
  observation: { contract: string; checkedAt: string; status: string };
};
export function AegisPanel({
  api,
  blocked,
}: {
  api: (path: string) => Promise<Report>;
  blocked: boolean;
}) {
  const [report, setReport] = useState<Report>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function check() {
    setReport(undefined);
    setError("");
    setLoading(true);
    try {
      setReport(await api("/aegis"));
    } catch {
      setError(
        "Audit unavailable or inconsistent. No successful result is retained; retry to check fresh state.",
      );
    } finally {
      setLoading(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "aegis-accounting-observation.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const a = report?.aegis;
  return (
    <section className="native-card" aria-label="Aegis accounting">
      <div className="native-heading">
        <h2>Aegis accounting</h2>
        <button
          className="button small"
          disabled={blocked || loading}
          onClick={() => void check()}
        >
          {loading ? "Checking chain…" : "Check with Aegis"}
        </button>
      </div>
      <p>
        Your Aegis reference kernel checks all grants in the pinned Jungle4
        deployment. Read-only; no wallet required.
      </p>
      {error && <p role="alert">{error}</p>}
      {a && report && (
        <>
          <p role="status">
            <strong>Accounting conserved:</strong> {a.result.accounted} /{" "}
            {a.result.root_authorized} test-write units.
          </p>
          <div className="native-grid">
            {(
              [
                ["Available", a.result.available],
                ["Reserved", a.result.reserved],
                ["Consumed", a.result.consumed],
                ["Quarantined", a.result.quarantined],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p>
            Available includes revoked or expired grants. It is not permission
            to execute.
          </p>
          <p>
            Contract <code>{report.observation.contract}</code> · Observed{" "}
            {report.observation.checkedAt}. Deployment-wide, not limited to the
            selected app.
          </p>
          <p>
            <a
              href={
                a.source.repository +
                "/blob/" +
                a.source.commit +
                "/" +
                a.source.module
              }
              target="_blank"
              rel="noreferrer"
            >
              Aegis {a.source.version} · conservationReport
            </a>{" "}
            · Pinned, unmodified source.
          </p>
          <p>
            Observation digest: <code>{a.observationDigest}</code>
          </p>
          <button className="button small" onClick={download}>
            Download observation
          </button>
        </>
      )}
      <p>
        Full authority verification: not evaluated. VaultRAM/V backing: not
        connected. Test-write units are not V or RAM bytes. RPC observations are
        not authenticated checkpoints.
      </p>
    </section>
  );
}
