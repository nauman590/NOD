import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Upload, Camera, ChevronDown, ArrowRight, X } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Tasker — Get help on demand" },
      { name: "description", content: "Snap a photo, describe your task, get an instant AI-estimated price. Junk removal, delivery, furniture moves and more." },
    ],
  }),
});

const CATEGORIES = [
  { value: "junk", label: "Junk removal", base: 89 },
  { value: "delivery", label: "Delivery", base: 35 },
  { value: "furniture", label: "Furniture move", base: 120 },
  { value: "other", label: "Other services", base: 50 },
] as const;

function Index() {
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("");
  const [details, setDetails] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const ready = !!photo && !!category && details.trim().length > 5;

  const handleContinue = () => {
    const cat = CATEGORIES.find((c) => c.value === category);
    if (!cat) return;
    sessionStorage.setItem(
      "taskDraft",
      JSON.stringify({ photo, category, categoryLabel: cat.label, base: cat.base, details }),
    );
    navigate({ to: "/estimate" });
  };


  const handleFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setPhoto(e.target?.result as string);
    reader.readAsDataURL(f);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-8 pb-32">
        <header className="mb-7">
          <h1 className="text-3xl font-semibold tracking-tight">What needs doing?</h1>
          <p className="mt-1 text-sm text-muted-foreground">Snap a photo. Get an instant price.</p>
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

          {!photo ? (
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
              <img src={photo} alt="Your task" className="aspect-[4/3] w-full object-cover" />
              <button
                onClick={() => setPhoto(null)}
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
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Task type
          </label>
          <div className="relative">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-14 w-full appearance-none rounded-2xl border border-border bg-card px-4 pr-11 text-base font-medium text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
            >
              <option value="" disabled>Select a service…</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </section>

        {/* Description */}
        <section className="mt-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Details
          </label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            placeholder="E.g. Old sofa and two boxes in the garage, second floor walk-up…"
            className="w-full resize-none rounded-2xl border border-border bg-card p-4 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
        </section>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Get an instant AI-estimated price on the next step.
        </p>

        <div className="mt-8 text-center">
          <Link
            to="/provider"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
          >
            Provider login
          </Link>
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
            {ready ? (
              <>See my price <ArrowRight className="h-5 w-5" /></>
            ) : (
              <>Fill in details to continue</>
            )}
          </button>
        </div>
      </div>

    </main>
  );
}
