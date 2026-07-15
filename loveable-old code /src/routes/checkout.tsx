import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Lock, CreditCard } from "lucide-react";
import { addJob } from "@/lib/provider-store";

export const Route = createFileRoute("/checkout")({
  component: CheckoutPage,
  head: () => ({
    meta: [
      { title: "Checkout — Tasker" },
      { name: "description", content: "Secure Stripe checkout for your task." },
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

function CheckoutPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("taskDraft");
      if (!raw) {
        navigate({ to: "/" });
        return;
      }
      const d = JSON.parse(raw) as TaskDraft;
      setDraft(d);
      const detailFactor = Math.min(d.details.trim().length, 240) / 6;
      const photoBoost = d.photo ? 12 : 0;
      setTotal(Math.round(d.base + detailFactor + photoBoost));
    } catch {
      navigate({ to: "/" });
    }
  }, [navigate]);

  if (!draft || total === null) return null;

  const formatCard = (v: string) =>
    v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  const formatExp = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  };

  const valid = card.replace(/\s/g, "").length >= 13 && exp.length >= 5 && cvc.length >= 3 && name.trim().length > 1 && address.trim().length > 4;

  const handlePay = () => {
    setPaying(true);
    setTimeout(() => {
      setPaying(false);
      addJob({
        photo: draft.photo,
        category: draft.categoryLabel,
        description: draft.details,
        distance: Math.round((0.4 + Math.random() * 3) * 10) / 10,
        customerPrice: total,
        customerAddress: address.trim(),
      });
      alert("Payment successful — a provider will claim your job shortly.");
      sessionStorage.removeItem("taskDraft");
      navigate({ to: "/" });
    }, 1200);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-36">
        <Link to="/estimate" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <h1 className="mt-5 text-3xl font-bold tracking-tight">Checkout</h1>

        {/* Order summary */}
        <section className="mt-6 rounded-3xl border border-border bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Order summary</div>
          <div className="mt-3 flex items-start gap-3">
            {draft.photo ? (
              <img src={draft.photo} alt="" className="h-16 w-16 rounded-xl object-cover" />
            ) : (
              <div className="h-16 w-16 rounded-xl bg-secondary" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">{draft.categoryLabel}</div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{draft.details}</p>
            </div>
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-3xl font-bold tracking-tight">${total}</span>
            </div>
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> Price locked · secure checkout
            </div>
          </div>
        </section>

        {/* Service address */}
        <section className="mt-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Service address</h2>
          <div className="mt-3">
            <Field label="Where should the pro come?">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, San Francisco, CA"
                className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
            </Field>
          </div>
        </section>

        {/* Card form */}
        <section className="mt-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Payment</h2>

          <div className="mt-3 space-y-3">
            <Field label="Name on card">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
            </Field>

            <Field label="Card number">
              <div className="relative">
                <input
                  value={card}
                  onChange={(e) => setCard(formatCard(e.target.value))}
                  placeholder="1234 1234 1234 1234"
                  inputMode="numeric"
                  className="h-12 w-full rounded-xl border border-border bg-card px-4 pr-12 text-base tracking-wider outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                />
                <CreditCard className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Expiry">
                <input
                  value={exp}
                  onChange={(e) => setExp(formatExp(e.target.value))}
                  placeholder="MM/YY"
                  inputMode="numeric"
                  className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                />
              </Field>
              <Field label="CVC">
                <input
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="123"
                  inputMode="numeric"
                  className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                />
              </Field>
            </div>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Stripe placeholder — no real charge is made. Powered by Stripe.
          </p>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-md">
          <button
            disabled={!valid || paying}
            onClick={handlePay}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            {paying ? "Processing…" : `Pay now · $${total}`}
          </button>
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
