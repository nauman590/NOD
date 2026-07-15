import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Lock, Sparkles, Check } from "lucide-react";

export const Route = createFileRoute("/estimate")({
  component: EstimatePage,
  head: () => ({
    meta: [
      { title: "Your estimate — Tasker" },
      { name: "description", content: "AI-estimated price for your task, locked for 15 minutes." },
    ],
  }),
});

type TaskDraft = {
  photo: string | null;
  category: string;
  categoryLabel: string;
  base: number;
  details: string;
};

function loadDraft(): TaskDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("taskDraft");
    return raw ? (JSON.parse(raw) as TaskDraft) : null;
  } catch {
    return null;
  }
}

function EstimatePage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(15 * 60);

  useEffect(() => {
    const d = loadDraft();
    if (!d) {
      navigate({ to: "/" });
      return;
    }
    setDraft(d);
  }, [navigate]);

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const breakdown = useMemo(() => {
    if (!draft) return null;
    const detailFactor = Math.min(draft.details.trim().length, 240) / 6;
    const photoBoost = draft.photo ? 12 : 0;
    const subtotal = Math.round(draft.base + detailFactor + photoBoost);
    const labor = Math.round(subtotal * 0.55);
    const haul = Math.round(subtotal * 0.2);
    const disposal = Math.round(subtotal * 0.15);
    const service = subtotal - labor - haul - disposal;
    return { subtotal, labor, haul, disposal, service };
  }, [draft]);

  if (!draft || !breakdown) return null;

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
          <span className="text-7xl font-bold tracking-tight leading-none">${breakdown.subtotal}</span>
          <span className="text-2xl font-semibold text-muted-foreground">estimated</span>
        </div>

        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
          <Lock className="h-3 w-3" /> Price locked for {mm}:{ss}
        </div>

        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">What's included</h2>
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
            <Row label="Labor (1–2 pros)" value={breakdown.labor} />
            <Row label="Haul-away" value={breakdown.haul} />
            <Row label="Disposal fee" value={breakdown.disposal} />
            <Row label="Service & insurance" value={breakdown.service} />
          </ul>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            {["Same-day or next-day scheduling", "Vetted, insured professionals", "Free cancellation up to 1 hour before"].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {t}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8 rounded-2xl bg-secondary p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Task</div>
          <div className="mt-1 text-base font-semibold">{draft.categoryLabel}</div>
          <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{draft.details}</p>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-md">
          <button
            onClick={() => navigate({ to: "/checkout" })}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99]"
          >
            Confirm and pay · ${breakdown.subtotal}
          </button>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between px-4 py-3.5">
      <span className="text-sm">{label}</span>
      <span className="text-sm font-semibold">${value}</span>
    </li>
  );
}
