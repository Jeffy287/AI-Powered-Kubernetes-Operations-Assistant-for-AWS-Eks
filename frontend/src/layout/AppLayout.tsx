import { NavLink, Outlet } from "react-router-dom";
import { useTenant } from "../context/TenantContext";

const nav = [
  { to: "/", label: "Overview", icon: "📊" },
  { to: "/connect", label: "Connect", icon: "🔗" },
  { to: "/cluster", label: "Explorer", icon: "🗂️" },
  { to: "/incidents", label: "Incidents", icon: "📋" },
  { to: "/remediation", label: "Remediation", icon: "🔧" },
];

export function AppLayout() {
  const { tenantId, setTenantId } = useTenant();

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="app-header__brand">
            <span className="app-header__logo" aria-hidden>⚡</span>
            <div>
              <h1 className="app-header__title">EKS Operations Assistant</h1>
              <p className="app-header__subtitle">
                AI-powered cluster management & incident intelligence
              </p>
            </div>
          </div>
          <div className="app-header__tenant">
            <label className="tenant-field">
              <span>Workspace</span>
              <input
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="default"
                autoComplete="off"
              />
            </label>
          </div>
        </div>
        <nav className="app-nav" aria-label="Primary">
          {nav.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `app-nav__link${isActive ? " app-nav__link--active" : ""}`
              }
              title={label}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
