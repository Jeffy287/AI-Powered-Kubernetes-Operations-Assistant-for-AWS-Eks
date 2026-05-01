import { Outlet } from "react-router-dom";

/** Wrapper for workspace routes under `/w/:id/cluster/*`. */
export function ClusterShellLayout() {
  return (
    <div className="cluster-shell">
      <Outlet />
    </div>
  );
}
