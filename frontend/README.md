# eks-operations-assistant-web

React + Vite + TypeScript dashboard for the EKS Operations Assistant.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with `/api` proxied to `http://127.0.0.1:8000` |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |

## Layout

```
src/
  api/           # HTTP client (calls /api/v1)
  components/    # Shared UI
  pages/         # Route-level views
  styles/        # Global CSS
```

Run the **backend** on port `8000` before using API-dependent views locally.
