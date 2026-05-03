import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson, postJson } from "../api/http-client";

/** Workspace-wide Bedrock Q&A (no pod/node context). Shown above page content. */
export function WorkspaceAssistantPanel() {
  const [bedrockEnabled, setBedrockEnabled] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
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

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q) {
      setError("Enter a question.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const out = await postJson<{ explanation: string }>("/assistant/explain", {
        question: q,
      });
      setOutput(out.explanation);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setOutput(null);
    } finally {
      setLoading(false);
    }
  }, [question]);

  return (
    <section className="panel workspace-assistant-panel" aria-label="AI assistant">
      <h3 className="panel__title workspace-assistant-panel__title">Ask the assistant</h3>
      <p className="muted small-print workspace-assistant-panel__hint">
        Ask anything about Kubernetes or EKS. For answers grounded in a specific pod or node, use{" "}
        <strong>Explain</strong> inside <strong>Kubernetes resources</strong>.
      </p>
      <div className="ai-assistant-bar workspace-assistant-panel__bar">
        <div className="ai-assistant-bar__row">
          <button
            type="button"
            className="btn btn--small"
            disabled={!bedrockEnabled || loading}
            title={
              bedrockEnabled
                ? "Send question to the assistant configured on the API"
                : "Configure Bedrock on the API (EKS_ASSISTANT_BEDROCK_MODEL_ID)"
            }
            onClick={() => void ask()}
          >
            {loading ? "Thinking…" : "Ask"}
          </button>
          {!bedrockEnabled && (
            <span className="muted small-print">Assistant unavailable — Bedrock not configured.</span>
          )}
        </div>
        <label className="field ai-assistant-bar__question">
          <span className="field__label">Your question</span>
          <input
            className="field__input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. How do I debug ImagePullBackOff on EKS?"
            aria-label="Question for the assistant"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void ask();
              }
            }}
          />
        </label>
        {error && <p className="error small-print">{error}</p>}
        {output && <pre className="ai-assistant-bar__output">{output}</pre>}
      </div>
    </section>
  );
}
