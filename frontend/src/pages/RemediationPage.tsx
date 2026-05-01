import { useState } from "react";
import { ApiError, postJson } from "../api/http-client";

type Suggestion = {
  id: string;
  risk: string;
  title: string;
  description?: string;
  command?: string;
  execute_kind?: string;
  note?: string;
};

export function RemediationPage() {
  const [namespace, setNamespace] = useState("default");
  const [podName, setPodName] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [pod, setPod] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [execMsg, setExecMsg] = useState<string | null>(null);
  const [deploymentName, setDeploymentName] = useState("");

  const loadSuggestions = async () => {
    setError(null);
    setExecMsg(null);
    try {
      const r = await postJson<{ suggestions: Suggestion[]; pod: Record<string, unknown> }>(
        "/remediation/suggestions",
        { namespace: namespace.trim(), pod_name: podName.trim() },
      );
      setSuggestions(r.suggestions);
      setPod(r.pod);
    } catch (e) {
      setSuggestions([]);
      setPod(null);
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const execute = async (action: "delete_pod" | "rollout_restart_deployment") => {
    setExecMsg(null);
    try {
      const body =
        action === "delete_pod"
          ? {
              action,
              namespace: namespace.trim(),
              pod_name: podName.trim(),
            }
          : {
              action,
              namespace: namespace.trim(),
              deployment_name: deploymentName.trim(),
            };
      const r = await postJson<{ ok: boolean; stdout?: string }>(
        "/remediation/execute",
        body,
      );
      setExecMsg(r.stdout ?? JSON.stringify(r));
    } catch (e) {
      setExecMsg(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="dashboard">
      <section className="panel panel--highlight">
        <h2 className="panel__title">🔧 Remediation</h2>
        <p className="muted small-print">
          AI-assisted remediation with rule-based suggestions based on pod state and health. Execution runs <strong>allow-listed kubectl commands only</strong> when <code className="mono">EKS_ASSISTANT_REMEDIATION_ENABLED=true</code> (disabled by default for safety).
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">🎯 Target Pod</h2>
        <div className="wizard-grid">
          <label className="field">
            <span className="field__label">Namespace</span>
            <input
              className="field__input"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="default"
            />
          </label>
          <label className="field">
            <span className="field__label">Pod Name</span>
            <input
              className="field__input"
              value={podName}
              onChange={(e) => setPodName(e.target.value)}
              placeholder="pod-name"
            />
          </label>
          <label className="field">
            <span className="field__label">Deployment (for rollout restart)</span>
            <input
              className="field__input"
              value={deploymentName}
              onChange={(e) => setDeploymentName(e.target.value)}
              placeholder="deployment-name"
            />
          </label>
        </div>
        <button type="button" className="btn" onClick={() => void loadSuggestions()}>
          🔍 Load Suggestions
        </button>
      </section>

      {error && <p className="error">❌ {error}</p>}
      {execMsg && (
        <section className="panel" style={{ background: "rgba(16, 185, 129, 0.08)", borderColor: "rgba(16, 185, 129, 0.3)" }}>
          <h2 className="panel__title">✓ Execution Result</h2>
          <pre className="k8sgpt-pre">{execMsg}</pre>
        </section>
      )}

      {pod && (
        <section className="panel">
          <h2 className="panel__title">🐳 Pod Snapshot</h2>
          <pre className="k8sgpt-pre k8sgpt-pre--scroll">
            {JSON.stringify(pod, null, 2)}
          </pre>
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">💡 Suggested Actions</h2>
        {suggestions.length === 0 ? (
          <p className="muted" style={{ textAlign: "center", padding: "2rem" }}>
            📭 No suggestions available. Load suggestions by filling in pod details above.
          </p>
        ) : (
          <ul className="conn-list">
            {suggestions.map((s) => (
              <li key={s.id} className="conn-list__item">
                <div style={{ flex: 1 }}>
                  <strong>💡 {s.title}</strong>
                  <span className={`risk-badge risk-badge--${s.risk}`}>
                    {s.risk === "read_only" && "📖"}
                    {s.risk === "destructive" && "⚠️"}
                    {s.risk === "moderate" && "⚡"}
                    {s.risk}
                  </span>
                  {s.description && (
                    <div className="muted small-print">{s.description}</div>
                  )}
                  {s.command && (
                    <>
                      <div style={{ marginTop: "0.5rem", marginBottom: "0.25rem" }} className="muted small-print">
                        <strong>Command:</strong>
                      </div>
                      <pre className="k8sgpt-pre">{s.command}</pre>
                    </>
                  )}
                  {s.note && <p className="muted small-print" style={{ marginTop: "0.5rem" }}>📌 {s.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel panel--muted">
        <h2 className="panel__title">⚙️ Execute Actions (Caution)</h2>
        <p className="muted small-print" style={{ marginBottom: "1rem" }}>
          ⚠️ These actions will directly modify your cluster. Ensure you have backups and proper authorization.
        </p>
        <div className="k8sgpt-controls">
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void execute("delete_pod")}
          >
            🗑️ Delete Pod
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void execute("rollout_restart_deployment")}
          >
            🔄 Restart Deployment
          </button>
        </div>
      </section>
    </div>
  );
}
