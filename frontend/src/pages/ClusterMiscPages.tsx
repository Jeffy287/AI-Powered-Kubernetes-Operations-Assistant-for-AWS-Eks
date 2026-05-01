import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation, useParams } from "react-router-dom";
import { ApiError, getJson } from "../api/http-client";

function useWorkspaceBase() {
  const { workspaceId = "" } = useParams<{ workspaceId: string }>();
  return `/w/${encodeURIComponent(workspaceId)}/cluster`;
}

export function ClusterNetworkingPage() {
  const location = useLocation();
  const [items, setItems] = useState<
    {
      namespace: string;
      name: string;
      type: string | null;
      cluster_ip: string | null;
      external_ip: string | null;
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getJson<{ items: typeof items }>("/cluster/services");
      setItems(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, location.key]);

  return (
    <div className="dashboard explorer-page">
      <section className="panel panel--highlight">
        <h2 className="panel__title">Networking</h2>
        <p className="muted small-print">Services across all namespaces (Kubernetes API).</p>
      </section>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <section className="panel">
          <h3 className="panel__title">Services ({items.length})</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Namespace</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Cluster IP</th>
                  <th>External</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={`${s.namespace}/${s.name}`}>
                    <td className="mono">{s.namespace}</td>
                    <td className="mono">{s.name}</td>
                    <td>{s.type}</td>
                    <td className="mono">{s.cluster_ip}</td>
                    <td className="mono small-print">{s.external_ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export function ClusterAddonsPage() {
  const location = useLocation();
  const [items, setItems] = useState<
    { namespace: string; name: string; desired: number | null; ready: number | null }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getJson<{ items: typeof items }>("/cluster/addons/daemonsets");
      setItems(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, location.key]);

  return (
    <div className="dashboard explorer-page">
      <section className="panel panel--highlight">
        <h2 className="panel__title">Add-ons</h2>
        <p className="muted small-print">
          DaemonSets in <code className="mono">kube-system</code> (common cluster agents).
        </p>
      </section>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <section className="panel">
          <h3 className="panel__title">DaemonSets in kube-system ({items.length})</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Desired</th>
                  <th>Ready</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.name}>
                    <td className="mono">{d.name}</td>
                    <td>{d.desired ?? "—"}</td>
                    <td>{d.ready ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export function ClusterObservabilityPage() {
  const base = useWorkspaceBase();
  return (
    <div className="dashboard explorer-page">
      <section className="panel panel--highlight">
        <h2 className="panel__title">Observability</h2>
        <p className="muted small-print">
          Browse workloads, logs, and events via the in-app explorer. For CloudWatch, open the AWS
          console for this cluster.
        </p>
      </section>
      <section className="panel">
        <NavLink className="btn" to={`${base}/kubernetes`}>
          Kubernetes resources & events
        </NavLink>
      </section>
    </div>
  );
}
