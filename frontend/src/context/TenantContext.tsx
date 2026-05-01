/* eslint-disable react-refresh/only-export-components -- hook exported next to provider */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getTenantId, setTenantId as persistTenant } from "../api/tenant";

type TenantCtx = {
  tenantId: string;
  setTenantId: (id: string) => void;
};

const Ctx = createContext<TenantCtx | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenantId, _set] = useState(() => getTenantId());

  const setTenantId = useCallback((id: string) => {
    persistTenant(id);
    _set(getTenantId());
  }, []);

  const value = useMemo(
    () => ({
      tenantId,
      setTenantId,
    }),
    [tenantId, setTenantId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTenant(): TenantCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("TenantProvider missing");
  return v;
}
