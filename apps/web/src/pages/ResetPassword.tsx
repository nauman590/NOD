import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = "Choose a new password — Tasker";
  }, []);

  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = !!token && password.length >= 6 && password === confirm && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (e: any) {
      setError(
        e?.status === 400
          ? "This reset link is invalid or has expired. Request a new one."
          : e?.message || "Couldn't reset your password. Please try again.",
      );
      setBusy(false);
    }
  };

  const inp = "h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";

  if (!token) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto w-full max-w-md px-5 pt-6">
          <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to login
          </Link>
          <h1 className="mt-8 text-3xl font-bold tracking-tight">Invalid reset link</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link is missing its reset token. Please request a new password reset.
          </p>
          <Link
            to="/forgot-password"
            className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30"
          >
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto w-full max-w-md px-5 pt-6">
          <div className="mt-16 flex flex-col items-center text-center">
            <CheckCircle2 className="h-14 w-14 text-primary" />
            <h1 className="mt-4 text-3xl font-bold tracking-tight">Password updated</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your password has been changed and you've been signed out of other devices. Log in with your new password.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="mt-8 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99]"
            >
              Go to login
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pick a password you don't use anywhere else.</p>

        <div className="mt-8 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inp}
              placeholder="At least 6 characters"
            />
            {tooShort && <span className="mt-1 block text-xs text-destructive">Use at least 6 characters.</span>}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Confirm new password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className={inp}
              placeholder="Re-enter your password"
            />
            {mismatch && <span className="mt-1 block text-xs text-destructive">Passwords don't match.</span>}
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            disabled={!canSubmit}
            onClick={submit}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? "Updating…" : "Update password"}
          </button>

          {error && (
            <p className="pt-2 text-center text-sm text-muted-foreground">
              <Link to="/forgot-password" className="font-semibold text-primary underline underline-offset-4">
                Request a new reset link
              </Link>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
