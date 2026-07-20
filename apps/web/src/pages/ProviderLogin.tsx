import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function ProviderLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("pro1@nod.app");
  const [password, setPassword] = useState("provider1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Provider login — Tasker";
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      if (user.role !== "PROVIDER") {
        setError("This account is not a provider account.");
        setBusy(false);
        return;
      }
      navigate("/provider");
    } catch (e: any) {
      setError(e?.message || "Login failed");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight">Provider login</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to find work nearby.</p>

        <div className="mt-8 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
          </label>

          <div className="text-right">
            <Link to="/forgot-password?kind=provider" className="text-sm font-medium text-primary hover:underline underline-offset-4">
              Forgot password?
            </Link>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            disabled={busy}
            onClick={submit}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <p className="pt-2 text-center text-sm text-muted-foreground">
            New here?{" "}
            <Link to="/provider/signup" className="font-semibold text-primary underline underline-offset-4">
              Become a provider
            </Link>
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Demo accounts: pro1@nod.app · pro2@nod.app · pro3@nod.app (pw: provider1234)
          </p>
        </div>
      </div>
    </main>
  );
}
