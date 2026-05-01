import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { ApiError, getJson, postJson } from "../api/http-client";
import { useAnalysis } from "../context/AnalysisContext";
import { useTenant } from "../context/TenantContext";

type HealthResponse = { status: string };
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

type Diagnostics = {
  connected?: boolean;
  message?: string;
  error?: string;
  kubernetes?: Record<string, string>;
  namespaces?: number;
  pods_total?: number;
  pods_not_healthy?: number;
};

export function OverviewPage() {
  const { tenantId, setTenantId } = useTenant();
  const { setLastK8sGPT } = useAnalysis();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsCount, setWsCount] = useState<number | null>(null);

  const [k8sgptVersion, setK8sgptVersion] = useState<K8sGPTVersionResponse | null>(null);
  const [k8sgptVersionError, setK8sgptVersionError] = useState<string | null>(null);

  const [namespace, setNamespace] = useState("");
  const [namespaceOptions, setNamespaceOptions] = useState<string[]>([]);
  const [explain, setExplain] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<K8sGPTAnalyzeResponse | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, d] = await Promise.all([
        getJson<HealthResponse>("/health"),
        getJson<Diagnostics>("/diagnostics/summary"),
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
    let c = false;
    (async () => {
      try {
        const w = await getJson<{ items: { id: string }[] }>("/workspaces");
        if (!c) setWsCount(w.items.length);
      } catch {
        if (!c) setWsCount(null);
      }
    })();
    return () => {
      c = true;
    };
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setK8sgptVersionError(null);
      try {
        const v = await getJson<K8sGPTVersionResponse>("/diagnostics/k8sgpt/version");
        if (!cancelled) setK8sgptVersion(v);
      } catch (e) {
        if (!cancelled) {
          setK8sgptVersionError(e instanceof ApiError ? e.message : "K8sGPT check failed.");
          setK8sgptVersion(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!diagnostics?.connected) {
      setNamespaceOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await getJson<{ items: { name: string }[] }>("/cluster/namespaces");
        if (!cancelled) {
          setNamespaceOptions(r.items.map((x) => x.name).sort());
        }
      } catch {
        if (!cancelled) setNamespaceOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [diagnostics?.connected, tenantId]);

  const runK8sGPTAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeResult(null);
    try {
      const ns = namespace.trim();
      const out = await postJson<K8sGPTAnalyzeResponse>("/diagnostics/k8sgpt/analyze", {
        namespace: ns.length > 0 ? ns : null,
        explain,
        filters: null,
      });
      setAnalyzeResult(out);
      setLastK8sGPT(out.result);
      void refresh();
    } catch (e) {
      const msg =
        e instanceof ApiError ? `${e.message} (${e.status})` : String(e);
      setAnalyzeError(msg);
    } finally {
      setAnalyzing(false);
    }
  }, [explain, namespace, refresh, setLastK8sGPT]);

  const connected = diagnostics?.connected === true;

  return (
    <div className="dashboard landing">
      <section className="panel panel--highlight">
        <p className="landing__eyebrow">Home</p>
        <h2 className="landing__title">Dashboard</h2>
        <p className="muted landing__lead">
          Manage <NavLink to="/workspaces">workspaces</NavLink>, connect a cluster, then open{" "}
          <NavLink to="/cluster">Cluster</NavLink> for workloads and nodes.
        </p>
      </section>

      <section className="panel">
        <h3 className="panel__title">Workspace</h3>
        <p className="muted small-print">
          Active workspace ID (isolates connections and saved incidents).{" "}
          {wsCount !== null && (
            <span>
              {wsCount} workspace{wsCount === 1 ? "" : "s"} registered.
            </span>
          )}
        </p>
        <label className="field landing__workspace-field">
          <span className="field__label">Workspace ID</span>
          <input
            className="field__input field__input--lg"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="e.g. team-alpha"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <NavLink to="/workspaces" className="btn btn--secondary">
          Open workspace directory
        </NavLink>
      </section>

      <section className="panel">
        <h3 className="panel__title">Service status</h3>
        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && health && (
          <p className="landing__inline-status">
            API <span className="badge badge--ok">{health.status}</span>
          </p>
        )}
      </section>

      <section className="panel">
        <h3 className="panel__title">Cluster snapshot</h3>
        {!loading && diagnostics && (
          <div className="stat-grid">
            {!connected && (
              <p className="muted">
                {diagnostics.message ?? "No connection for this workspace."}
              </p>
            )}
            {connected && diagnostics.error && <p className="error">{diagnostics.error}</p>}
            {connected && !diagnostics.error && (
              <>
                <div className="stat-card">
                  <span className="stat-card__label">Kubernetes</span>
                  <span className="stat-card__value mono">
                    {diagnostics.kubernetes?.git_version ?? "—"}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-card__label">Namespaces</span>
                  <span className="stat-card__value">{diagnostics.namespaces ?? "—"}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-card__label">Pods</span>
                  <span className="stat-card__value">{diagnostics.pods_total ?? "—"}</span>
                </div>
                <div className="stat-card stat-card--accent">
                  <span className="stat-card__label">Attention</span>
                  <span className="stat-card__value">{diagnostics.pods_not_healthy ?? "—"}</span>
                  <span className="stat-card__hint muted small-print">{diagnostics.message}</span>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <h3 className="panel__title">K8sGPT</h3>
        <p className="muted small-print">
          Uses active kubeconfig. Explain requires AI backend in the API container.
        </p>
        {k8sgptVersionError && <p className="error">{k8sgptVersionError}</p>}
        {k8sgptVersion && (
          <pre className="k8sgpt-pre k8sgpt-pre--compact">{k8sgptVersion.stdout}</pre>
        )}
        <div className="k8sgpt-controls k8sgpt-controls--wrap">
          <label className="field">
            <span className="field__label">Namespace</span>
            <select
              className="field__input"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              disabled={!connected || namespaceOptions.length === 0}
            >
              <option value="">All</option>
              {namespaceOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <input
              type="checkbox"
              checked={explain}
              onChange={(e) => setExplain(e.target.checked)}
            />
            <span>Explain</span>
          </label>
          <button
            type="button"
            className="btn"
            disabled={analyzing || Boolean(k8sgptVersionError) || !connected}
            onClick={() => void runK8sGPTAnalyze()}
          >
            {analyzing ? "Running…" : "Run"}
          </button>
          <NavLink to="/incidents" className="btn btn--ghost">
            Incidents
          </NavLink>
        </div>
        {analyzeError && <p className="error">{analyzeError}</p>}
        {analyzeResult && (
          <pre className="k8sgpt-pre k8sgpt-pre--scroll">
            {JSON.stringify(analyzeResult.result, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
