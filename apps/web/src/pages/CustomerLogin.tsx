import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function CustomerLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get("redirect") || "/my-jobs";
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Log in — Tasker";
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      if (u.role === "PROVIDER") { navigate("/provider"); return; }
      if (u.role === "ADMIN") { navigate("/admin"); return; }
      navigate(redirect);
    } catch (e: any) {
      setError(e?.status === 401 ? "Incorrect email or password." : e?.message || "Login failed");
      setBusy(false);
    }
  };

  const inp = "h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Log in to view your jobs and quotes.</p>

        <div className="mt-8 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inp} placeholder="you@example.com" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className={inp} />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button disabled={busy || !email || !password} onClick={submit}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:opacity-60">
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <p className="pt-2 text-center text-sm text-muted-foreground">
            New here? Just <Link to="/" className="font-semibold text-primary underline underline-offset-4">book a job</Link> — you'll create your account at checkout.
          </p>
        </div>
      </div>
    </main>
  );
}
