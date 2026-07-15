import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [email, setEmail] = useState("admin@nod.app");
  const [password, setPassword] = useState("admin1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Admin — NOD";
    if (user?.role === "ADMIN") navigate("/admin");
  }, [user, navigate]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      if (u.role !== "ADMIN") {
        setError("Not an admin account.");
        setBusy(false);
        return;
      }
      navigate("/admin");
    } catch (e: any) {
      setError(e?.message || "Login failed");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8">
        <h1 className="text-2xl font-bold tracking-tight">NOD Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Operations dashboard</p>
        <div className="mt-6 space-y-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
            className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button disabled={busy} onClick={submit}
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 disabled:opacity-60">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}
