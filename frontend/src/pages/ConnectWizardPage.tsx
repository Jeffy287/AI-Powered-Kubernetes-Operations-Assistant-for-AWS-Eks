import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson, postForm, postWithoutBody } from "../api/http-client";
import { useTenant } from "../context/TenantContext";

type ConnectionRow = {
  id: string;
  display_name: string;
  context_name: string | null;
  created_at: string;
  last_test_ok_at: string | null;
  last_test_message: string | null;
};

type ConnectionList = {
  tenant_id: string;
  active_connection_id: string | null;
  connections: ConnectionRow[];
};

export function ConnectWizardPage() {
  const { tenantId } = useTenant();
  const [list, setList] = useState<ConnectionList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Primary EKS");
  const [contextName, setContextName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await getJson<ConnectionList>("/connections");
      setList(data);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, tenantId]);

  const upload = async () => {
    if (!file || !displayName.trim()) {
      setMsg("Choose a display name and kubeconfig file.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("display_name", displayName.trim());
      if (contextName.trim()) fd.append("context_name", contextName.trim());
      fd.append("kubeconfig", file);
      await postForm<{ id: string }>("/connections", fd);
      setMsg("Saved. Activate it below, then Test.");
      setFile(null);
      await reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await postWithoutBody(`/connections/${id}/activate`);
      setMsg(`Active connection: ${id}`);
      await reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postWithoutBody<{ ok: boolean; namespace_count: number }>(
        `/connections/${id}/test`,
      );
      setMsg(`Test OK — ${r.namespace_count} namespaces visible.`);
      await reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dashboard">
      <section className="panel panel--highlight">
        <h2 className="panel__title">🔗 Connect Cluster Wizard</h2>
        <ol className="steps ordered">
          <li>Generate kubeconfig: <code className="mono">aws eks update-kubeconfig --region REGION --name CLUSTER-NAME</code></li>
          <li>Export or copy your kubeconfig file locally</li>
          <li>Upload the file below for your current workspace</li>
          <li>Activate the connection and test connectivity</li>
        </ol>
      </section>

      <section className="panel">
        <h2 className="panel__title">📁 Upload Kubeconfig</h2>
        <div className="wizard-grid">
          <label className="field">
            <span className="field__label">Display Name</span>
            <input
              className="field__input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Production EKS"
            />
          </label>
          <label className="field">
            <span className="field__label">Context Name (Optional)</span>
            <input
              className="field__input"
              value={contextName}
              onChange={(e) => setContextName(e.target.value)}
              placeholder="leave empty for default"
            />
          </label>
          <label className="field">
            <span className="field__label">Kubeconfig File</span>
            <input
              className="field__input"
              type="file"
              accept=".yaml,.yml,.config,text/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void upload()}
        >
          {busy ? "⏳ Saving…" : "💾 Save Connection"}
        </button>
      </section>

      <section className="panel">
        <h2 className="panel__title">✨ Saved Connections</h2>
        {loadError && <p className="error">❌ {loadError}</p>}
        {msg && <p className="diagnostics-copy" style={{ color: "var(--success)", fontWeight: 600 }}>✓ {msg}</p>}
        {list && (
          <p className="muted small-print">
            Workspace: <code className="mono">{list.tenant_id}</code>
            {list.active_connection_id && (
              <>
                {" "} · 🟢 Active: <code className="mono">{list.active_connection_id}</code>
              </>
            )}
          </p>
        )}
        <ul className="conn-list">
          {list?.connections.map((c) => (
            <li key={c.id} className="conn-list__item">
              <div>
                <strong>📍 {c.display_name}</strong>
                <div className="muted small-print mono">{c.id}</div>
                <div className="muted small-print">
                  Context: <strong>{c.context_name ?? "(default)"}</strong> · Last test: <strong>{c.last_test_message ?? "—"}</strong>
                </div>
              </div>
              <div className="conn-list__actions">
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => void activate(c.id)}
                >
                  🔌 Activate
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  disabled={busy}
                  onClick={() => void test(c.id)}
                >
                  ✓ Test
                </button>
              </div>
            </li>
          ))}
        </ul>
        {list && list.connections.length === 0 && (
          <p className="muted" style={{ textAlign: "center", padding: "2rem" }}>📭 No connections yet. Upload one above!</p>
        )}
      </section>
    </div>
  );
}
