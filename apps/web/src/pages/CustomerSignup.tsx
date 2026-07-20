import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function CustomerSignup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get("redirect") || "/my-jobs";
  const { registerCustomer, login } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(true); // brief: defaults to checked
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Create account — Tasker";
  }, []);

  const valid = fullName.trim().length > 1 && /.+@.+\..+/.test(email) && password.length >= 6;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await registerCustomer(email.trim(), password, fullName.trim(), { phone: phone.trim(), smsOptIn });
      navigate(redirect);
    } catch (e: any) {
      // Already registered → try logging them in with what they typed.
      if (e?.status === 409) {
        try {
          await login(email.trim(), password);
          navigate(redirect);
          return;
        } catch {
          setError("That email is already registered. Try logging in instead.");
        }
      } else {
        setError(e?.message || "Couldn't create your account. Please try again.");
      }
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

        <h1 className="mt-8 text-3xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign up to book jobs and track them anytime.</p>

        <div className="mt-8 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inp} placeholder="Jane Doe" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inp} placeholder="you@example.com" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Phone <span className="text-muted-foreground/70">(optional — verify later for SMS updates)</span></span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} placeholder="+1 404 555 0100" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Password (min 6 chars)</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className={inp} placeholder="Create a password" />
          </label>

          <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
            <input type="checkbox" checked={smsOptIn} onChange={(e) => setSmsOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border accent-primary" />
            <span className="text-sm text-muted-foreground">Text me SMS updates about my jobs (claim, en route, arrival, completion). You can turn this off anytime.</span>
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button disabled={busy || !valid} onClick={submit}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:opacity-60">
            {busy ? "Creating account…" : "Create account"}
          </button>

          <p className="pt-2 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to={`/login?redirect=${encodeURIComponent(redirect)}`} className="font-semibold text-primary underline underline-offset-4">Log in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
