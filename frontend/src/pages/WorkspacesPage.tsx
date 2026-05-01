import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, deleteJson, getJson, postJson } from "../api/http-client";
import { useTenant } from "../context/TenantContext";

type WorkspaceRow = { id: string };

export function WorkspacesPage() {
  const navigate = useNavigate();
  const { tenantId, setTenantId } = useTenant();
  const [items, setItems] = useState<WorkspaceRow[]>([]);
  const [newId, setNewId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await getJson<{ items: WorkspaceRow[] }>("/workspaces");
      setItems(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createWs = async () => {
    const id = newId.trim();
    if (!id) {
      setMsg("Enter a workspace id.");
      return;
    }
    setMsg(null);
    try {
      await postJson("/workspaces", { id });
      setNewId("");
      setMsg("Workspace registered.");
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  };

  const deleteWs = async (id: string) => {
    if (
      !window.confirm(
        `Delete workspace "${id}" and all its connections, kubeconfigs, and incident records? This cannot be undone.`,
      )
    ) {
      return;
    }
    setMsg(null);
    try {
      await deleteJson(`/workspaces/${encodeURIComponent(id)}`);
      if (tenantId === id) {
        setTenantId("default");
      }
      setMsg("Workspace removed.");
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  };

  const openWorkspace = (id: string) => {
    setTenantId(id);
    setMsg(null);
    navigate(`/w/${encodeURIComponent(id)}/cluster/compute`);
  };

  return (
    <div className="dashboard">
      <section className="panel panel--highlight">
        <p className="landing__eyebrow">Directory</p>
        <h2 className="landing__title">Workspaces</h2>
        <p className="muted landing__lead">
          Each workspace isolates cluster credentials. Open a workspace to connect a cluster and
          browse pods, nodes, and events.
        </p>
      </section>

      <section className="panel">
        <h3 className="panel__title">Create workspace</h3>
        <div className="wizard-grid">
          <label className="field">
            <span className="field__label">Workspace id</span>
            <input
              className="field__input"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="e.g. team-platform"
              autoComplete="off"
            />
          </label>
        </div>
        <button type="button" className="btn" onClick={() => void createWs()}>
          Register workspace
        </button>
        {msg && <p className="diagnostics-copy diagnostics-copy--accent">{msg}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel">
        <h3 className="panel__title">All workspaces ({items.length})</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id}>
                  <td className="mono">
                    <strong>{w.id}</strong>
                    {tenantId === w.id && (
                      <span className="badge badge--ok" style={{ marginLeft: "0.5rem" }}>
                        active
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="conn-list__actions" style={{ justifyContent: "flex-start" }}>
                      <button
                        type="button"
                        className="btn btn--small btn--secondary"
                        onClick={() => openWorkspace(w.id)}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => void deleteWs(w.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 && !error && (
          <p className="muted" style={{ textAlign: "center", padding: "1.5rem" }}>
            No workspaces yet. Register one above (or connect a cluster — a tenant id is created
            implicitly).
          </p>
        )}
      </section>
    </div>
  );
}
