import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { api, uploadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useModal } from "@/components/ui/Modal";
import ProviderHeader from "@/components/ProviderHeader";

export default function ProviderAccount() {
  const { user, refreshMe } = useAuth();
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

  useEffect(() => {
    document.title = "Account — Tasker";
  }, []);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName ?? "");
      setEmail(user.email ?? "");
      setPhone(user.phone ?? "");
    }
  }, [user]);

  // The provider's avatar lives on the Provider profile (not the User), so fetch it.
  useEffect(() => {
    api<any>("/providers/me").then((p) => setPhotoUrl(p?.profilePhotoUrl ?? null)).catch(() => {});
  }, []);

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      setPhotoUrl(url);
      await api("/providers/me", { method: "PATCH", body: { profilePhotoUrl: url } });
    } catch (e: any) {
      await modal.alert("Couldn't upload", e?.message || "Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await api("/auth/profile", { method: "PATCH", body: { fullName: fullName.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined } });
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-8 pb-24">
        <ProviderHeader title="Account" />

        <section className="mb-6 flex flex-col items-center rounded-3xl border border-border bg-card p-6">
          <div className="relative">
            {photoUrl ? (
              <img src={photoUrl} alt="Your profile" className="h-24 w-24 rounded-full object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary text-3xl font-bold text-muted-foreground">
                {(fullName || email || "?").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change profile photo"
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-md disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">This photo is shown to customers on your jobs.</p>
        </section>

        <section className="rounded-3xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Profile</h2>
          <div className="mt-4 space-y-3">
            <Field label="Full name"><input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inp} /></Field>
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inp} /></Field>
            <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} placeholder="+1 555 123 4567" /></Field>
          </div>
          <button disabled={savingProfile} onClick={saveProfile}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 disabled:opacity-60">
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
