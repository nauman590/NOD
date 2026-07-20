import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function ForgotPassword() {
  const [params] = useSearchParams();
  // "provider" | "admin" | (default) customer — controls where "Back to login" points.
  const kind = params.get("kind");
  const loginPath = kind === "provider" ? "/provider/login" : kind === "admin" ? "/admin/login" : "/login";
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Reset password — Tasker";
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await forgotPassword(email.trim());
      setSent(true);
      // Dev convenience only: no mailer is wired, so the API hands back the link.
      setDevResetUrl(r.resetUrl ?? null);
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const inp = "h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <Link to={loginPath} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight">Forgot password?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the email on your account and we'll send you a link to reset your password.
        </p>

        {sent ? (
          <div className="mt-8 space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-sm text-foreground">
                If an account exists for <span className="font-semibold">{email.trim()}</span>, a password reset link is on its way.
                The link expires in 1 hour.
              </p>
            </div>

            {devResetUrl && (
              <div className="rounded-2xl border border-dashed border-primary/50 bg-primary/5 p-4">
                <p className="text-xs font-semibold text-primary">Dev mode — no email provider configured</p>
                <p className="mt-1 text-xs text-muted-foreground">Use this link to continue:</p>
                <Link
                  to={devResetUrl.replace(/^https?:\/\/[^/]+/, "")}
                  className="mt-2 block break-all text-sm font-medium text-primary underline underline-offset-4"
                >
                  {devResetUrl}
                </Link>
              </div>
            )}

            <Link to={loginPath} className="block text-center text-sm font-semibold text-primary underline underline-offset-4">
              Return to login
            </Link>
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email.trim() && submit()}
                className={inp}
                placeholder="you@example.com"
              />
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              disabled={busy || !email.trim()}
              onClick={submit}
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>

            <p className="pt-2 text-center text-sm text-muted-foreground">
              Remembered it?{" "}
              <Link to={loginPath} className="font-semibold text-primary underline underline-offset-4">
                Back to login
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
