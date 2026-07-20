import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Upload, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { uploadFile } from "@/lib/api";

export default function ProviderSignup() {
  const navigate = useNavigate();
  const { registerProvider } = useAuth();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", vehicleType: "", licenseUrl: "", profilePhotoUrl: "" });
  const [smsOptIn, setSmsOptIn] = useState(true); // brief: defaults to checked
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = "Become a provider — Tasker"; }, []);

  const [uploading, setUploading] = useState<{ license: boolean; photo: boolean }>({ license: false, photo: false });
  const licenseRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const valid = form.fullName && form.email && form.phone && form.password.length >= 6 && form.vehicleType;

  const handleUpload = async (which: "license" | "photo", file: File) => {
    setUploading((u) => ({ ...u, [which]: true }));
    try {
      const { url } = await uploadFile(file);
      set(which === "license" ? "licenseUrl" : "profilePhotoUrl", url);
    } finally {
      setUploading((u) => ({ ...u, [which]: false }));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerProvider({ ...form, smsOptIn } as any);
      navigate("/provider/onboarding");
    } catch (e: any) {
      setError(e?.message || "Signup failed");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-12">
        <Link to="/provider/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-8 text-3xl font-bold tracking-tight">Become a provider</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign up, set your rates, and start claiming jobs once approved.</p>

        <div className="mt-6 space-y-3">
          <F label="Full name"><I value={form.fullName} onChange={(v) => set("fullName", v)} /></F>
          <F label="Email"><I value={form.email} onChange={(v) => set("email", v)} type="email" /></F>
          <F label="Phone"><I value={form.phone} onChange={(v) => set("phone", v)} /></F>
          <F label="Password"><I value={form.password} onChange={(v) => set("password", v)} type="password" /></F>
          <F label="Vehicle type"><I value={form.vehicleType} onChange={(v) => set("vehicleType", v)} placeholder="e.g. Pickup truck, Cargo van" /></F>

          <F label="Driver's license">
            <input ref={licenseRef} type="file" accept="image/*,application/pdf" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleUpload("license", e.target.files[0])} />
            <UploadButton uploading={uploading.license} done={!!form.licenseUrl} onClick={() => licenseRef.current?.click()} label="Upload license" />
          </F>

          <F label="Profile photo">
            <input ref={photoRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleUpload("photo", e.target.files[0])} />
            {form.profilePhotoUrl ? (
              <div className="flex items-center gap-3">
                <img src={form.profilePhotoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                <UploadButton uploading={uploading.photo} done onClick={() => photoRef.current?.click()} label="Replace photo" />
              </div>
            ) : (
              <UploadButton uploading={uploading.photo} done={false} onClick={() => photoRef.current?.click()} label="Upload photo" />
            )}
          </F>

          <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
            <input type="checkbox" checked={smsOptIn} onChange={(e) => setSmsOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border accent-primary" />
            <span className="text-sm text-muted-foreground">Text me SMS updates (new jobs in my area, add-on decisions, payouts). You can turn this off anytime.</span>
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">An admin reviews every provider (background check) before activation.</p>

          <button disabled={!valid || busy || uploading.license || uploading.photo} onClick={submit}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 disabled:opacity-60">
            {busy ? "Creating account…" : "Create provider account"}
          </button>
        </div>
      </div>
    </main>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}
function I({ value, onChange, type = "text", placeholder }: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
    className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" />;
}
function UploadButton({ uploading, done, onClick, label }: { uploading: boolean; done: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={uploading}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition ${
        done ? "border-primary bg-primary/10 text-primary" : "border-dashed border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"
      }`}>
      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
      {uploading ? "Uploading…" : done ? "Uploaded" : label}
    </button>
  );
}
