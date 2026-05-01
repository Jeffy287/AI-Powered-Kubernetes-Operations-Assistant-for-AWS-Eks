import { Navigate, Route, Routes } from "react-router-dom";
import { ClusterShellLayout } from "./layout/ClusterShellLayout";
import { LandingLayout } from "./layout/LandingLayout";
import { WorkspaceLayout } from "./layout/WorkspaceLayout";
import { ClusterComputePage } from "./pages/ClusterComputePage";
import {
  ClusterAddonsPage,
  ClusterNetworkingPage,
  ClusterObservabilityPage,
} from "./pages/ClusterMiscPages";
import { ClusterExplorerPage } from "./pages/ClusterExplorerPage";
import { ConnectWizardPage } from "./pages/ConnectWizardPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";

export default function App() {
  return (
    <Routes>
      <Route element={<LandingLayout />}>
        <Route path="/" element={<WorkspacesPage />} />
      </Route>

      <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
        <Route index element={<Navigate to="cluster/compute" replace />} />
        <Route path="connect" element={<ConnectWizardPage />} />
        <Route path="cluster" element={<ClusterShellLayout />}>
          <Route index element={<Navigate to="compute" replace />} />
          <Route path="compute" element={<ClusterComputePage />} />
          <Route path="networking" element={<ClusterNetworkingPage />} />
          <Route path="observability" element={<ClusterObservabilityPage />} />
          <Route path="addons" element={<ClusterAddonsPage />} />
          <Route path="kubernetes" element={<ClusterExplorerPage />} />
        </Route>
      </Route>

      <Route path="/workspaces" element={<Navigate to="/" replace />} />
      <Route path="/connect" element={<Navigate to="/" replace />} />
      <Route path="/cluster" element={<Navigate to="/" replace />} />
      <Route path="/incidents" element={<Navigate to="/" replace />} />
      <Route path="/remediation" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
