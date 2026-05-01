import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson } from "../api/http-client";
import { useTenant } from "../context/TenantContext";

type NSItem = { name: string; phase: string | null };
type PodItem = {
  namespace: string;
  name: string;
  phase: string | null;
  reason: string | null;
};

export function ClusterExplorerPage() {
  const { tenantId } = useTenant();
  const [ns, setNs] = useState<string>("");
  const [namespaces, setNamespaces] = useState<NSItem[]>([]);
  const [pods, setPods] = useState<PodItem[]>([]);
  const [version, setVersion] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const v = await getJson<Record<string, string>>("/cluster/version");
      setVersion(v);
      const n = await getJson<{ items: NSItem[] }>("/cluster/namespaces");
      setNamespaces(n.items);
      const p = await getJson<{ items: PodItem[] }>(
        ns.trim()
          ? `/cluster/pods?namespace=${encodeURIComponent(ns.trim())}`
          : "/cluster/pods",
      );
      setPods(p.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setNamespaces([]);
      setPods([]);
      setVersion(null);
    }
  }, [ns]);

  useEffect(() => {
    void load();
  }, [load, tenantId]);

  return (
    <div className="dashboard">
      <section className="panel panel--highlight">
        <h2 className="panel__title">🗂️ Cluster Explorer</h2>
        <p className="muted small-print">
          Browse your Kubernetes cluster resources including namespaces, pods, and their current states. Use the filter below to explore specific namespaces.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">📦 Kubernetes Version</h2>
        {version && (
          <pre className="k8sgpt-pre">{JSON.stringify(version, null, 2)}</pre>
        )}
        {error && <p className="error">❌ {error}</p>}
      </section>

      <section className="panel">
        <h2 className="panel__title">📋 Namespaces</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {namespaces.map((n) => (
                <tr key={n.name}>
                  <td className="mono">
                    <strong>🏷️ {n.name}</strong>
                  </td>
                  <td>
                    <span className="badge badge--ok">
                      {n.phase === "Active" ? "🟢" : "🟡"} {n.phase || "Unknown"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">🐳 Pods</h2>
        <div className="k8sgpt-controls">
          <label className="field">
            <span className="field__label">Filter Namespace</span>
            <input
              className="field__input"
              value={ns}
              onChange={(e) => setNs(e.target.value)}
              placeholder="all namespaces"
            />
          </label>
          <button type="button" className="btn" onClick={() => void load()}>
            🔄 Refresh
          </button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Pod</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => (
                <tr key={`${p.namespace}/${p.name}`}>
                  <td className="mono">
                    <strong>🏷️ {p.namespace}</strong>
                  </td>
                  <td className="mono">{p.name}</td>
                  <td>
                    <span className="badge badge--ok">
                      {p.phase === "Running" ? "🟢" : p.phase === "Pending" ? "🟡" : "🔴"} {p.phase}
                    </span>
                  </td>
                  <td>{p.reason ? <code className="mono">{p.reason}</code> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
