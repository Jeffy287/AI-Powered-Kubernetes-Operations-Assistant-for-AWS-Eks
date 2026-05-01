# eks-operations-assistant-api

FastAPI service providing health checks, diagnostics endpoints, and (later) Kubernetes-scoped read APIs for the EKS Operations Assistant.

## Configuration

Copy `.env.example` to `.env` and adjust. Settings load from environment variables prefixed with `EKS_ASSISTANT_`.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn eks_assistant.main:app --reload --host 0.0.0.0 --port 8000
```

## Package layout

```
src/eks_assistant/
  main.py           # FastAPI app factory
  api/              # Routers and HTTP-facing code
  core/             # Settings and shared config
  services/         # k8sgpt_runner (CLI), kubernetes_gateway (future)
```

## K8sGPT

The API shells out to the **`k8sgpt`** binary (`EKS_ASSISTANT_K8SGPT_BINARY`, default `k8sgpt`).

- **Docker:** `backend/Dockerfile` downloads a pinned release from GitHub into `/usr/local/bin/k8sgpt`. Bump `K8SGPT_VERSION` in the Dockerfile or pass `--build-arg K8SGPT_VERSION=vX.Y.Z` when building.
- **Local:** install K8sGPT on the host and ensure `KUBECONFIG` (or in-cluster config) points at your cluster. EKS kubeconfigs often use `aws eks get-token`; the container may need the **AWS CLI** and credentials if you mount `~/.kube` but not other auth helpers.

- `GET /api/v1/diagnostics/k8sgpt/version` — verify CLI
- `POST /api/v1/diagnostics/k8sgpt/analyze` — body `{ "namespace": null, "explain": false, "filters": ["Pod"] }`
