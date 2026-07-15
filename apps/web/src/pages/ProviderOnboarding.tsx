import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { CheckCircle2, Clock, CreditCard, Landmark } from "lucide-react";
import { api } from "@/lib/api";
import { getStripe } from "@/lib/stripe";
import { useAuth } from "@/lib/auth";
import { useModal, Modal } from "@/components/ui/Modal";
import type { Category } from "@/lib/types";

const stripePromise = getStripe();
const CARD_STYLE = { style: { base: { fontSize: "16px", color: "#1e293b", "::placeholder": { color: "#94a3b8" } }, invalid: { color: "#dc2626" } } };

export default function ProviderOnboarding() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const modal = useModal();
  const qc = useQueryClient();
  const [rates, setRates] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  useEffect(() => { document.title = "Set your rates — Tasker"; }, []);

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });
  const { data: me } = useQuery({
    queryKey: ["provider-me"],
    queryFn: () => api<any>("/providers/me"),
    enabled: !!user && user.role === "PROVIDER",
  });
  const { data: connect } = useQuery({
    queryKey: ["connect-status"],
    queryFn: () => api<{ connected: boolean; payoutsEnabled: boolean }>("/providers/me/connect/status"),
    enabled: !!user && user.role === "PROVIDER",
  });

  const startPayouts = async () => {
    setPayBusy(true);
    try {
      const { url } = await api<{ url: string }>("/providers/me/connect/onboard", { method: "POST" });
      window.location.href = url;
    } catch (e: any) {
      setPayBusy(false);
      await modal.alert("Payouts setup unavailable", e?.message || "Stripe Connect must be enabled on the platform account first.");
    }
  };


  useEffect(() => {
    if (me?.categoryRates) {
      const r: Record<string, number> = {};
      for (const cr of me.categoryRates) r[cr.categoryId] = cr.hourlyRateCents / 100;
      setRates(r);
    }
  }, [me]);

  if (!loading && (!user || user.role !== "PROVIDER")) {
    navigate("/provider/login");
    return null;
  }

  const setRate = (id: string, dollars: number) => setRates((p) => ({ ...p, [id]: dollars }));

  const save = async () => {
    setBusy(true);
    const payload = Object.entries(rates)
      .filter(([, v]) => v > 0)
      .map(([categoryId, v]) => ({ categoryId, hourlyRateCents: Math.round(v * 100) }));
    try {
      await api("/providers/me/rates", { method: "PUT", body: { rates: payload } });
      await modal.alert("Rates saved", me?.status === "ACTIVE" ? "You're all set — head to your dashboard." : "Your account is pending admin approval. You'll be notified when activated.");
      navigate("/provider");
    } catch (e: any) {
      setBusy(false);
      await modal.alert("Couldn't save", e?.message);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-8 pb-12">
        <Link to="/provider" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Set your rates</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your hourly rate per category. Estimates use the average rate of active pros, so this directly affects pricing.</p>

        {me && (
          <div className={`mt-5 flex items-center gap-2 rounded-2xl border p-3 text-sm ${me.status === "ACTIVE" ? "border-primary/30 bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground"}`}>
            {me.status === "ACTIVE" ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            {me.status === "ACTIVE" ? "Account active" : "Pending admin approval"}
          </div>
        )}

        {/* Payouts (Stripe Connect) + refundable deposit */}
        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <Landmark className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="font-semibold">Payouts</div>
                <div className="text-xs text-muted-foreground">
                  {connect?.payoutsEnabled ? "Bank connected — weekly payouts on" : "Connect a bank to get paid"}
                </div>
              </div>
            </div>
            {connect?.payoutsEnabled ? (
              <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">Enabled</span>
            ) : (
              <button disabled={payBusy} onClick={startPayouts}
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">
                Set up
              </button>
            )}
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="font-semibold">$50 deposit</div>
                <div className="text-xs text-muted-foreground">Refundable · held against policy violations</div>
              </div>
            </div>
            {me?.depositStatus === "CAPTURED" ? (
              <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">On file</span>
            ) : (
              <button onClick={() => setDepositOpen(true)}
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">
                Pay deposit
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.intakeConfig?.addressMode === "pickup_dropoff" ? "Pickup + drop-off" : "On-site"}</div>
              </div>
              <div className="relative w-32">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <input
                  type="number" min={0} step="1"
                  value={rates[c.id] ?? ""}
                  onChange={(e) => setRate(c.id, parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="h-11 w-full rounded-xl border border-border bg-background pl-7 pr-9 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">/hr</span>
              </div>
            </div>
          ))}
        </div>

        <button disabled={busy} onClick={save}
          className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 disabled:opacity-60">
          {busy ? "Saving…" : "Save rates"}
        </button>
      </div>

      <Elements stripe={stripePromise}>
        <DepositModal
          open={depositOpen}
          onClose={() => setDepositOpen(false)}
          onDone={() => { qc.invalidateQueries({ queryKey: ["provider-me"] }); setDepositOpen(false); }}
        />
      </Elements>
    </main>
  );
}

function DepositModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const modal = useModal();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      const card = elements.getElement(CardElement)!;
      const { paymentMethod, error } = await stripe.createPaymentMethod({ type: "card", card });
      if (error) {
        setBusy(false);
        await modal.alert("Card error", error.message || "Please check your card details.");
        return;
      }
      await api("/providers/me/deposit", { method: "POST", body: { paymentMethodId: paymentMethod.id } });
      await modal.alert("Deposit charged", "Your $50 refundable deposit was charged and is held until you leave in good standing.");
      onDone();
    } catch (e: any) {
      await modal.alert("Couldn't collect deposit", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-bold tracking-tight">Refundable $50 deposit</h2>
      <p className="mt-1 text-sm text-muted-foreground">Held against policy violations, refunded when you leave in good standing.</p>
      <div className="mt-4">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Card details</span>
        <div className="flex h-12 items-center rounded-xl border border-border bg-background px-4">
          <div className="w-full"><CardElement options={CARD_STYLE} onChange={(e) => setReady(e.complete)} /></div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Test mode — use card 4242 4242 4242 4242, any future date, any CVC.</p>
      </div>
      <div className="mt-5 flex gap-2">
        <button onClick={onClose} className="h-11 flex-1 rounded-2xl border border-border text-sm font-semibold">Cancel</button>
        <button disabled={!ready || busy || !stripe} onClick={submit}
          className="h-11 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? "Processing…" : "Pay $50 deposit"}
        </button>
      </div>
    </Modal>
  );
}
