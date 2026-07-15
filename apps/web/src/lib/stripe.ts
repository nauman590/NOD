import { loadStripe, Stripe } from "@stripe/stripe-js";
import { api } from "./api";

// Loads Stripe.js once using the publishable key served by the API.
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = api<{ publishableKey: string; enabled: boolean }>("/payments/config")
      .then((c) => (c.publishableKey ? loadStripe(c.publishableKey) : null))
      .catch(() => null);
  }
  return stripePromise;
}
