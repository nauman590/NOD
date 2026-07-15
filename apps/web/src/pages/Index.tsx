import { useNavigate, Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload, Camera, ChevronDown, ArrowRight, X, Loader2, MapPin, ClipboardList } from "lucide-react";
import { api, uploadFile, getAccessToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import NotificationsBell from "@/components/NotificationsBell";
import type { Category } from "@/lib/types";

export default function Index() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [preview, setPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [categorySlug, setCategorySlug] = useState<string>("");
  const [details, setDetails] = useState("");
  const [intake, setIntake] = useState<Record<string, unknown>>({});
  const [serviceAddress, setServiceAddress] = useState("");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "Tasker — Get help on demand";
  }, []);

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });
  const category = categories.find((c) => c.slug === categorySlug);
  const isPickupDropoff = category?.intakeConfig?.addressMode === "pickup_dropoff";

  const addressReady = isPickupDropoff ? pickup.trim().length > 4 && dropoff.trim().length > 4 : serviceAddress.trim().length > 4;
  // First unmet requirement (shown on the CTA so the user knows exactly what's missing).
  const missing = uploading
    ? "Uploading photo…"
    : !photoUrl
      ? "Add a photo"
      : !categorySlug
        ? "Select a task type"
        : details.trim().length < 3
          ? "Add a few details"
          : !addressReady
            ? isPickupDropoff
              ? "Add pickup & drop-off addresses"
              : "Add the service address"
            : "";
  const ready = missing === "";

  const handleContinue = () => {
    if (!category) return;
    sessionStorage.setItem(
      "taskDraft",
      JSON.stringify({
        photoUrl,
        categorySlug,
        categoryName: category.name,
        details,
        intakeData: intake,
        addressMode: isPickupDropoff ? "pickup_dropoff" : "single",
        serviceAddress: serviceAddress.trim(),
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
      }),
    );
    navigate("/estimate");
  };

  const handleFile = async (f: File) => {
    setPreview(URL.createObjectURL(f));
    setUploading(true);
    setPhotoUrl(null);
    try {
      const { url } = await uploadFile(f);
      setPhotoUrl(url);
    } catch {
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const setField = (key: string, value: unknown) => setIntake((p) => ({ ...p, [key]: value }));
  const intakeFields = (category?.intakeConfig?.fields ?? []).filter((f) => f.feedsEstimate);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-8 pb-32">
        <header className="mb-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">What needs doing?</h1>
              <p className="mt-1 text-sm text-muted-foreground">Snap a photo. Get an instant price.</p>
            </div>
            <div className="flex items-center gap-2">
              {getAccessToken() && <NotificationsBell />}
              <Link
                to="/my-jobs"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
              >
                <ClipboardList className="h-4 w-4" /> My jobs
              </Link>
            </div>
          </div>
        </header>

        {/* Upload zone */}
        <section>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />

          {!preview ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="group relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-primary/40 bg-primary/5 transition-all hover:border-primary hover:bg-primary/10 active:scale-[0.99]"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform group-hover:scale-105">
                <Camera className="h-7 w-7" strokeWidth={2.25} />
              </div>
              <div className="text-center">
                <div className="text-base font-semibold">Tap to add a photo</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Use camera or upload from library</div>
              </div>
            </button>
          ) : (
            <div className="relative overflow-hidden rounded-3xl">
              <img src={preview} alt="Your task" className="aspect-[4/3] w-full object-cover" />
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                  <div className="flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium shadow-md">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
                  </div>
                </div>
              )}
              <button
                onClick={() => { setPreview(null); setPhotoUrl(null); }}
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md backdrop-blur transition hover:bg-background"
                aria-label="Remove photo"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur"
              >
                <Upload className="h-3.5 w-3.5" /> Replace
              </button>
            </div>
          )}
        </section>

        {/* Category */}
        <section className="mt-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Task type</label>
          <div className="relative">
            <select
              value={categorySlug}
              onChange={(e) => { setCategorySlug(e.target.value); setIntake({}); }}
              className="h-14 w-full appearance-none rounded-2xl border border-border bg-card px-4 pr-11 text-base font-medium text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
            >
              <option value="" disabled>Select a service…</option>
              {categories.map((c) => (<option key={c.slug} value={c.slug}>{c.name}</option>))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </section>

        {/* Description */}
        <section className="mt-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Details</label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            placeholder="E.g. Old sofa and two boxes in the garage, second floor walk-up…"
            className="w-full resize-none rounded-2xl border border-border bg-card p-4 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
        </section>

        {/* Address — depends on category (delivery asks pickup + drop-off) */}
        {category && (
          <section className="mt-5 space-y-4">
            {isPickupDropoff ? (
              <>
                <Addr label="Pickup address" icon value={pickup} onChange={setPickup} placeholder="Store or pickup location" />
                <Addr label="Drop-off address" icon value={dropoff} onChange={setDropoff} placeholder="123 Peachtree St, Atlanta, GA" />
              </>
            ) : (
              <Addr label="Service address" icon value={serviceAddress} onChange={setServiceAddress} placeholder="123 Peachtree St, Atlanta, GA" />
            )}
          </section>
        )}

        {/* Category-aware intake fields */}
        {intakeFields.length > 0 && (
          <section className="mt-5 space-y-4">
            {intakeFields.map((f) => (
              <div key={f.key}>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{f.label}</label>
                {f.type === "select" ? (
                  <div className="relative">
                    <select
                      value={(intake[f.key] as string) ?? ""}
                      onChange={(e) => setField(f.key, e.target.value)}
                      className="h-12 w-full appearance-none rounded-2xl border border-border bg-card px-4 pr-11 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
                    >
                      <option value="">Select…</option>
                      {f.options?.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                ) : f.type === "boolean" ? (
                  <button
                    type="button"
                    onClick={() => setField(f.key, !intake[f.key])}
                    className={`flex h-12 w-full items-center justify-between rounded-2xl border px-4 text-base font-medium transition ${
                      intake[f.key] ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {intake[f.key] ? "Yes" : "No"}
                    <span className={`h-6 w-11 rounded-full p-0.5 transition ${intake[f.key] ? "bg-primary" : "bg-muted"}`}>
                      <span className={`block h-5 w-5 rounded-full bg-background transition ${intake[f.key] ? "translate-x-5" : ""}`} />
                    </span>
                  </button>
                ) : (
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    value={(intake[f.key] as string) ?? ""}
                    onChange={(e) => setField(f.key, f.type === "number" ? Number(e.target.value) : e.target.value)}
                    className="h-12 w-full rounded-2xl border border-border bg-card px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
                  />
                )}
              </div>
            ))}
          </section>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">Get an instant AI-estimated price on the next step.</p>

        <div className="mt-8 text-center">
          {user ? (
            <button
              onClick={() => { logout(); navigate("/"); }}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
            >
              Log out{user.email ? ` (${user.email})` : ""}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-5">
              <Link to="/login" className="text-xs font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground">
                Customer log in
              </Link>
              <Link to="/provider/login" className="text-xs font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground">
                Provider login
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-md">
          <button
            disabled={!ready}
            onClick={handleContinue}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            {ready ? (<>See my price <ArrowRight className="h-5 w-5" /></>) : (<>{missing}</>)}
          </button>
        </div>
      </div>
    </main>
  );
}

function Addr({ label, value, onChange, placeholder, icon }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; icon?: boolean }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="relative">
        {icon && <MapPin className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`h-12 w-full rounded-2xl border border-border bg-card ${icon ? "pl-11" : "px-4"} pr-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15`}
        />
      </div>
    </div>
  );
}
