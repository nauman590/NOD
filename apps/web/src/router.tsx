import { createBrowserRouter, Link, Navigate, useRouteError, useNavigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import Index from "./pages/Index";
import Estimate from "./pages/Estimate";
import Checkout from "./pages/Checkout";
import JobTracking from "./pages/JobTracking";
import MyJobs from "./pages/MyJobs";
import CustomerAccount from "./pages/CustomerAccount";
import CustomerLogin from "./pages/CustomerLogin";
import CustomerSignup from "./pages/CustomerSignup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import RateJob from "./pages/RateJob";
import Provider from "./pages/Provider";
import ProviderAdjust from "./pages/ProviderAdjust";
import ProviderLogin from "./pages/ProviderLogin";
import ProviderSignup from "./pages/ProviderSignup";
import ProviderOnboarding from "./pages/ProviderOnboarding";
import ProviderAccount from "./pages/ProviderAccount";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminProviders from "./pages/admin/AdminProviders";
import AdminCategories from "./pages/admin/AdminCategories";
import AdminJobs from "./pages/admin/AdminJobs";
import AdminDisputes from "./pages/admin/AdminDisputes";
import AdminOffPlatform from "./pages/admin/AdminOffPlatform";
import AdminCustomers from "./pages/admin/AdminCustomers";
import AdminPayments from "./pages/admin/AdminPayments";
import ReportIssue from "./pages/ReportIssue";

// Where a signed-in user belongs when they land somewhere meant for a different role.
// Sending everyone to "/" strands a provider or admin on the customer home.
const homeFor = (role?: string) => (role === "PROVIDER" ? "/provider" : role === "ADMIN" ? "/admin" : "/");

function RequireRole({ role, children }: { role: "PROVIDER" | "ADMIN" | "CUSTOMER"; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to={role === "PROVIDER" ? "/provider/login" : "/"} replace />;
  // Wrong role: bounce to their own home. Without this the page still renders and its
  // queries fire against role-guarded endpoints, so the user just gets an "Insufficient
  // role" error modal with no way forward.
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">The page you're looking for doesn't exist or has been moved.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorBoundary() {
  const error = useRouteError();
  console.error(error);
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try refreshing or head back home.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => navigate(0)} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Try again
          </button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <Index />, errorElement: <ErrorBoundary /> },
  { path: "/estimate", element: <Estimate /> },
  { path: "/checkout", element: <Checkout /> },
  { path: "/login", element: <CustomerLogin /> },
  { path: "/signup", element: <CustomerSignup /> },
  { path: "/forgot-password", element: <ForgotPassword /> },
  { path: "/reset-password", element: <ResetPassword /> },
  // Customer-only screens. These call CUSTOMER-guarded endpoints (/jobs/mine, the
  // add-on approve/decline actions), so a provider or admin session must be redirected
  // rather than left to render a page that can only 403.
  { path: "/my-jobs", element: <RequireRole role="CUSTOMER"><MyJobs /></RequireRole> },
  { path: "/account", element: <RequireRole role="CUSTOMER"><CustomerAccount /></RequireRole> },
  { path: "/job/:jobId", element: <RequireRole role="CUSTOMER"><JobTracking /></RequireRole> },
  // Rating and dispute reporting are deliberately NOT role-locked — the brief makes both
  // two-way, their APIs are role-agnostic, and the provider dashboard links to /report.
  { path: "/job/:jobId/rate", element: <RateJob /> },
  { path: "/job/:jobId/report", element: <ReportIssue /> },
  { path: "/provider/login", element: <ProviderLogin /> },
  { path: "/provider/signup", element: <ProviderSignup /> },
  { path: "/provider/onboarding", element: <RequireRole role="PROVIDER"><ProviderOnboarding /></RequireRole> },
  { path: "/provider/account", element: <RequireRole role="PROVIDER"><ProviderAccount /></RequireRole> },
  { path: "/provider", element: <RequireRole role="PROVIDER"><Provider /></RequireRole> },
  { path: "/provider/adjust/:jobId", element: <RequireRole role="PROVIDER"><ProviderAdjust /></RequireRole> },
  { path: "/admin/login", element: <AdminLogin /> },
  {
    path: "/admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: "providers", element: <AdminProviders /> },
      { path: "customers", element: <AdminCustomers /> },
      { path: "categories", element: <AdminCategories /> },
      { path: "jobs", element: <AdminJobs /> },
      { path: "payments", element: <AdminPayments /> },
      { path: "disputes", element: <AdminDisputes /> },
      { path: "off-platform", element: <AdminOffPlatform /> },
    ],
  },
  { path: "*", element: <NotFound /> },
]);
