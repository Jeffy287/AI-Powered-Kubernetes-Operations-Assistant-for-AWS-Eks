import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError, getJson, postWithoutBody } from "../api/http-client";
import { useTenant } from "../context/TenantContext";
import { WorkspaceAssistantPanel } from "./WorkspaceAssistantPanel";

type ConnectionRow = {
  id: string;
  display_name: string;
  context_name: string | null;
};

type ConnectionList = {
  active_connection_id: string | null;
  connections: ConnectionRow[];
};

const CLUSTER_SUB = [
  { path: "compute", label: "Compute" },
  { path: "networking", label: "Networking" },
  { path: "observability", label: "Observability" },
  { path: "addons", label: "Add-ons" },
  { path: "kubernetes", label: "Kubernetes resources" },
] as const;

/** Sidebar for a single workspace: kube API calls use URL workspace id as tenant. */
export function WorkspaceLayout() {
  const { workspaceId = "" } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { setTenantId } = useTenant();

  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [connLoading, setConnLoading] = useState(true);
  const [clusterSwitching, setClusterSwitching] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId) {
      setTenantId(workspaceId);
    }
  }, [workspaceId, setTenantId]);

  const loadConnections = useCallback(async () => {
    if (!workspaceId) {
      setConnections([]);
      setActiveConnectionId(null);
      setConnLoading(false);
      return;
    }
    setConnError(null);
    setConnLoading(true);
    try {
      const data = await getJson<ConnectionList>("/connections", {
        tenantId: workspaceId,
      });
      setConnections(data.connections);
      setActiveConnectionId(data.active_connection_id);
    } catch (e) {
      setConnError(e instanceof ApiError ? e.message : String(e));
      setConnections([]);
      setActiveConnectionId(null);
    } finally {
      setConnLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections, location.pathname]);

  const base = `/w/${encodeURIComponent(workspaceId)}`;

  const onClusterChange = async (connectionId: string) => {
    if (!workspaceId || !connectionId) return;
    if (connectionId === activeConnectionId) {
      navigate(`${base}/cluster/compute`);
      return;
    }
    setClusterSwitching(true);
    setConnError(null);
    try {
      await postWithoutBody(`/connections/${encodeURIComponent(connectionId)}/activate`, {
        tenantId: workspaceId,
      });
      setActiveConnectionId(connectionId);
      navigate(`${base}/cluster/compute`);
    } catch (e) {
      setConnError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setClusterSwitching(false);
    }
  };

  const emptyClusters = !connLoading && connections.length === 0;

  const clusterPathPrefix = `${base}/cluster/`;
  const isClusterSection = location.pathname.startsWith(clusterPathPrefix);

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Workspace navigation">
        <div className="app-sidebar__brand">
          <span className="app-sidebar__logo" aria-hidden>
            EO
          </span>
          <div>
            <h1 className="app-sidebar__title">EKS Operations Assistant</h1>
            <p className="app-sidebar__subtitle">Kubernetes diagnostics</p>
          </div>
        </div>

        <NavLink to="/" className="app-sidebar__back app-sidebar__back--top">
          ← All workspaces
        </NavLink>

        <div className="app-sidebar__section">
          <label className="app-sidebar__label">Workspace</label>
          <p className="app-sidebar__workspace-readonly mono">{workspaceId || "—"}</p>
          <p className="app-sidebar__hint">
            Tenant header <code className="mono">X-Tenant-ID</code> follows this workspace.
          </p>
        </div>

        <div className="app-sidebar__section">
          <div className="app-sidebar__row-label">
            <label className="app-sidebar__label" htmlFor="sidebar-cluster-select">
              Active cluster
            </label>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              disabled={connLoading || clusterSwitching || !workspaceId}
              aria-label="Reload saved connections from server"
              onClick={() => void loadConnections()}
            >
              Refresh
            </button>
          </div>
          <select
            id="sidebar-cluster-select"
            className="app-sidebar__workspace-input"
            aria-label="Choose saved cluster connection"
            disabled={
              connLoading ||
              clusterSwitching ||
              emptyClusters ||
              !workspaceId
            }
            value={activeConnectionId ?? ""}
            onChange={(e) => void onClusterChange(e.target.value)}
          >
            <option value="">
              {connLoading
                ? "Loading clusters…"
                : emptyClusters
                  ? "No clusters — open Connect"
                  : "Select a cluster…"}
            </option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
                {c.context_name ? ` · ${c.context_name}` : ""}
              </option>
            ))}
          </select>
          <p className="app-sidebar__hint">
            Saved kubeconfigs for this workspace. Choosing one activates it and opens Cluster.
          </p>
          {connError && (
            <p className="app-sidebar__hint app-sidebar__hint--error" role="alert">
              {connError}
            </p>
          )}
          {clusterSwitching && (
            <p className="app-sidebar__hint muted">Activating cluster…</p>
          )}
        </div>

        <nav className="app-sidebar__nav" aria-label="Primary">
          <NavLink
            to={`${base}/connect`}
            className={({ isActive }) =>
              `app-sidebar__link${isActive ? " app-sidebar__link--active" : ""}`
            }
          >
            Connect
          </NavLink>

          <details className="app-sidebar__cluster-menu" open={isClusterSection}>
            <summary className="app-sidebar__cluster-menu-summary">Cluster</summary>
            <div className="app-sidebar__cluster-menu-list">
              {CLUSTER_SUB.map(({ path, label }) => (
                <NavLink
                  key={path}
                  to={`${base}/cluster/${path}`}
                  className={({ isActive }) =>
                    `app-sidebar__link app-sidebar__link--nested${
                      isActive ? " app-sidebar__link--active" : ""
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          </details>
        </nav>
      </aside>

      <div className="app-shell__content">
        <WorkspaceAssistantPanel />
        <Outlet />
      </div>
    </div>
  );
}
