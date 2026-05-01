import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson, postForm, postJson, postWithoutBody } from "../api/http-client";
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

type ConnectMode = "upload" | "token";

export function ConnectWizardPage() {
  const { tenantId } = useTenant();
  const [mode, setMode] = useState<ConnectMode>("upload");
  const [list, setList] = useState<ConnectionList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Primary cluster");
  const [contextName, setContextName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [tkDisplayName, setTkDisplayName] = useState("Primary cluster");
  const [server, setServer] = useState("");
  const [caData, setCaData] = useState("");
  const [token, setToken] = useState("");
  const [clusterName, setClusterName] = useState("cluster");
  const [ctxName, setCtxName] = useState("eks-context");
  const [userName, setUserName] = useState("sa-token-user");

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
      setMsg("Display name and kubeconfig file are required.");
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
      setMsg("Saved. Activate below, then Test.");
      setFile(null);
      await reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveToken = async () => {
    if (!tkDisplayName.trim() || !server.trim() || !caData.trim() || !token.trim()) {
      setMsg("Fill display name, server, CA data, and token.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await postJson("/connections/bootstrap-token", {
        display_name: tkDisplayName.trim(),
        server: server.trim(),
        certificate_authority_data: caData.trim(),
        token: token.trim(),
        cluster_name: clusterName.trim() || "cluster",
        context_name: ctxName.trim() || "context",
        user_name: userName.trim() || "token-user",
      });
      setMsg("Saved from token. Activate below, then Test.");
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
      setMsg(`Test OK — ${r.namespace_count} namespaces.`);
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
        <h2 className="panel__title">Connect</h2>
        <p className="muted small-print">
          Workspace: <code className="mono">{tenantId}</code>. Upload a kubeconfig or paste API URL,
          CA, and token (e.g. EKS / ServiceAccount).
        </p>
      </section>

      <section className="panel">
        <div className="connect-tabs" role="tablist">
          <button
            type="button"
            className={mode === "upload" ? "connect-tabs__btn--active" : ""}
            onClick={() => setMode("upload")}
          >
            Upload file
          </button>
          <button
            type="button"
            className={mode === "token" ? "connect-tabs__btn--active" : ""}
            onClick={() => setMode("token")}
          >
            API URL + token
          </button>
        </div>

        {mode === "upload" && (
          <>
            <h3 className="panel__title">Kubeconfig file</h3>
            <div className="wizard-grid">
              <label className="field">
                <span className="field__label">Display name</span>
                <input
                  className="field__input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Production"
                />
              </label>
              <label className="field">
                <span className="field__label">Context (optional)</span>
                <input
                  className="field__input"
                  value={contextName}
                  onChange={(e) => setContextName(e.target.value)}
                  placeholder="default context if empty"
                />
              </label>
              <label className="field">
                <span className="field__label">File</span>
                <input
                  className="field__input"
                  type="file"
                  accept=".yaml,.yml,.config,.kubeconfig,text/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <button type="button" className="btn" disabled={busy} onClick={() => void upload()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        )}

        {mode === "token" && (
          <>
            <h3 className="panel__title">Generated kubeconfig</h3>
            <div className="wizard-grid">
              <label className="field">
                <span className="field__label">Display name</span>
                <input
                  className="field__input"
                  value={tkDisplayName}
                  onChange={(e) => setTkDisplayName(e.target.value)}
                />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span className="field__label">API server URL</span>
                <input
                  className="field__input mono"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="https://xxxxx.gr7.region.eks.amazonaws.com"
                />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span className="field__label">Certificate authority (base64)</span>
                <textarea
                  className="field__input"
                  rows={3}
                  value={caData}
                  onChange={(e) => setCaData(e.target.value)}
                  placeholder="From aws eks describe-cluster … certificateAuthority.data"
                />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span className="field__label">Bearer token</span>
                <textarea
                  className="field__input mono"
                  rows={3}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="kubectl create token …"
                />
              </label>
              <label className="field">
                <span className="field__label">Cluster name (kubeconfig)</span>
                <input
                  className="field__input"
                  value={clusterName}
                  onChange={(e) => setClusterName(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Context name</span>
                <input
                  className="field__input"
                  value={ctxName}
                  onChange={(e) => setCtxName(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">User name</span>
                <input
                  className="field__input"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                />
              </label>
            </div>
            <button type="button" className="btn" disabled={busy} onClick={() => void saveToken()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        )}

        {msg && <p className="diagnostics-copy diagnostics-copy--ok" style={{ marginTop: "1rem" }}>{msg}</p>}
      </section>

      <section className="panel">
        <h3 className="panel__title">Connections</h3>
        {loadError && <p className="error">{loadError}</p>}
        {list && (
          <p className="muted small-print">
            Active:{" "}
            <code className="mono">{list.active_connection_id ?? "none"}</code>
          </p>
        )}
        <ul className="conn-list">
          {list?.connections.map((c) => (
            <li key={c.id} className="conn-list__item">
              <div>
                <strong>{c.display_name}</strong>
                <div className="muted small-print mono">{c.id}</div>
                <div className="muted small-print">
                  Context {c.context_name ?? "default"} · Test: {c.last_test_message ?? "—"}
                </div>
              </div>
              <div className="conn-list__actions">
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => void activate(c.id)}
                >
                  Activate
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  disabled={busy}
                  onClick={() => void test(c.id)}
                >
                  Test
                </button>
              </div>
            </li>
          ))}
        </ul>
        {list && list.connections.length === 0 && (
          <p className="muted" style={{ textAlign: "center", padding: "2rem" }}>
            No connections. Add one above.
          </p>
        )}
      </section>
    </div>
  );
}
