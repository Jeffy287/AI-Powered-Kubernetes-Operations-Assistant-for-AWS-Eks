import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { ApiError, getJson, postJson } from "../api/http-client";
import { useAnalysis } from "../context/AnalysisContext";
import { useTenant } from "../context/TenantContext";

type HealthResponse = { status: string };
type DiagnosticsSummary = Record<string, unknown>;
type K8sGPTVersionResponse = {
  installed: boolean;
  binary: string;
  exit_code: number;
  stdout: string;
  stderr: string | null;
  kubeconfig_bound?: boolean;
};
type K8sGPTAnalyzeResponse = {
  exit_code: number;
  stderr: string | null;
  result: unknown;
};

export function OverviewPage() {
  const { tenantId } = useTenant();
  const { setLastK8sGPT } = useAnalysis();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [k8sgptVersion, setK8sgptVersion] = useState<K8sGPTVersionResponse | null>(
    null,
  );
  const [k8sgptVersionError, setK8sgptVersionError] = useState<string | null>(null);

  const [namespace, setNamespace] = useState("");
  const [explain, setExplain] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<K8sGPTAnalyzeResponse | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, d] = await Promise.all([
        getJson<HealthResponse>("/health"),
        getJson<DiagnosticsSummary>("/diagnostics/summary"),
      ]);
      setHealth(h);
      setDiagnostics(d);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `API error (${e.status}): ${e.message}`
          : "Could not reach the API.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, tenantId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setK8sgptVersionError(null);
      try {
        const v = await getJson<K8sGPTVersionResponse>(
          "/diagnostics/k8sgpt/version",
        );
        if (!cancelled) setK8sgptVersion(v);
      } catch (e) {
        if (!cancelled) {
          setK8sgptVersionError(
            e instanceof ApiError ? e.message : "Could not check K8sGPT.",
          );
          setK8sgptVersion(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const runK8sGPTAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeResult(null);
    try {
      const ns = namespace.trim();
      const out = await postJson<K8sGPTAnalyzeResponse>(
        "/diagnostics/k8sgpt/analyze",
        {
          namespace: ns.length > 0 ? ns : null,
          explain,
          filters: null,
        },
      );
      setAnalyzeResult(out);
      setLastK8sGPT(out.result);
      void refresh();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.message} (${e.status})`
          : String(e);
      setAnalyzeError(msg);
    } finally {
      setAnalyzing(false);
    }
  }, [explain, namespace, refresh, setLastK8sGPT]);

  return (
    <div className="dashboard">
      <section className="panel panel--highlight">
        <h2 className="panel__title">🚀 Getting Started</h2>
        <p className="muted small-print" style={{ marginBottom: "0.75rem" }}>
          Welcome! Start by connecting your Kubernetes cluster. Visit <NavLink to="/connect" className="link">🔗 Connect</NavLink> to upload your kubeconfig file. Each workspace (tenant) operates independently with isolated diagnostics, K8sGPT analysis, and incident memory.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">📊 API Status</h2>
        {loading && <p className="muted">🔄 Loading…</p>}
        {error && <p className="error">❌ {error}</p>}
        {!loading && !error && health && (
          <p>
            Backend health: 
            <code className="badge badge--ok">✓ {health.status}</code>
          </p>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">🔍 Cluster Diagnostics</h2>
        {!loading && diagnostics && (
          <pre className="k8sgpt-pre k8sgpt-pre--scroll">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">🤖 K8sGPT Analysis</h2>
        <p className="muted small-print">
          Uses your active kubeconfig for intelligent cluster analysis. Enable <strong>Explain</strong> to get AI-powered insights (requires AI backend configured in K8sGPT).
        </p>
        {k8sgptVersionError && (
          <p className="error">❌ {k8sgptVersionError}</p>
        )}
        {k8sgptVersion && (
          <div className="k8sgpt-meta">
            <p>
              <strong>CLI:</strong> <code className="mono">{k8sgptVersion.binary}</code>
              {k8sgptVersion.kubeconfig_bound !== undefined && (
                <span className="muted">
                  {" "} · Kubeconfig: {k8sgptVersion.kubeconfig_bound ? "✓ Bound" : "📦 Default env"}
                </span>
              )}
            </p>
            <pre className="k8sgpt-pre">{k8sgptVersion.stdout}</pre>
          </div>
        )}
        <div className="k8sgpt-controls">
          <label className="field">
            <span className="field__label">Namespace (optional)</span>
            <input
              className="field__input"
              type="text"
              placeholder="e.g. kube-system"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field field--inline">
            <input
              type="checkbox"
              checked={explain}
              onChange={(e) => setExplain(e.target.checked)}
            />
            <span>🧠 Explain with AI</span>
          </label>
          <button
            type="button"
            className="btn"
            disabled={analyzing || Boolean(k8sgptVersionError)}
            onClick={() => void runK8sGPTAnalyze()}
          >
            {analyzing ? "⏳ Running…" : "▶️ Analyze"}
          </button>
          <NavLink to="/incidents" className="btn btn--ghost">
            💾 Save to Memory →
          </NavLink>
        </div>
        {analyzeError && <p className="error">❌ {analyzeError}</p>}
        {analyzeResult && (
          <div className="k8sgpt-output">
            {analyzeResult.stderr && (
              <p className="muted small-print">📋 stderr: {analyzeResult.stderr}</p>
            )}
            <pre className="k8sgpt-pre k8sgpt-pre--scroll">
              {JSON.stringify(analyzeResult.result, null, 2)}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
