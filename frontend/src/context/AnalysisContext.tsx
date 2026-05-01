/* eslint-disable react-refresh/only-export-components -- hook exported next to provider */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AnalysisCtx = {
  lastK8sGPT: unknown | null;
  setLastK8sGPT: (v: unknown | null) => void;
};

const Ctx = createContext<AnalysisCtx | null>(null);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [lastK8sGPT, setLastK8sGPTState] = useState<unknown | null>(null);

  const setLastK8sGPT = useCallback((v: unknown | null) => {
    setLastK8sGPTState(v);
  }, []);

  const value = useMemo(
    () => ({
      lastK8sGPT,
      setLastK8sGPT,
    }),
    [lastK8sGPT, setLastK8sGPT],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnalysis(): AnalysisCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("AnalysisProvider missing");
  return v;
}
