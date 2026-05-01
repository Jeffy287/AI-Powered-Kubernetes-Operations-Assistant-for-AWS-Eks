import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, getJson } from "../api/http-client";

type ComputeNode = {
  name: string;
  ready: string | null;
  internal_ip: string | null;
  created: string | null;
  instance_type: string | null;
  eks_nodegroup: string | null;
  capacity_type: string | null;
  zone: string | null;
  kubelet_version: string | null;
  cpu_usage_percent?: number;
  memory_usage_percent?: number;
};

type NodeGroupRow = {
  group_name: string;
  node_count: number;
  nodes: string[];
};

type FargateProfile = {
  profile_name: string;
  namespaces: string[];
  namespace_count: number;
};

type ComputeSummary = {
  nodes: ComputeNode[];
  node_groups: NodeGroupRow[];
  fargate_profiles: FargateProfile[];
  metrics_available: boolean;
};

export function ClusterComputePage() {
  const location = useLocation();
  const [data, setData] = useState<ComputeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getJson<ComputeSummary>("/cluster/compute-summary");
      setData(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setData(null);
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
        <h2 className="panel__title">Compute</h2>
        <p className="muted small-print">
          Nodes and scaling hints from the Kubernetes API and labels (e.g. EKS node groups when
          labels exist). CPU/memory % requires metrics-server. AWS-only fields (launch template,
          AMI version) need the AWS console or APIs.
        </p>
      </section>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <section className="panel">
            <h3 className="panel__title">
              Nodes ({data.nodes.length}){" "}
              {!data.metrics_available && (
                <span className="muted small-print">— metrics-server not detected (no CPU/mem %)</span>
              )}
            </h3>
            <div className="table-wrap">
              <table className="data-table cluster-table">
                <thead>
                  <tr>
                    <th>Node name</th>
                    <th>Instance type</th>
                    <th>Compute</th>
                    <th>Managed by</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th>CPU %</th>
                    <th>Memory %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.nodes.map((n) => (
                    <tr key={n.name}>
                      <td className="mono">{n.name}</td>
                      <td>{n.instance_type ?? "—"}</td>
                      <td>{n.capacity_type ?? "—"}</td>
                      <td className="mono small-print">{n.eks_nodegroup ?? "—"}</td>
                      <td className="small-print">{n.created ? formatShort(n.created) : "—"}</td>
                      <td>{n.ready === "True" ? "Ready" : n.ready ?? "—"}</td>
                      <td>{pct(n.cpu_usage_percent)}</td>
                      <td>{pct(n.memory_usage_percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h3 className="panel__title">Node groups ({data.node_groups.length})</h3>
            <p className="muted small-print">
              Derived from <code className="mono">eks.amazonaws.com/nodegroup</code> on nodes — not
              the full AWS console node group object.
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Group name</th>
                    <th>Nodes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.node_groups.map((g) => (
                    <tr key={g.group_name}>
                      <td className="mono">{g.group_name}</td>
                      <td>{g.node_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h3 className="panel__title">Fargate profiles ({data.fargate_profiles.length})</h3>
            <p className="muted small-print">
              Inferred from pods with label{" "}
              <code className="mono">eks.amazonaws.com/fargate-profile</code>. Empty if no Fargate
              workloads or label missing.
            </p>
            {data.fargate_profiles.length === 0 ? (
              <p className="muted">No Fargate profiles detected from workloads.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Profile name</th>
                      <th>Namespaces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fargate_profiles.map((f) => (
                      <tr key={f.profile_name}>
                        <td className="mono">{f.profile_name}</td>
                        <td className="small-print">{f.namespaces.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function pct(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "—";
  return `${n}%`;
}

function formatShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}
