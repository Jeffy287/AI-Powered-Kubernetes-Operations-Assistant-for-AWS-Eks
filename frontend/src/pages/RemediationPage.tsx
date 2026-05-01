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

const riskLabel: Record<string, string> = {
  read_only: "Read-only",
  destructive: "Destructive",
  moderate: "Moderate",
};

export function RemediationPage() {
  const [namespace, setNamespace] = useState("default");
  const [podName, setPodName] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [pod, setPod] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSuggestions = async () => {
    setError(null);
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

  return (
    <div className="dashboard">
      <section className="panel panel--highlight">
        <h2 className="panel__title">Remediation</h2>
        <p className="muted small-print">
          Rule-based suggestions from pod state. Review suggested commands in your own terminal when
          appropriate; this UI does not execute changes on the cluster.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">Target workload</h2>
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
            <span className="field__label">Pod name</span>
            <input
              className="field__input"
              value={podName}
              onChange={(e) => setPodName(e.target.value)}
              placeholder="pod-name"
            />
          </label>
        </div>
        <button type="button" className="btn" onClick={() => void loadSuggestions()}>
          Load suggestions
        </button>
      </section>

      {error && <p className="error">{error}</p>}

      {pod && (
        <section className="panel">
          <h2 className="panel__title">Pod snapshot</h2>
          <pre className="k8sgpt-pre k8sgpt-pre--scroll">
            {JSON.stringify(pod, null, 2)}
          </pre>
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">Suggestions</h2>
        {suggestions.length === 0 ? (
          <p className="muted" style={{ textAlign: "center", padding: "2rem" }}>
            No suggestions yet. Enter namespace and pod name above, then load suggestions.
          </p>
        ) : (
          <ul className="conn-list">
            {suggestions.map((s) => (
              <li key={s.id} className="conn-list__item">
                <div style={{ flex: 1 }}>
                  <strong>{s.title}</strong>
                  <span className={`risk-badge risk-badge--${s.risk}`}>
                    {riskLabel[s.risk] ?? s.risk}
                  </span>
                  {s.description && (
                    <div className="muted small-print">{s.description}</div>
                  )}
                  {s.command && (
                    <>
                      <div style={{ marginTop: "0.5rem", marginBottom: "0.25rem" }} className="muted small-print">
                        Command
                      </div>
                      <pre className="k8sgpt-pre">{s.command}</pre>
                    </>
                  )}
                  {s.note && <p className="muted small-print" style={{ marginTop: "0.5rem" }}>{s.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
