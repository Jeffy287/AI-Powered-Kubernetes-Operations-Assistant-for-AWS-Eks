import { Outlet } from "react-router-dom";

/** Shell for the workspace directory only — no cluster navigation. */
export function LandingLayout() {
  return (
    <div className="app-shell app-shell--landing">
      <header className="app-landing-bar">
        <span className="app-sidebar__logo" aria-hidden>
          EO
        </span>
        <div>
          <h1 className="app-sidebar__title">EKS Operations Assistant</h1>
          <p className="app-sidebar__subtitle">Pick a workspace to connect and explore clusters</p>
        </div>
      </header>
      <main className="app-shell__content app-shell__content--landing">
        <Outlet />
      </main>
    </div>
  );
}
