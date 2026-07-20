import { useNavigate, Link } from "react-router-dom";
import { useEffect, useState, ReactNode } from "react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { ArrowLeft, Lock, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import { getStripe } from "@/lib/stripe";
import { useAuth } from "@/lib/auth";
import { useModal } from "@/components/ui/Modal";
import type { EstimateResult, Job } from "@/lib/types";
import { dollars2 } from "@/lib/types";

interface TaskDraft {
  photoUrl: string | null;
  categorySlug: string;
  categoryName: string;
  details: string;
  addressMode: "single" | "pickup_dropoff";
  serviceAddress: string;
  pickupAddress: string;
  dropoffAddress: string;
}

const stripePromise = getStripe();

const CARD_STYLE = {
  style: {
    base: { fontSize: "16px", color: "#1e293b", "::placeholder": { color: "#94a3b8" } },
    invalid: { color: "#dc2626" },
  },
};

const INPUT_CLASS =
  "h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";

export default function Checkout() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  // Whether the server has real Stripe keys. When false we run a simulated checkout
  // (no Stripe.js) so the demo flow still works end-to-end against the ledger.
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    document.title = "Checkout — Tasker";
  }, []);

  useEffect(() => {
    api<{ enabled: boolean }>("/payments/config")
      .then((c) => setStripeEnabled(!!c.enabled))
      .catch(() => setStripeEnabled(false));
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("taskDraft");
      const eid = sessionStorage.getItem("estimateId");
      if (!raw || !eid) {
        navigate("/");
        return;
      }
      setDraft(JSON.parse(raw) as TaskDraft);
      api<EstimateResult>(`/estimate/${eid}`).then((e: any) => setEstimate({ ...e, estimateId: e.id })).catch(() => navigate("/"));
    } catch {
      navigate("/");
    }
  }, [navigate]);

  if (!draft || !estimate || stripeEnabled === null) return null;

  const addressText =
    draft.addressMode === "pickup_dropoff"
      ? `Pickup: ${draft.pickupAddress} → Drop-off: ${draft.dropoffAddress}`
      : draft.serviceAddress;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-36">
        <Link to="/estimate" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <h1 className="mt-5 text-3xl font-bold tracking-tight">Checkout</h1>

        <section className="mt-6 rounded-3xl border border-border bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Order summary</div>
          <div className="mt-3 flex items-start gap-3">
            {draft.photoUrl ? (
              <img src={draft.photoUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
            ) : (
              <div className="h-16 w-16 rounded-xl bg-secondary" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">{draft.categoryName}</div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{draft.details}</p>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-1.5 border-t border-border pt-4 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {addressText}
          </div>
          <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-3xl font-bold tracking-tight">{dollars2(estimate.basePriceCents)}</span>
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Price locked · secure checkout
          </div>
        </section>

        {stripeEnabled ? (
          <Elements stripe={stripePromise}>
            <StripePaymentForm estimate={estimate} addressText={addressText} />
          </Elements>
        ) : (
          <SimulatedPaymentForm estimate={estimate} addressText={addressText} />
        )}
      </div>
    </main>
  );
}

// Shared account creation + job booking. `getPaymentMethodId` differs per mode
// (real Stripe PaymentMethod id, or undefined for the simulated ledger).
function useCheckout(estimate: EstimateResult, addressText: string) {
  const navigate = useNavigate();
  const { user, registerCustomer, login } = useAuth();
  const modal = useModal();
  const [paying, setPaying] = useState(false);

  const signedInCustomer = !!user && user.role === "CUSTOMER" && !user.isGuest;

  const ensureCustomer = async (email: string, password: string, name: string) => {
    if (signedInCustomer) return;
    try {
      await registerCustomer(email.trim(), password, name.trim());
    } catch (e: any) {
      if (e?.status === 409) {
        try {
          await login(email.trim(), password);
        } catch {
          throw new Error("That email is already registered. Check your password, or use Log in.");
        }
      } else {
        throw e;
      }
    }
  };

  const book = async (opts: { email: string; password: string; name: string; paymentMethodId?: string }) => {
    setPaying(true);
    try {
      await ensureCustomer(opts.email, opts.password, opts.name);
      const job = await api<Job>("/jobs", {
        method: "POST",
        body: { estimateId: estimate.estimateId, serviceAddress: addressText, paymentMethodId: opts.paymentMethodId },
      });
      sessionStorage.removeItem("taskDraft");
      sessionStorage.removeItem("estimateId");
      await modal.alert("Payment successful", "A provider will claim your job shortly. You can track it live in My jobs.");
      navigate(`/job/${job.id}`);
    } catch (e: any) {
      setPaying(false);
      if (e?.status === 409) {
        await modal.alert("Price expired", "Your locked price expired. Please get a fresh estimate.");
        navigate("/");
      } else {
        await modal.alert("Couldn't complete", e?.message || "Please try again.");
      }
    }
  };

  return { user, signedInCustomer, paying, setPaying, book, modal };
}

// The account fields + name + card slot + pay bar. Card capture is injected so the
// same shell serves both the real-Stripe and simulated flows.
function PaymentShell({
  estimate,
  addressText,
  cardSlot,
  cardValid,
  getPaymentMethodId,
}: {
  estimate: EstimateResult;
  addressText: string;
  cardSlot: ReactNode;
  cardValid: boolean;
  getPaymentMethodId: (name: string) => Promise<string | undefined>;
}) {
  const { user, signedInCustomer, paying, setPaying, book, modal } = useCheckout(estimate, addressText);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const needAccount = !signedInCustomer;
  const total = estimate.basePriceCents;
  const accountReady = !needAccount || (/.+@.+\..+/.test(email) && password.length >= 6);
  const valid = name.trim().length > 1 && cardValid && accountReady;

  const handlePay = async () => {
    // Disable the button BEFORE the Stripe tokenization round-trip. Previously `paying` was
    // only set inside book() (after tokenization), so the button stayed enabled during that
    // window and a double-click created two jobs + two authorizations.
    if (paying) return;
    setPaying(true);
    let paymentMethodId: string | undefined;
    try {
      paymentMethodId = await getPaymentMethodId(name.trim());
    } catch (e: any) {
      setPaying(false);
      await modal.alert("Card error", e?.message || "Please check your card details.");
      return;
    }
    await book({ email, password, name, paymentMethodId });
  };

  return (
    <>
      {needAccount ? (
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your account</h2>
            <Link to="/login?redirect=/checkout" className="text-xs font-medium text-primary underline underline-offset-4">Log in</Link>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Create an account so you can track this job and review quotes anytime.</p>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={INPUT_CLASS} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Password (min 6 chars)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" className={INPUT_CLASS} />
            </label>
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Signed in as <span className="font-semibold text-foreground">{user?.email}</span>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Payment</h2>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Name on card</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className={INPUT_CLASS} />
          </label>
          {cardSlot}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Secure card entry by Stripe (test mode). Use card <span className="font-mono">4242 4242 4242 4242</span>, any
          future date, any CVC.
        </p>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-md">
          <button
            disabled={!valid || paying}
            onClick={handlePay}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            {paying ? "Processing…" : `Pay now · ${dollars2(total)}`}
          </button>
        </div>
      </div>
    </>
  );
}

// Real Stripe.js card capture (used when the server has Stripe keys).
function StripePaymentForm({ estimate, addressText }: { estimate: EstimateResult; addressText: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [cardReady, setCardReady] = useState(false);

  const getPaymentMethodId = async (name: string) => {
    if (!stripe || !elements) throw new Error("Payment is still loading. Please try again.");
    const card = elements.getElement(CardElement)!;
    const { paymentMethod, error } = await stripe.createPaymentMethod({ type: "card", card, billing_details: { name } });
    if (error) throw new Error(error.message || "Please check your card details.");
    return paymentMethod.id;
  };

  const cardSlot = (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Card details</span>
      <div className="flex h-12 items-center rounded-xl border border-border bg-card px-4">
        <div className="w-full">
          <CardElement options={CARD_STYLE} onChange={(e) => setCardReady(e.complete)} />
        </div>
      </div>
    </label>
  );

  return (
    <PaymentShell
      estimate={estimate}
      addressText={addressText}
      cardSlot={cardSlot}
      cardValid={cardReady && !!stripe}
      getPaymentMethodId={getPaymentMethodId}
    />
  );
}

// Simulated card capture (no Stripe keys). Accepts the test card; the backend
// records an AUTHORIZED base against the simulated ledger with no real charge.
function SimulatedPaymentForm({ estimate, addressText }: { estimate: EstimateResult; addressText: string }) {
  const [number, setNumber] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");

  const digits = number.replace(/\D/g, "");
  const cardValid = digits.length >= 15 && digits.length <= 16 && /^\d{2}\s*\/\s*\d{2}$/.test(exp.trim()) && /^\d{3,4}$/.test(cvc.trim());

  const formatNumber = (v: string) =>
    v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  const formatExp = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  };

  // Simulated mode never creates a real Stripe PaymentMethod.
  const getPaymentMethodId = async () => undefined;

  const cardSlot = (
    <>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Card number</span>
        <input
          inputMode="numeric"
          value={number}
          onChange={(e) => setNumber(formatNumber(e.target.value))}
          placeholder="4242 4242 4242 4242"
          className={`${INPUT_CLASS} font-mono`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Expiry (MM/YY)</span>
          <input
            inputMode="numeric"
            value={exp}
            onChange={(e) => setExp(formatExp(e.target.value))}
            placeholder="12/34"
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">CVC</span>
          <input
            inputMode="numeric"
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="123"
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>
      </div>
    </>
  );

  return (
    <PaymentShell
      estimate={estimate}
      addressText={addressText}
      cardSlot={cardSlot}
      cardValid={cardValid}
      getPaymentMethodId={getPaymentMethodId}
    />
  );
}
