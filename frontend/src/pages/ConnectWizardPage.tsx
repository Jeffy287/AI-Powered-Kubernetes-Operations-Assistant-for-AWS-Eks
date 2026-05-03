import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  deleteJson,
  getJson,
  postForm,
  postJson,
  postWithoutBody,
} from "../api/http-client";
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

type ConnectBanner = { text: string; kind: "ok" | "err" };

function CopyCmdButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      /* ignore */
    }
  };
  return (
    <button type="button" className="btn btn--secondary btn--small" onClick={() => void onCopy()}>
      {done ? "Copied" : label}
    </button>
  );
}

/** One wizard step: optional shell command to copy, then paste area directly underneath. */
function ConnectStep({
  stepLabel,
  title,
  hint,
  commandBlock,
  pasteTitle,
  children,
}: {
  stepLabel: string;
  title: string;
  hint?: ReactNode;
  commandBlock?: ReactNode;
  pasteTitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="connect-step">
      <div className="connect-step__head">
        <span className="connect-step__badge">{stepLabel}</span>
        <div className="connect-step__head-text">
          <h4 className="connect-step__title">{title}</h4>
          {hint ? <p className="connect-step__hint muted small-print">{hint}</p> : null}
        </div>
      </div>
      {commandBlock ? <div className="connect-step__command">{commandBlock}</div> : null}
      {children ? (
        <div className="connect-step__paste">
          {pasteTitle ? (
            <label className="connect-step__paste-label">
              <span>{pasteTitle}</span>
            </label>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

function CommandRow({ cmd, copyLabel = "Copy command" }: { cmd: string; copyLabel?: string }) {
  return (
    <div className="connect-step__cmd-stack">
      <pre className="connect-cmd__pre mono connect-step__pre">{cmd}</pre>
      <div className="connect-step__cmd-actions">
        <CopyCmdButton text={cmd} label={copyLabel} />
      </div>
    </div>
  );
}

/** Safe single-quoted literal for bash `export VAR='…'`. */
function bashSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/** Human-readable day approximation for token lifetime (24 h = 1 day). */
function approxDaysFromHours(hours: number): string {
  const h = Math.min(8760, Math.max(1, Math.floor(hours) || 1));
  const days = h / 24;
  if (days < 1) return `less than 1 day (${h} h)`;
  const rounded = Math.round(days * 10) / 10;
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${s} days`;
}

export function ConnectWizardPage() {
  const { tenantId } = useTenant();
  const [mode, setMode] = useState<ConnectMode>("token");
  const [list, setList] = useState<ConnectionList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Primary cluster");
  const [contextName, setContextName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<ConnectBanner | null>(null);

  const [tkDisplayName, setTkDisplayName] = useState("Primary cluster");
  const [server, setServer] = useState("");
  const [caData, setCaData] = useState("");
  const [token, setToken] = useState("");
  const [clusterName, setClusterName] = useState("");
  const [ctxName, setCtxName] = useState("eks-context");
  const [userName, setUserName] = useState("sa-token-user");

  /** Values used only to generate shell commands (fill these first → commands update for copy). */
  const [cmdRegion, setCmdRegion] = useState("us-east-1");
  const [cmdClusterName, setCmdClusterName] = useState("");
  const [cmdNamespace, setCmdNamespace] = useState("default");
  const [cmdSaName, setCmdSaName] = useState("app-sa");
  /** Raw digits for step 6 token lifetime (hours); normalized on blur. */
  const [tokenHoursStr, setTokenHoursStr] = useState("720");

  const parsedTokenHours = useMemo(() => {
    const t = tokenHoursStr.trim();
    if (t === "") return null;
    const n = parseInt(t, 10);
    if (!Number.isFinite(n)) return null;
    return Math.min(8760, Math.max(1, n));
  }, [tokenHoursStr]);

  const cmdParts = useMemo(() => {
    const CLUSTER = cmdClusterName.trim() || "YOUR_CLUSTER_NAME";
    const REGION = cmdRegion.trim() || "YOUR_REGION";
    const SA_NAMESPACE = cmdNamespace.trim() || "YOUR_NAMESPACE";
    const SA_NAME = cmdSaName.trim() || "YOUR_SERVICE_ACCOUNT";
    const durationH = parsedTokenHours ?? 720;

    const qCluster = bashSingleQuoted(CLUSTER);
    const qRegion = bashSingleQuoted(REGION);
    const qSa = bashSingleQuoted(SA_NAME);
    const qNs = bashSingleQuoted(SA_NAMESPACE);

    const exportBlock = `# Optional: same values as shell variables (commands below already embed them)
export CLUSTER_NAME=${qCluster}
export AWS_REGION=${qRegion}
export SA_NAME=${qSa}
export SA_NAMESPACE=${qNs}
# Token duration (hours) for step 6: ${durationH}`;

    const apiUrlCmd = `aws eks describe-cluster --name ${qCluster} --region ${qRegion} --query 'cluster.endpoint' --output text`;

    const caCmd = `aws eks describe-cluster --name ${qCluster} --region ${qRegion} --query 'cluster.certificateAuthority.data' --output text`;

    const updateKubeconfigCmd = `aws eks update-kubeconfig --region ${qRegion} --name ${qCluster}`;

    const createSaCmd = `kubectl create serviceaccount ${qSa} -n ${qNs} --dry-run=client -o yaml | kubectl apply -f -`;

    /* Matches kubernetes/rbac-eks-operations-assistant.yaml; subjects come from step 0. */
    const rbacApplyCmd = `kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: eks-operations-assistant-extended
  labels:
    app.kubernetes.io/name: eks-operations-assistant
rules:
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods", "pods/status"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["daemonsets"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: eks-operations-assistant-extended
  labels:
    app.kubernetes.io/name: eks-operations-assistant
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: eks-operations-assistant-extended
subjects:
  - kind: ServiceAccount
    name: ${SA_NAME}
    namespace: ${SA_NAMESPACE}
EOF`;

    const tokenCmd = `kubectl create token ${qSa} -n ${qNs} --duration=${durationH}h`;

    return {
      exportBlock,
      apiUrlCmd,
      caCmd,
      updateKubeconfigCmd,
      createSaCmd,
      rbacApplyCmd,
      tokenCmd,
      tokenDurationHours: durationH,
    };
  }, [cmdClusterName, cmdRegion, cmdNamespace, cmdSaName, parsedTokenHours]);

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
      setBanner({ text: "Display name and kubeconfig file are required.", kind: "err" });
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append("display_name", displayName.trim());
      if (contextName.trim()) fd.append("context_name", contextName.trim());
      fd.append("kubeconfig", file);
      await postForm<{ id: string }>("/connections", fd);
      setBanner({ text: "Saved. Activate below, then Test.", kind: "ok" });
      setFile(null);
      await reload();
    } catch (e) {
      setBanner({ text: e instanceof ApiError ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const saveToken = async () => {
    if (!tkDisplayName.trim() || !server.trim() || !caData.trim() || !token.trim()) {
      setBanner({ text: "Fill display name, server, CA data, and token.", kind: "err" });
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      await postJson("/connections/bootstrap-token", {
        display_name: tkDisplayName.trim(),
        server: server.trim(),
        certificate_authority_data: caData.trim(),
        token: token.trim(),
        cluster_name:
          clusterName.trim() || cmdClusterName.trim() || "cluster",
        context_name: ctxName.trim() || "context",
        user_name: userName.trim() || "token-user",
      });
      setBanner({ text: "Saved from token. Activate below, then Test.", kind: "ok" });
      await reload();
    } catch (e) {
      setBanner({ text: e instanceof ApiError ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string) => {
    setBusy(true);
    setBanner(null);
    try {
      await postWithoutBody(`/connections/${id}/activate`);
      setBanner({ text: `Active connection: ${id}`, kind: "ok" });
      await reload();
    } catch (e) {
      setBanner({ text: e instanceof ApiError ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: string) => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await postWithoutBody<{ ok: boolean; namespace_count: number }>(
        `/connections/${id}/test`,
      );
      setBanner({ text: `Test OK — ${r.namespace_count} namespaces.`, kind: "ok" });
      await reload();
    } catch (e) {
      setBanner({ text: e instanceof ApiError ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const removeConnection = async (id: string, label: string) => {
    if (
      !window.confirm(
        `Remove connection "${label}"?\n\nThis deletes saved kubeconfig data for this workspace. Active selection is cleared if it was this connection.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      await deleteJson(`/connections/${encodeURIComponent(id)}`);
      setBanner({ text: "Connection removed.", kind: "ok" });
      await reload();
    } catch (e) {
      setBanner({ text: e instanceof ApiError ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dashboard">
      <section className="panel panel--highlight">
        <h2 className="panel__title">Connect</h2>
        <p className="muted small-print">
          Workspace: <code className="mono">{tenantId}</code>. Fill step 0, copy exports, then follow
          1→6: AWS values paste into this form; kubectl steps run against a kubeconfig from step 3.
          Upload file is still available as an alternative.
        </p>
      </section>

      <section className="panel">
        <div className="connect-tabs" role="tablist">
          <button
            type="button"
            className={mode === "token" ? "connect-tabs__btn--active" : ""}
            onClick={() => setMode("token")}
          >
            API URL + token
          </button>
          <button
            type="button"
            className={mode === "upload" ? "connect-tabs__btn--active" : ""}
            onClick={() => setMode("upload")}
          >
            Upload file
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
            <div className="connect-flow">
              <div className="connect-step">
                <div className="connect-step__head">
                  <span className="connect-step__badge">0</span>
                  <div className="connect-step__head-text">
                    <h4 className="connect-step__title">Cluster, ServiceAccount &amp; connection label</h4>
                    <p className="connect-step__hint muted small-print">
                      Used for shell exports, RBAC subjects, and token commands. RBAC step installs{" "}
                      <code className="mono">eks-operations-assistant-extended</code> (same as{" "}
                      <code className="mono">kubernetes/rbac-eks-operations-assistant.yaml</code>
                      ).
                    </p>
                  </div>
                </div>
                <div className="connect-step__fields-block">
                  <label className="field">
                    <span className="field__label">Connection display name</span>
                    <input
                      className="field__input"
                      value={tkDisplayName}
                      onChange={(e) => setTkDisplayName(e.target.value)}
                      placeholder="Production"
                      aria-label="Connection display name"
                    />
                  </label>
                  <div className="wizard-grid wizard-grid--connect-params">
                    <label className="field">
                      <span className="field__label">
                        AWS region <span className="mono">($AWS_REGION)</span>
                      </span>
                      <input
                        className="field__input mono"
                        value={cmdRegion}
                        onChange={(e) => setCmdRegion(e.target.value)}
                        placeholder="us-east-1"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">
                        EKS cluster name <span className="mono">($CLUSTER_NAME)</span>
                      </span>
                      <input
                        className="field__input mono"
                        value={cmdClusterName}
                        onChange={(e) => setCmdClusterName(e.target.value)}
                        placeholder="Type cluster name — placeholder alone does not apply"
                        autoComplete="off"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">
                        SA namespace <span className="mono">($SA_NAMESPACE)</span>
                      </span>
                      <input
                        className="field__input mono"
                        value={cmdNamespace}
                        onChange={(e) => setCmdNamespace(e.target.value)}
                        placeholder="default"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">
                        SA name <span className="mono">($SA_NAME)</span>
                      </span>
                      <input
                        className="field__input mono"
                        value={cmdSaName}
                        onChange={(e) => setCmdSaName(e.target.value)}
                        placeholder="app-sa"
                      />
                    </label>
                  </div>
                  <label className="field field--token-duration">
                    <span className="field__label">Step 6 · token lifetime</span>
                    <p className="muted small-print" style={{ margin: "0 0 0.4rem" }}>
                      Type hours directly. The token command uses this value as{" "}
                      <code className="mono">--duration=…h</code>.
                    </p>
                    <div className="duration-plain-row">
                      <input
                        className="field__input mono duration-plain-row__input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={tokenHoursStr}
                        onChange={(e) =>
                          setTokenHoursStr(e.target.value.replace(/\D/g, "").slice(0, 4))
                        }
                        onBlur={() =>
                          setTokenHoursStr(String(parsedTokenHours ?? 720))
                        }
                        aria-label="Token lifetime in hours"
                      />
                      <span className="duration-plain-row__unit">hours</span>
                      <span className="duration-plain-row__approx" aria-live="polite">
                        {parsedTokenHours === null ? (
                          <span className="muted">Enter hours to see days</span>
                        ) : (
                          <>≈ {approxDaysFromHours(parsedTokenHours)}</>
                        )}
                      </span>
                    </div>
                    <p className="muted small-print connect-step__duration-help">
                      <code className="mono">kubectl create token … --duration={cmdParts.tokenDurationHours}h</code>
                    </p>
                  </label>
                </div>
                <p className="muted small-print connect-step__between" style={{ marginBottom: "0.35rem" }}>
                  Optional exports — steps 1–6 embed your values directly; use this only if you prefer env vars.
                </p>
                <CommandRow cmd={cmdParts.exportBlock} copyLabel="Copy exports" />
              </div>

              <ConnectStep
                stepLabel="1"
                title="API URL"
                hint="Command updates when you change region/cluster in step 0 (quoted literals). Paste the output below."
                commandBlock={<CommandRow cmd={cmdParts.apiUrlCmd} />}
                pasteTitle="Paste API server URL"
              >
                <input
                  className="field__input mono"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="https://….eks.amazonaws.com"
                  aria-label="API server URL"
                />
              </ConnectStep>

              <ConnectStep
                stepLabel="2"
                title="certificate-authority-data (base64)"
                hint="Same AWS credentials as step 1. Paste the single-line base64 output."
                commandBlock={<CommandRow cmd={cmdParts.caCmd} />}
                pasteTitle="Paste certificate authority data"
              >
                <textarea
                  className="field__input mono"
                  rows={3}
                  value={caData}
                  onChange={(e) => setCaData(e.target.value)}
                  placeholder="LS0tLS1CRUdJTi..."
                  aria-label="Certificate authority base64"
                />
              </ConnectStep>

              <ConnectStep
                stepLabel="3"
                title="Kubeconfig for admin (before kubectl)"
                hint="Merges cluster auth into ~/.kube/config so kubectl works for steps 4–6."
                commandBlock={
                  <>
                    <CommandRow cmd={cmdParts.updateKubeconfigCmd} />
                    <p className="muted small-print connect-step__after-cmd">
                      Nothing to paste here. Run locally with an IAM principal that can update kubeconfig
                      for this cluster.
                    </p>
                  </>
                }
              />

              <ConnectStep
                stepLabel="4"
                title="ServiceAccount"
                hint="Creates the SA if it does not exist (requires kubectl context from step 3)."
                commandBlock={
                  <>
                    <CommandRow cmd={cmdParts.createSaCmd} />
                    <p className="muted small-print connect-step__after-cmd">
                      Nothing to paste here.
                    </p>
                  </>
                }
              />

              <ConnectStep
                stepLabel="5"
                title="RBAC — app permissions"
                hint={
                  <>
                    Installs ClusterRole / Binding{" "}
                    <code className="mono">eks-operations-assistant-extended</code> with subject{" "}
                    <code className="mono">{cmdSaName.trim() || "YOUR_SERVICE_ACCOUNT"}</code> in{" "}
                    <code className="mono">{cmdNamespace.trim() || "YOUR_NAMESPACE"}</code>. Matches the
                    repo manifest; nodes, services, pods, logs, namespaces, events, daemonsets.
                  </>
                }
                commandBlock={
                  <>
                    <CommandRow cmd={cmdParts.rbacApplyCmd} copyLabel="Copy kubectl apply" />
                    <p className="muted small-print connect-step__after-cmd">
                      Paste into your terminal as one block. Re-copy after changing SA / namespace in step
                      0. For metrics-based CPU/memory on Compute, add{" "}
                      <code className="mono">metrics.k8s.io</code> rules separately.
                    </p>
                  </>
                }
              />

              <ConnectStep
                stepLabel="6"
                title="Token"
                hint={
                  <>
                    Duration matches step 0 ({cmdParts.tokenDurationHours} hours). Paste the token below.
                  </>
                }
                commandBlock={<CommandRow cmd={cmdParts.tokenCmd} />}
                pasteTitle="Paste bearer token"
              >
                <textarea
                  className="field__input mono"
                  rows={3}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  aria-label="Bearer token"
                />
              </ConnectStep>

              <ConnectStep
                stepLabel="7"
                title="Kubeconfig entry labels (optional)"
                hint="Stored inside the saved connection; leave cluster blank to use your EKS cluster name."
                pasteTitle="Cluster / context / user"
              >
                <div className="wizard-grid wizard-grid--kube-labels">
                  <label className="field">
                    <span className="field__label">Cluster name</span>
                    <input
                      className="field__input mono"
                      value={clusterName}
                      onChange={(e) => setClusterName(e.target.value)}
                      placeholder="Empty = name from step 0"
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
              </ConnectStep>
            </div>

            <button
              type="button"
              className="btn"
              style={{ marginTop: "1rem" }}
              disabled={busy}
              onClick={() => void saveToken()}
            >
              {busy ? "Saving…" : "Save connection"}
            </button>
          </>
        )}

        {banner ? (
          <p
            className={
              banner.kind === "err"
                ? "error connect-banner"
                : "diagnostics-copy diagnostics-copy--ok connect-banner"
            }
          >
            {banner.text}
          </p>
        ) : null}
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
                <button
                  type="button"
                  className="btn btn--danger btn--small"
                  disabled={busy}
                  onClick={() => void removeConnection(c.id, c.display_name)}
                >
                  Remove
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
