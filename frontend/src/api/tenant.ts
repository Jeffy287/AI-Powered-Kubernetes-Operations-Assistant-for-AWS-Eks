const TENANT_KEY = "eks_assistant_tenant_id";

export function getTenantId(): string {
  if (typeof window === "undefined") {
    return "default";
  }
  const v = localStorage.getItem(TENANT_KEY)?.trim();
  return v && v.length > 0 ? v : "default";
}

export function setTenantId(id: string): void {
  localStorage.setItem(TENANT_KEY, id.trim() || "default");
}
