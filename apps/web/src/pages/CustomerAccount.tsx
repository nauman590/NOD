import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Loader2, LogOut } from "lucide-react";
import { api, uploadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useModal } from "@/components/ui/Modal";

export default function CustomerAccount() {
  const { user, loading, refreshMe, logout } = useAuth();
  const navigate = useNavigate();
  const modal = useModal();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  // SMS notifications + phone verification
  const [smsOptIn, setSmsOptIn] = useState(true);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);

  useEffect(() => {
    document.title = "Account — Tasker";
  }, []);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName ?? "");
      setEmail(user.email ?? "");
      setPhone(user.phone ?? "");
      setPhotoUrl(user.profilePhotoUrl ?? null);
      setSmsOptIn(user.smsOptIn ?? true);
    }
  }, [user]);

  const toggleSmsOptIn = async (value: boolean) => {
    setSmsOptIn(value);
    try {
      await api("/auth/profile", { method: "PATCH", body: { smsOptIn: value } });
      await refreshMe();
    } catch (e: any) {
      setSmsOptIn(!value);
      await modal.alert("Couldn't update", e?.message || "Please try again.");
    }
  };

  const requestOtp = async () => {
    setOtpBusy(true);
    try {
      const r = await api<{ ok: boolean; sent: boolean; devCode?: string }>("/auth/phone/request-otp", { method: "POST", body: { phone: phone.trim() || undefined } });
      setOtpSent(true);
      if (r.devCode) {
        // Dev/stub mode (no Twilio): surface the code so verification can be completed.
        await modal.alert("Verification code sent", `SMS isn't live in this environment, so here's your code: ${r.devCode}`);
        setOtpCode(r.devCode);
      } else {
        await modal.alert("Code sent", "Enter the 6-digit code we texted you.");
      }
    } catch (e: any) {
      await modal.alert("Couldn't send code", e?.message || "Add a phone number first.");
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtp = async () => {
    setOtpBusy(true);
    try {
      await api("/auth/phone/verify-otp", { method: "POST", body: { code: otpCode.trim() } });
      await refreshMe();
      setOtpSent(false); setOtpCode("");
      await modal.alert("Phone verified", "Your phone number is now verified.");
    } catch (e: any) {
      await modal.alert("Couldn't verify", e?.message || "Check the code and try again.");
    } finally {
      setOtpBusy(false);
    }
  };

  if (!loading && !user) return <RequireLogin />;

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      setPhotoUrl(url);
      // Persist immediately so the avatar sticks even if they don't hit "Save profile".
      await api("/auth/profile", { method: "PATCH", body: { profilePhotoUrl: url } });
      await refreshMe();
    } catch (e: any) {
      await modal.alert("Couldn't upload", e?.message || "Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await api("/auth/profile", {
        method: "PATCH",
        body: { fullName: fullName.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined },
      });
      await refreshMe();
      await modal.alert("Saved", "Your profile has been updated.");
    } catch (e: any) {
      await modal.alert("Couldn't save", e?.message || "Please try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (next.length < 6) return modal.alert("Password too short", "Use at least 6 characters.");
    if (next !== confirm) return modal.alert("Passwords don't match", "Re-enter the new password.");
    setSavingPw(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      setCurrent(""); setNext(""); setConfirm("");
      await modal.alert("Password changed", "Use your new password next time you sign in.");
    } catch (e: any) {
      await modal.alert("Couldn't change password", e?.status === 401 ? "Your current password is incorrect." : e?.message || "Please try again.");
    } finally {
      setSavingPw(false);
    }
  };

  const inp = "h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";
  const initial = (fullName || email || "?").trim().charAt(0).toUpperCase();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-24">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <button onClick={() => { logout(); navigate("/"); }} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-destructive">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>

        <h1 className="mt-5 text-3xl font-bold tracking-tight">Account</h1>

        {/* Avatar */}
        <section className="mt-6 flex flex-col items-center rounded-3xl border border-border bg-card p-6">
          <div className="relative">
            {photoUrl ? (
              <img src={photoUrl} alt="Your profile" className="h-24 w-24 rounded-full object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary text-3xl font-bold text-muted-foreground">{initial}</div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change profile photo"
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-md disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Tap the camera to add a profile photo.</p>
        </section>

        <section className="mt-6 rounded-3xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Profile</h2>
          <div className="mt-4 space-y-3">
            <Field label="Full name"><input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inp} placeholder="Jane Doe" /></Field>
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inp} placeholder="you@example.com" /></Field>
            <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} placeholder="+1 555 123 4567" /></Field>
          </div>
          <button disabled={savingProfile} onClick={saveProfile}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 disabled:opacity-60">
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
        </section>

        <section className="mt-6 rounded-3xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">SMS &amp; notifications</h2>
          <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={smsOptIn} onChange={(e) => toggleSmsOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border accent-primary" />
            <span className="text-sm text-muted-foreground">Text me SMS updates about my jobs (claim, en route, arrival, completion &amp; receipt).</span>
          </label>

          <div className="mt-4 border-t border-border pt-4">
            {user?.phoneVerified ? (
              <p className="text-sm font-medium text-primary">✓ Phone verified{phone ? ` — ${phone}` : ""}</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Verify your phone number to receive SMS updates.</p>
                {!otpSent ? (
                  <button disabled={otpBusy} onClick={requestOtp}
                    className="flex h-11 w-full items-center justify-center rounded-2xl border border-primary text-sm font-semibold text-primary disabled:opacity-60">
                    {otpBusy ? "Sending…" : "Send verification code"}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="6-digit code" inputMode="numeric"
                      className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-primary" />
                    <button disabled={otpBusy || otpCode.trim().length < 4} onClick={verifyOtp}
                      className="h-11 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                      {otpBusy ? "…" : "Verify"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Change password</h2>
          <div className="mt-4 space-y-3">
            <Field label="Current password"><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inp} /></Field>
            <Field label="New password"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={inp} /></Field>
            <Field label="Confirm new password"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inp} /></Field>
          </div>
          <button disabled={savingPw || !current || !next} onClick={changePassword}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 disabled:opacity-60">
            {savingPw ? "Updating…" : "Update password"}
          </button>
        </section>
      </div>
    </main>
  );
}

function RequireLogin() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <div className="mt-10 rounded-3xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Log in to manage your account.</p>
          <Link to="/login?redirect=/account" className="mt-4 inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-8 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30">
            Log in
          </Link>
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
