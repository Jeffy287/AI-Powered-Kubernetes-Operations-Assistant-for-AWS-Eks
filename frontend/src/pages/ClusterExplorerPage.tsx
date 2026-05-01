import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, getJson, postJson } from "../api/http-client";
import { DescribeSection, DlRow, KeyValueList } from "../components/DescribeBlocks";
import { useTenant } from "../context/TenantContext";

type NSItem = { name: string; phase: string | null };
type PodItem = {
  namespace: string;
  name: string;
  phase: string | null;
  reason: string | null;
  message?: string | null;
  node_name?: string | null;
};

type EventItem = {
  namespace: string;
  type: string | null;
  reason: string | null;
  message: string | null;
  involved_object: string | null;
};

type NodeItem = {
  name: string;
  ready: string | null;
  internal_ip: string | null;
  kubelet_version: string | null;
  os_image: string | null;
};

type ExplorerSection = "version" | "namespaces" | "pods" | "nodes" | "events";
type DetailTab = "pod" | "node" | "logs";

function PodDescribeView({ d }: { d: Record<string, unknown> }) {
  const labels = (d.labels as Record<string, string> | undefined) ?? {};
  const ann = (d.annotations as Record<string, string> | undefined) ?? {};
  const specs = (d.container_specs as { name: string; image?: string; resources?: unknown }[] | undefined) ?? [];
  const statuses = (d.container_statuses as { name: string; ready?: boolean; restart_count?: number; state?: string | null }[] | undefined) ?? [];

  return (
    <>
      <DescribeSection title="Overview">
        <dl className="describe-dl">
          <DlRow label="Name" value={`${String(d.namespace ?? "")}/${String(d.name ?? "")}`} />
          <DlRow label="Phase" value={String(d.phase ?? "—")} />
          <DlRow label="QoS" value={String(d.qos_class ?? "—")} />
          <DlRow label="Node" value={String(d.node_name ?? "—")} />
          <DlRow label="Service account" value={String(d.service_account ?? "—")} />
          <DlRow label="Started" value={String(d.created ?? "—")} />
        </dl>
      </DescribeSection>

      {Object.keys(labels).length > 0 && (
        <DescribeSection title="Labels">
          <KeyValueList data={labels as Record<string, string>} />
        </DescribeSection>
      )}

      {Object.keys(ann).length > 0 && (
        <DescribeSection title="Annotations">
          <KeyValueList data={ann as Record<string, string>} />
        </DescribeSection>
      )}

      {(specs.length > 0 || statuses.length > 0) && (
        <DescribeSection title="Containers">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Image</th>
                  <th>Ready</th>
                  <th>Restarts</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {specs.map((s) => {
                  const st = statuses.find((x) => x.name === s.name);
                  return (
                    <tr key={s.name}>
                      <td className="mono">{s.name}</td>
                      <td className="mono small-print">{s.image}</td>
                      <td>{st?.ready === true ? "true" : st?.ready === false ? "false" : "—"}</td>
                      <td>{st?.restart_count ?? "—"}</td>
                      <td className="small-print">{st?.state ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {specs.some((s) => s.resources) && (
            <pre className="k8sgpt-pre k8sgpt-pre--scroll" style={{ marginTop: "0.75rem" }}>
              {JSON.stringify(
                Object.fromEntries(specs.filter((s) => s.resources).map((s) => [s.name, s.resources])),
                null,
                2,
              )}
            </pre>
          )}
        </DescribeSection>
      )}

      {Array.isArray(d.conditions) && (d.conditions as unknown[]).length > 0 && (
        <DescribeSection title="Conditions">
          <pre className="k8sgpt-pre k8sgpt-pre--scroll">
            {JSON.stringify(d.conditions, null, 2)}
          </pre>
        </DescribeSection>
      )}
    </>
  );
}

function NodeDescribeView({ d }: { d: Record<string, unknown> }) {
  const labels = (d.labels as Record<string, string> | undefined) ?? {};
  const cap = (d.capacity as Record<string, string> | undefined) ?? {};
  const alloc = (d.allocatable as Record<string, string> | undefined) ?? {};
  const ni = (d.node_info as Record<string, string> | undefined) ?? {};
  const addr = (d.addresses as { type?: string; address?: string }[] | undefined) ?? [];

  return (
    <>
      <DescribeSection title="Overview">
        <dl className="describe-dl">
          <DlRow label="Name" value={String(d.name ?? "—")} />
        </dl>
      </DescribeSection>
      {Object.keys(ni).length > 0 && (
        <DescribeSection title="System">
          <KeyValueList data={ni as Record<string, string>} />
        </DescribeSection>
      )}
      {addr.length > 0 && (
        <DescribeSection title="Addresses">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {addr.map((a, i) => (
                  <tr key={i}>
                    <td>{a.type}</td>
                    <td className="mono">{a.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DescribeSection>
      )}
      {Object.keys(cap).length > 0 && (
        <DescribeSection title="Capacity">
          <KeyValueList data={cap} />
        </DescribeSection>
      )}
      {Object.keys(alloc).length > 0 && (
        <DescribeSection title="Allocatable">
          <KeyValueList data={alloc} />
        </DescribeSection>
      )}
      {Object.keys(labels).length > 0 && (
        <DescribeSection title="Labels">
          <KeyValueList data={labels} />
        </DescribeSection>
      )}
      {Array.isArray(d.conditions) && (d.conditions as unknown[]).length > 0 && (
        <DescribeSection title="Conditions">
          <pre className="k8sgpt-pre k8sgpt-pre--scroll">
            {JSON.stringify(d.conditions, null, 2)}
          </pre>
        </DescribeSection>
      )}
    </>
  );
}

/** Empty string = all namespaces (`kubectl get pods -A`). */
const ALL_NS = "";

export function ClusterExplorerPage() {
  const location = useLocation();
  const { tenantId } = useTenant();
  const [section, setSection] = useState<ExplorerSection>("pods");
  /** Namespace scope: "" = all namespaces; otherwise `kubectl get pods -n <name>`. */
  const [namespaceScope, setNamespaceScope] = useState(ALL_NS);
  const [namespaces, setNamespaces] = useState<NSItem[]>([]);
  const [pods, setPods] = useState<PodItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [version, setVersion] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<{ namespace: string; name: string } | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("pod");
  const [podDetail, setPodDetail] = useState<Record<string, unknown> | null>(null);
  const [nodeDetail, setNodeDetail] = useState<Record<string, unknown> | null>(null);
  const [nodeInspectDetail, setNodeInspectDetail] = useState<Record<string, unknown> | null>(null);
  const [logsText, setLogsText] = useState<string | null>(null);
  const [logContainer, setLogContainer] = useState<string>("");
  const [tailLines, setTailLines] = useState(500);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [eventsWarning, setEventsWarning] = useState<string | null>(null);

  const [bedrockEnabled, setBedrockEnabled] = useState(false);
  const [aiQuestion, setAiQuestion] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantOutput, setAssistantOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getJson<{ enabled: boolean }>("/assistant/bedrock/status");
        if (!cancelled) setBedrockEnabled(s.enabled);
      } catch {
        if (!cancelled) setBedrockEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadLists = useCallback(async () => {
    setError(null);
    setEventsWarning(null);
    try {
      const v = await getJson<Record<string, string>>("/cluster/version");
      setVersion(v);
      const n = await getJson<{ items: NSItem[] }>("/cluster/namespaces");
      setNamespaces(n.items);
      const ns = namespaceScope.trim();
      const p = await getJson<{ items: PodItem[] }>(
        ns.length > 0
          ? `/cluster/pods?namespace=${encodeURIComponent(ns)}`
          : "/cluster/pods",
      );
      setPods(p.items);
      try {
        const nr = await getJson<{ items: NodeItem[] }>("/cluster/nodes");
        setNodes(nr.items);
      } catch {
        setNodes([]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setNamespaces([]);
      setPods([]);
      setNodes([]);
      setEvents([]);
      setVersion(null);
      return;
    }

    try {
      const ns = namespaceScope.trim();
      const ev = await getJson<{ items: EventItem[] }>(
        ns.length > 0
          ? `/cluster/events?namespace=${encodeURIComponent(ns)}&limit=100`
          : "/cluster/events?limit=100",
      );
      setEvents(ev.items);
    } catch (e) {
      setEvents([]);
      setEventsWarning(
        e instanceof ApiError
          ? `${e.message} (HTTP ${e.status})`
          : String(e),
      );
    }
  }, [namespaceScope]);

  useEffect(() => {
    void loadLists();
  }, [loadLists, tenantId, location.key]);

  useEffect(() => {
    setSelected((prev) => {
      if (!prev) return null;
      const exists = pods.some(
        (p) => p.namespace === prev.namespace && p.name === prev.name,
      );
      return exists ? prev : null;
    });
  }, [pods]);

  const loadPodDetail = useCallback(async () => {
    if (!selected) {
      setPodDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await getJson<Record<string, unknown>>(
        `/cluster/pods/${encodeURIComponent(selected.namespace)}/${encodeURIComponent(selected.name)}`,
      );
      setPodDetail(d);
      const names = (d.containers as string[] | undefined) ?? [];
      setLogContainer((c) => (c && names.includes(c) ? c : names[0] ?? ""));
      setLogsText(null);
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : String(e));
      setPodDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    void loadPodDetail();
  }, [loadPodDetail, tenantId]);

  const loadNodeFromPod = useCallback(async () => {
    const nn = podDetail?.node_name;
    if (typeof nn !== "string" || !nn.length) {
      setNodeDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await getJson<Record<string, unknown>>(
        `/cluster/nodes/${encodeURIComponent(nn)}`,
      );
      setNodeDetail(d);
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : String(e));
      setNodeDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [podDetail?.node_name]);

  useEffect(() => {
    if (detailTab === "node" && selected && podDetail?.node_name) {
      void loadNodeFromPod();
    }
  }, [detailTab, selected, podDetail?.node_name, loadNodeFromPod]);

  const loadNodeInspect = useCallback(async () => {
    if (!selectedNode) {
      setNodeInspectDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await getJson<Record<string, unknown>>(
        `/cluster/nodes/${encodeURIComponent(selectedNode)}`,
      );
      setNodeInspectDetail(d);
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : String(e));
      setNodeInspectDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedNode]);

  useEffect(() => {
    if (section === "nodes" && selectedNode) {
      void loadNodeInspect();
    }
  }, [section, selectedNode, loadNodeInspect, tenantId]);

  const loadLogs = useCallback(async () => {
    if (!selected) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const q = new URLSearchParams({ tail_lines: String(tailLines) });
      if (logContainer.trim()) q.set("container", logContainer.trim());
      const out = await getJson<{ logs: string }>(
        `/cluster/pods/${encodeURIComponent(selected.namespace)}/${encodeURIComponent(selected.name)}/logs?${q}`,
      );
      setLogsText(out.logs);
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : String(e));
      setLogsText(null);
    } finally {
      setDetailLoading(false);
    }
  }, [selected, logContainer, tailLines]);

  useEffect(() => {
    if (detailTab === "logs" && selected && podDetail) {
      void loadLogs();
    }
  }, [detailTab, selected, podDetail, loadLogs]);

  const selectPod = (p: PodItem) => {
    setSelected({ namespace: p.namespace, name: p.name });
    setDetailTab("pod");
    setNodeDetail(null);
    setLogsText(null);
    setAssistantOutput(null);
    setAssistantError(null);
  };

  const selectSection = (key: ExplorerSection) => {
    setSection(key);
    setAssistantOutput(null);
    setAssistantError(null);
    if (key !== "pods") {
      setSelected(null);
      setPodDetail(null);
      setNodeDetail(null);
      setLogsText(null);
    }
    if (key !== "nodes") {
      setSelectedNode(null);
      setNodeInspectDetail(null);
    }
  };

  const containers = (podDetail?.containers as string[] | undefined) ?? [];

  const explainPodWithAssistant = async () => {
    if (!selected || !podDetail) return;
    setAssistantLoading(true);
    setAssistantError(null);
    try {
      let extra = "";
      if (logsText) {
        extra += `Pod logs (tail_lines=${tailLines}, container=${logContainer || "default"}):\n${logsText}\n`;
      }
      const out = await postJson<{ explanation: string }>("/assistant/explain", {
        question: aiQuestion.trim() || undefined,
        pod: { namespace: selected.namespace, name: selected.name },
        extra_context: extra.trim() || undefined,
      });
      setAssistantOutput(out.explanation);
    } catch (e) {
      setAssistantError(e instanceof ApiError ? e.message : String(e));
      setAssistantOutput(null);
    } finally {
      setAssistantLoading(false);
    }
  };

  const explainNodeWithAssistant = async () => {
    if (!selectedNode) return;
    setAssistantLoading(true);
    setAssistantError(null);
    try {
      const out = await postJson<{ explanation: string }>("/assistant/explain", {
        question: aiQuestion.trim() || undefined,
        node_name: selectedNode,
      });
      setAssistantOutput(out.explanation);
    } catch (e) {
      setAssistantError(e instanceof ApiError ? e.message : String(e));
      setAssistantOutput(null);
    } finally {
      setAssistantLoading(false);
    }
  };

  return (
    <div className="dashboard explorer-page">
      <section className="panel panel--highlight">
        <h2 className="panel__title">Cluster</h2>
        <p className="muted small-print">
          Resources for the active connection in this workspace.
        </p>
      </section>

      <div className="explorer-layout">
        <aside className="explorer-tabs" aria-label="Resources">
          {(
            [
              ["version", "Version"],
              ["namespaces", "Namespaces"],
              ["pods", "Pods"],
              ["nodes", "Nodes"],
              ["events", "Events"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={section === key ? "explorer-tabs__btn--active" : ""}
              onClick={() => selectSection(key)}
            >
              {label}
            </button>
          ))}
        </aside>

        <div className="explorer-main">
          {error && <p className="error">{error}</p>}
          {eventsWarning && !error && section === "events" && (
            <p className="muted small-print" role="status">
              {eventsWarning}
            </p>
          )}

          {section === "version" && (
            <section className="panel">
              <h3 className="panel__title">Version</h3>
              {version && <KeyValueList data={version} />}
            </section>
          )}

          {section === "namespaces" && (
            <section className="panel">
              <h3 className="panel__title">Namespaces</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Phase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {namespaces.map((n) => (
                      <tr key={n.name}>
                        <td className="mono">
                          <strong>{n.name}</strong>
                        </td>
                        <td>
                          <span className="badge badge--ok">{n.phase || "—"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {section === "events" && (
            <section className="panel">
              <h3 className="panel__title">Events</h3>
              {eventsWarning && (
                <p className="error small-print">{eventsWarning}</p>
              )}
              <div className="k8sgpt-controls">
                <label className="field">
                  <span className="field__label">Namespace</span>
                  <select
                    className="field__input"
                    value={namespaceScope}
                    onChange={(e) => setNamespaceScope(e.target.value)}
                  >
                    <option value={ALL_NS}>All namespaces</option>
                    {namespaces.map((n) => (
                      <option key={n.name} value={n.name}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn" onClick={() => void loadLists()}>
                  Refresh
                </button>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Namespace</th>
                      <th>Type</th>
                      <th>Reason</th>
                      <th>Object</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev, i) => (
                      <tr key={`${ev.namespace}-${i}-${ev.reason}`}>
                        <td className="mono">{ev.namespace}</td>
                        <td>{ev.type}</td>
                        <td>{ev.reason}</td>
                        <td className="mono small-print">{ev.involved_object}</td>
                        <td className="small-print">{ev.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {section === "nodes" && (
            <div className="explorer-split">
              <div className="explorer-list-panel">
                <button type="button" className="btn" onClick={() => void loadLists()}>
                  Refresh
                </button>
                <div className="explorer-pod-scroll">
                  {nodes.map((n) => {
                    const active = selectedNode === n.name;
                    return (
                      <button
                        key={n.name}
                        type="button"
                        className={`explorer-pod-row${active ? " explorer-pod-row--selected" : ""}`}
                        onClick={() => {
                          setSelectedNode(n.name);
                          setAssistantOutput(null);
                          setAssistantError(null);
                        }}
                      >
                        <div className="explorer-pod-row__name">{n.name}</div>
                        <div className="explorer-pod-row__meta">
                          Ready {n.ready ?? "—"} · {n.internal_ip ?? "—"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="explorer-detail-panel">
                {!selectedNode && (
                  <p className="muted">Select a node.</p>
                )}
                {selectedNode && (
                  <>
                    <p className="small-print mono" style={{ marginTop: 0 }}>
                      {selectedNode}
                    </p>
                    {nodeInspectDetail && (
                      <div className="ai-assistant-bar">
                        <div className="ai-assistant-bar__row">
                          <button
                            type="button"
                            className="btn btn--small"
                            disabled={!bedrockEnabled || assistantLoading}
                            title={
                              bedrockEnabled
                                ? "Explain this node using the assistant configured on the API"
                                : "Configure the AI assistant on the API server to enable Explain"
                            }
                            onClick={() => void explainNodeWithAssistant()}
                          >
                            {assistantLoading ? "Explaining…" : "Explain"}
                          </button>
                        </div>
                        <label className="field ai-assistant-bar__question">
                          <span className="field__label">Optional question</span>
                          <input
                            className="field__input"
                            value={aiQuestion}
                            onChange={(e) => setAiQuestion(e.target.value)}
                            placeholder="e.g. What do these conditions imply?"
                          />
                        </label>
                        {assistantError && (
                          <p className="error small-print">{assistantError}</p>
                        )}
                        {assistantOutput && (
                          <pre className="ai-assistant-bar__output">{assistantOutput}</pre>
                        )}
                      </div>
                    )}
                    {detailLoading && <p className="muted">Loading…</p>}
                    {detailError && <p className="error">{detailError}</p>}
                    {nodeInspectDetail && <NodeDescribeView d={nodeInspectDetail} />}
                  </>
                )}
              </div>
            </div>
          )}

          {section === "pods" && (
            <div className="explorer-split">
              <div className="explorer-list-panel">
                <label className="field">
                  <span className="field__label">Namespace</span>
                  <select
                    className="field__input"
                    value={namespaceScope}
                    onChange={(e) => setNamespaceScope(e.target.value)}
                  >
                    <option value={ALL_NS}>All namespaces</option>
                    {namespaces.map((n) => (
                      <option key={n.name} value={n.name}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted small-print explorer-kubectl-hint">
                  {namespaceScope === ALL_NS
                    ? "Like: kubectl get pods -A"
                    : `Like: kubectl get pods -n ${namespaceScope}`}
                </p>
                <button type="button" className="btn" onClick={() => void loadLists()}>
                  Refresh
                </button>
                <div className="field" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
                  <span className="field__label">Pods</span>
                </div>
                <div className="explorer-pod-scroll">
                  {pods.map((p) => {
                    const active =
                      selected?.namespace === p.namespace && selected?.name === p.name;
                    return (
                      <button
                        key={`${p.namespace}/${p.name}`}
                        type="button"
                        className={`explorer-pod-row${active ? " explorer-pod-row--selected" : ""}`}
                        onClick={() => selectPod(p)}
                      >
                        <div className="explorer-pod-row__ns">{p.namespace}</div>
                        <div className="explorer-pod-row__name">{p.name}</div>
                        <div className="explorer-pod-row__meta">
                          {p.phase}
                          {p.node_name ? ` · ${p.node_name}` : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {pods.length === 0 && (
                  <p className="muted small-print" style={{ marginTop: "0.5rem" }}>
                    No pods in this scope.
                  </p>
                )}
              </div>

              <div className="explorer-detail-panel">
                {!selected && (
                  <p className="muted">Select a pod.</p>
                )}
                {selected && (
                  <>
                    <p className="small-print mono" style={{ marginTop: 0 }}>
                      {selected.namespace}/{selected.name}
                    </p>
                    <div className="explorer-detail-tabs" role="tablist">
                      {(
                        [
                          ["pod", "Describe"],
                          ["node", "Node"],
                          ["logs", "Logs"],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          role="tab"
                          aria-selected={detailTab === key}
                          className={
                            detailTab === key ? "explorer-detail-tabs__btn--active" : ""
                          }
                          onClick={() => setDetailTab(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {podDetail && (
                      <div className="ai-assistant-bar">
                        <div className="ai-assistant-bar__row">
                          <button
                            type="button"
                            className="btn btn--small"
                            disabled={!bedrockEnabled || assistantLoading}
                            title={
                              bedrockEnabled
                                ? "Explain this workload using the assistant configured on the API"
                                : "Configure the AI assistant on the API server to enable Explain"
                            }
                            onClick={() => void explainPodWithAssistant()}
                          >
                            {assistantLoading ? "Explaining…" : "Explain"}
                          </button>
                        </div>
                        <label className="field ai-assistant-bar__question">
                          <span className="field__label">Optional question</span>
                          <input
                            className="field__input"
                            value={aiQuestion}
                            onChange={(e) => setAiQuestion(e.target.value)}
                            placeholder="e.g. Why might this pod be unhealthy?"
                          />
                        </label>
                        {assistantError && (
                          <p className="error small-print">{assistantError}</p>
                        )}
                        {assistantOutput && (
                          <pre className="ai-assistant-bar__output">{assistantOutput}</pre>
                        )}
                      </div>
                    )}

                    {detailLoading && <p className="muted">Loading…</p>}
                    {detailError && <p className="error">{detailError}</p>}

                    {detailTab === "pod" && podDetail && <PodDescribeView d={podDetail} />}

                    {detailTab === "node" && (
                      <>
                        {!podDetail?.node_name && (
                          <p className="muted">Not scheduled.</p>
                        )}
                        {podDetail?.node_name && nodeDetail && <NodeDescribeView d={nodeDetail} />}
                      </>
                    )}

                    {detailTab === "logs" && (
                      <>
                        <div className="log-controls">
                          <label className="field">
                            <span className="field__label">Container</span>
                            {containers.length > 0 ? (
                              <select
                                className="field__input"
                                value={logContainer}
                                onChange={(e) => setLogContainer(e.target.value)}
                              >
                                {containers.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                className="field__input mono"
                                value={logContainer}
                                onChange={(e) => setLogContainer(e.target.value)}
                                placeholder="container"
                              />
                            )}
                          </label>
                          <label className="field">
                            <span className="field__label">Tail</span>
                            <input
                              className="field__input"
                              type="number"
                              min={50}
                              max={10000}
                              step={50}
                              value={tailLines}
                              onChange={(e) => setTailLines(Number(e.target.value) || 500)}
                            />
                          </label>
                          <button type="button" className="btn" onClick={() => void loadLogs()}>
                            Refresh
                          </button>
                        </div>
                        {logsText !== null && (
                          <pre className="k8sgpt-pre k8sgpt-pre--scroll">{logsText}</pre>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
