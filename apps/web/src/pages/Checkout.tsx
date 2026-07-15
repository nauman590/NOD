import { useNavigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { ArrowLeft, Lock, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import { getStripe } from "@/lib/stripe";
import { useAuth } from "@/lib/auth";
import { useModal } from "@/components/ui/Modal";
import type { EstimateResult, Job } from "@/lib/types";
import { dollars } from "@/lib/types";

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

export default function Checkout() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);

  useEffect(() => {
    document.title = "Checkout — Tasker";
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

  if (!draft || !estimate) return null;

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
            <span className="text-3xl font-bold tracking-tight">{dollars(estimate.basePriceCents)}</span>
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Price locked · secure checkout
          </div>
        </section>

        <Elements stripe={stripePromise}>
          <PaymentForm draft={draft} estimate={estimate} addressText={addressText} />
        </Elements>
      </div>
    </main>
  );
}

function PaymentForm({ draft, estimate, addressText }: { draft: TaskDraft; estimate: EstimateResult; addressText: string }) {
  const navigate = useNavigate();
  const stripe = useStripe();
  const elements = useElements();
  const { user, registerCustomer, login } = useAuth();
  const modal = useModal();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cardReady, setCardReady] = useState(false);
  const [paying, setPaying] = useState(false);

  // A real (non-guest) customer can pay straight away; otherwise an account is required.
  const signedInCustomer = !!user && user.role === "CUSTOMER" && !user.isGuest;
  const needAccount = !signedInCustomer;

  const total = estimate.basePriceCents;
  const accountReady = !needAccount || (/.+@.+\..+/.test(email) && password.length >= 6);
  const valid = name.trim().length > 1 && cardReady && !!stripe && accountReady;

  // Ensure there's a logged-in real customer: create the account, or log in if the email exists.
  const ensureCustomer = async () => {
    if (signedInCustomer) return;
    try {
      await registerCustomer(email.trim(), password, name.trim());
    } catch (e: any) {
      if (e?.status === 409) {
        // Email already registered — sign them in instead.
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

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    try {
      // Create a PaymentMethod from the real card entered in the CardElement.
      const card = elements.getElement(CardElement)!;
      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: "card",
        card,
        billing_details: { name: name.trim() },
      });
      if (error) {
        setPaying(false);
        await modal.alert("Card error", error.message || "Please check your card details.");
        return;
      }

      await ensureCustomer();
      const job = await api<Job>("/jobs", {
        method: "POST",
        body: { estimateId: estimate.estimateId, serviceAddress: addressText, paymentMethodId: paymentMethod.id },
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
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Password (min 6 chars)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password"
                className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" />
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
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="h-12 w-full rounded-xl border border-border bg-card px-4 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Card details</span>
            <div className="flex h-12 items-center rounded-xl border border-border bg-card px-4">
              <div className="w-full">
                <CardElement options={CARD_STYLE} onChange={(e) => setCardReady(e.complete)} />
              </div>
            </div>
          </label>
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
            {paying ? "Processing…" : `Pay now · ${dollars(total)}`}
          </button>
        </div>
      </div>
    </>
  );
}
