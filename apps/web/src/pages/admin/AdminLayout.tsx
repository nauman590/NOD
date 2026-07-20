import { useState } from "react";
import { NavLink, Outlet, useNavigate, Navigate } from "react-router-dom";
import { LayoutDashboard, Users, UserRound, Tags, Briefcase, CreditCard, ShieldAlert, Ban, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/providers", label: "Providers", icon: Users, end: false },
  { to: "/admin/customers", label: "Customers", icon: UserRound, end: false },
  { to: "/admin/categories", label: "Categories", icon: Tags, end: false },
  { to: "/admin/jobs", label: "Jobs", icon: Briefcase, end: false },
  { to: "/admin/payments", label: "Payments", icon: CreditCard, end: false },
  { to: "/admin/disputes", label: "Disputes", icon: ShieldAlert, end: false },
  { to: "/admin/off-platform", label: "Off-platform", icon: Ban, end: false },
];

export default function AdminLayout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>;
  if (!user || user.role !== "ADMIN") return <Navigate to="/admin/login" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      {/* Mobile top bar with a hamburger toggle (hidden on desktop). */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:hidden">
        <div className="text-lg font-bold tracking-tight">NOD <span className="text-primary">Admin</span></div>
        <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Backdrop behind the mobile drawer. */}
      {drawerOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setDrawerOpen(false)} aria-hidden />}

      {/* Sidebar: static on desktop, an off-canvas drawer on mobile. */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-border bg-card p-4 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-2 py-3">
          <div>
            <div className="text-lg font-bold tracking-tight">NOD <span className="text-primary">Admin</span></div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </div>
          <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="mt-4 flex-1 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setDrawerOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => { logout(); navigate("/admin/login"); }}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </aside>

      {/* min-w-0 lets wide tables scroll inside this column instead of stretching the page. */}
      <main className="min-w-0 flex-1 overflow-auto p-4 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
