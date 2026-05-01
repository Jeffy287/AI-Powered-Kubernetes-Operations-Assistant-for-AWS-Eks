import { getTenantId } from "./tenant";

const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function detailFromFastApiBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.every((x) => typeof x === "object")) {
    const msgs = d.map((x) =>
      typeof (x as { msg?: string }).msg === "string"
        ? (x as { msg: string }).msg
        : JSON.stringify(x),
    );
    return msgs.join("; ");
  }
  if (d !== undefined && d !== null) {
    try {
      return JSON.stringify(d);
    } catch {
      return String(d);
    }
  }
  return null;
}

function errorMessageFromText(text: string, statusText: string): string {
  const fallback = statusText || "Request failed";
  if (!text.trim()) return fallback;
  try {
    const raw = JSON.parse(text) as unknown;
    const detail = detailFromFastApiBody(raw);
    if (detail) return detail;
  } catch {
    return text.slice(0, 500) || fallback;
  }
  return text.slice(0, 500) || fallback;
}

export type TenantRequestOpts = {
  /** Use this workspace/tenant for `X-Tenant-ID` (e.g. before React tenant context updates). */
  tenantId?: string;
};

function tenantHeaders(extra?: HeadersInit, tenantIdOverride?: string): HeadersInit {
  return {
    ...extra,
    "X-Tenant-ID": tenantIdOverride ?? getTenantId(),
  };
}

export async function getJson<T>(path: string, opts?: TenantRequestOpts): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: tenantHeaders({ Accept: "application/json" }, opts?.tenantId),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(errorMessageFromText(text, res.statusText), res.status);
  }
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export async function postJson<T>(path: string, body: unknown, opts?: TenantRequestOpts): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: tenantHeaders(
      {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      opts?.tenantId,
    ),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(errorMessageFromText(text, res.statusText), res.status);
  }
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export async function postWithoutBody<T>(path: string, opts?: TenantRequestOpts): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: tenantHeaders({ Accept: "application/json" }, opts?.tenantId),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(errorMessageFromText(text, res.statusText), res.status);
  }
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export async function deleteJson<T = Record<string, unknown>>(
  path: string,
  opts?: TenantRequestOpts,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: tenantHeaders({ Accept: "application/json" }, opts?.tenantId),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(errorMessageFromText(text, res.statusText), res.status);
  }
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export async function postForm<T>(path: string, form: FormData, opts?: TenantRequestOpts): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: tenantHeaders({ Accept: "application/json" }, opts?.tenantId),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(errorMessageFromText(text, res.statusText), res.status);
  }
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}
