import { useNavigate, Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Lock, Sparkles, Check } from "lucide-react";
import { api } from "@/lib/api";
import type { EstimateResult } from "@/lib/types";
import { dollars2 } from "@/lib/types";

interface TaskDraft {
  photoUrl: string | null;
  categorySlug: string;
  categoryName: string;
  details: string;
  intakeData: Record<string, unknown>;
  addressMode: "single" | "pickup_dropoff";
  serviceAddress: string;
  pickupAddress: string;
  dropoffAddress: string;
}

function loadDraft(): TaskDraft | null {
  try {
    const raw = sessionStorage.getItem("taskDraft");
    return raw ? (JSON.parse(raw) as TaskDraft) : null;
  } catch {
    return null;
  }
}

export default function Estimate() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(15 * 60);
  const ranRef = useRef(false);

  useEffect(() => {
    document.title = "Your estimate — Tasker";
  }, []);

  useEffect(() => {
    const d = loadDraft();
    if (!d) {
      navigate("/");
      return;
    }
    setDraft(d);
    if (ranRef.current) return;
    ranRef.current = true;
    api<EstimateResult>("/estimate", {
      method: "POST",
      body: {
        categorySlug: d.categorySlug,
        description: d.details,
        photoUrl: d.photoUrl,
        intakeData: d.intakeData,
        serviceAddress: d.addressMode === "single" ? d.serviceAddress : undefined,
        pickupAddress: d.addressMode === "pickup_dropoff" ? d.pickupAddress : undefined,
        dropoffAddress: d.addressMode === "pickup_dropoff" ? d.dropoffAddress : undefined,
      },
    })
      .then((res) => {
        setEstimate(res);
        sessionStorage.setItem("estimateId", res.estimateId);
        const secs = Math.max(0, Math.floor((new Date(res.lockedUntil).getTime() - Date.now()) / 1000));
        setSecondsLeft(secs);
      })
      .catch((e) => setError(e.message || "Could not price this task"));
  }, [navigate]);

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // Every line item that makes up the total, in the same order the server sums them so the
  // rows visibly reconcile to basePriceCents. Previously the trip fee (always present) and
  // the junk volume charge were omitted, so the itemization never added up to the price.
  const rows = useMemo(() => {
    if (!estimate) return [];
    const b = estimate.breakdown;
    const laborHours = b.estimatedHours + (b.driveTimeHours || 0);
    const list: { label: string; cents: number }[] = [
      { label: `Labor (${laborHours}h @ ${dollars2(b.avgRateCents)}/hr)`, cents: b.laborCents },
    ];
    if (b.volumeCents) list.push({ label: `Volume (${b.volumeCubicYards} cu yd)`, cents: b.volumeCents });
    if (b.tripCents) list.push({ label: "Trip fee", cents: b.tripCents });
    if (b.mileageCents) list.push({ label: "Mileage", cents: b.mileageCents });
    if (b.baseFeeCents) list.push({ label: "Service fee", cents: b.baseFeeCents });
    if (b.disposalFeeCents) list.push({ label: "Disposal fee", cents: b.disposalFeeCents });
    return list;
  }, [estimate]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <h1 className="text-xl font-semibold">Couldn't price this task</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Link to="/" className="mt-6 rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground">Start over</Link>
      </main>
    );
  }

  if (!draft || !estimate) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 animate-pulse text-primary" /> Pricing your task…
        </div>
      </main>
    );
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-36">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="mt-6 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
          <Sparkles className="h-3.5 w-3.5" /> AI estimated price
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-7xl font-bold tracking-tight leading-none">{dollars2(estimate.basePriceCents)}</span>
          <span className="text-2xl font-semibold text-muted-foreground">estimated</span>
        </div>

        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
          <Lock className="h-3 w-3" /> Price locked for {mm}:{ss}
        </div>

        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">What's included</h2>
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between px-4 py-3.5">
                <span className="text-sm">{r.label}</span>
                <span className="text-sm font-semibold">{dollars2(r.cents)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between px-4 py-3.5">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-sm font-bold">{dollars2(estimate.basePriceCents)}</span>
            </li>
          </ul>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            {["Same-day or next-day scheduling", "Vetted, insured professionals", "Free cancellation before a pro is en route"].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {t}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8 rounded-2xl bg-secondary p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Task</div>
          <div className="mt-1 text-base font-semibold">{draft.categoryName}</div>
          <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{draft.details}</p>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-md">
          <button
            onClick={() => navigate("/checkout")}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99]"
          >
            Confirm and pay · {dollars2(estimate.basePriceCents)}
          </button>
        </div>
      </div>
    </main>
  );
}
