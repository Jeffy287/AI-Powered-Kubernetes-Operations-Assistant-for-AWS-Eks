import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./layout/AppLayout";
import { ClusterExplorerPage } from "./pages/ClusterExplorerPage";
import { ConnectWizardPage } from "./pages/ConnectWizardPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RemediationPage } from "./pages/RemediationPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/connect" element={<ConnectWizardPage />} />
        <Route path="/cluster" element={<ClusterExplorerPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/remediation" element={<RemediationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
