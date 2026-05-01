import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AnalysisProvider } from "./context/AnalysisContext";
import { TenantProvider } from "./context/TenantContext";
import "./styles/globals.css";

const el = document.getElementById("root");
if (!el) {
  throw new Error("Root element #root not found");
}

createRoot(el).render(
  <StrictMode>
    <BrowserRouter>
      <TenantProvider>
        <AnalysisProvider>
          <App />
        </AnalysisProvider>
      </TenantProvider>
    </BrowserRouter>
  </StrictMode>,
);
