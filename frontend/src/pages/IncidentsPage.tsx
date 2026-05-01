import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson, postJson } from "../api/http-client";
import { useAnalysis } from "../context/AnalysisContext";
import { useTenant } from "../context/TenantContext";

type Item = {
  id: number;
  title: string;
  created_at: string;
  preview?: string;
  snippet?: string;
};

export function IncidentsPage() {
  const { tenantId } = useTenant();
  const { lastK8sGPT } = useAnalysis();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [detailBody, setDetailBody] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    setError(null);
    try {
      const r = await getJson<{ items: Item[] }>("/incidents?limit=40");
      setItems(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent, tenantId]);

  const search = async () => {
    if (q.trim().length < 2) {
      setMsg("Search query must be at least 2 characters.");
      return;
    }
    setMsg(null);
    try {
      const r = await getJson<{ items: Item[] }>(
        `/incidents/search?q=${encodeURIComponent(q.trim())}`,
      );
      setItems(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const saveAnalysis = async () => {
    if (lastK8sGPT == null) {
      setMsg("Run K8sGPT analyze on Overview first, or paste JSON below.");
      return;
    }
    setMsg(null);
    try {
      await postJson("/incidents/from-analysis", {
        analysis: lastK8sGPT,
        note: note.trim() || null,
      });
      setMsg("Saved to incident memory.");
      await loadRecent();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const openDetail = async (id: number) => {
    setMsg(null);
    try {
      const r = await getJson<{ id: number; title: string; body: string }>(
        `/incidents/${id}`,
      );
      setSelected({ id: r.id, title: r.title, created_at: "" });
      setDetailBody(r.body);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="dashboard">
      <section className="panel panel--highlight">
        <h2 className="panel__title">Incident memory</h2>
        <p className="muted small-print">
          Store and retrieve K8sGPT analysis snapshots for your workspace. Search uses keyword matching for quick incident recall. Future versions will support vector embeddings for semantic search.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">Save analysis</h2>
        <label className="field">
          <span className="field__label">Note (Optional)</span>
          <input
            className="field__input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g., prod incident 2026-05-01 - CrashLoopBackOff in payments"
          />
        </label>
        <button type="button" className="btn" onClick={() => void saveAnalysis()}>
          {lastK8sGPT ? "Save analysis" : "No analysis in session"}
        </button>
        {lastK8sGPT == null && (
          <p className="muted small-print" style={{ marginTop: "0.75rem" }}>
            Run <strong>analysis</strong> on the Home page first.
          </p>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Search</h2>
        <div className="k8sgpt-controls">
          <input
            className="field__input"
            style={{ flex: 1, minWidth: 200 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g., CrashLoopBackOff, prometheus, OOMKilled"
          />
          <button type="button" className="btn" onClick={() => void search()}>
            Search
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void loadRecent()}
          >
            Recent
          </button>
        </div>
      </section>

      {msg && <p className="diagnostics-copy diagnostics-copy--accent">{msg}</p>}
      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2 className="panel__title">Results ({items.length})</h2>
        <ul className="conn-list">
          {items.length === 0 ? (
            <li style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
              No incidents found. Try another search or save an analysis first.
            </li>
          ) : (
            items.map((it) => (
              <li key={it.id} className="conn-list__item">
                <div>
                  <strong>{it.title}</strong>
                  <div className="muted small-print mono">
                    ID: {it.id} · {it.created_at}
                  </div>
                  <div className="muted small-print">
                    {it.preview ?? it.snippet}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--secondary"
                  onClick={() => void openDetail(it.id)}
                >
                  View
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      {detailBody && selected && (
        <section className="panel">
          <h2 className="panel__title">{selected.title}</h2>
          <pre className="k8sgpt-pre k8sgpt-pre--scroll">{detailBody}</pre>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setDetailBody(null);
              setSelected(null);
            }}
          >
            Close
          </button>
        </section>
      )}
    </div>
  );
}
