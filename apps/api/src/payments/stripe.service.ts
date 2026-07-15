import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe = require("stripe");

// Wraps the Stripe SDK. When no secret key is configured, `enabled` is false and
// callers fall back to the simulated ledger so the app still runs without keys.
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe.Stripe | null;

  constructor(private config: ConfigService) {
    const key = (config.get<string>("STRIPE_SECRET_KEY") || "").trim();
    this.client = key ? new Stripe(key) : null;
    if (!this.client) this.logger.warn("STRIPE_SECRET_KEY not set — payments are simulated.");
  }

  get enabled() {
    return !!this.client;
  }

  // Authorize (manual capture) — money is held, not captured.
  // Test mode: confirm with the provided payment method or the Stripe test card.
  async authorize(amountCents: number, metadata: Record<string, string>, paymentMethodId?: string) {
    if (!this.client) return null;
    const pi = await this.client.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      capture_method: "manual",
      confirm: true,
      payment_method: paymentMethodId || "pm_card_visa",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata,
    });
    return pi;
  }

  async capture(paymentIntentId: string) {
    if (!this.client) return null;
    return this.client.paymentIntents.capture(paymentIntentId);
  }

  // Immediate charge (used for approved add-ons).
  async charge(amountCents: number, metadata: Record<string, string>, paymentMethodId?: string) {
    if (!this.client) return null;
    return this.client.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      confirm: true,
      payment_method: paymentMethodId || "pm_card_visa",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata,
    });
  }

  async refund(paymentIntentId: string, amountCents?: number) {
    if (!this.client) return null;
    return this.client.refunds.create({
      payment_intent: paymentIntentId,
      ...(amountCents ? { amount: amountCents } : {}),
    });
  }

  async retrieve(paymentIntentId: string) {
    if (!this.client) return null;
    return this.client.paymentIntents.retrieve(paymentIntentId);
  }

  async cancelPaymentIntent(paymentIntentId: string) {
    if (!this.client) return null;
    return this.client.paymentIntents.cancel(paymentIntentId);
  }

  // ---- Connect Express (provider payouts) ----

  // Create an Express connected account with a weekly automatic payout schedule
  // (satisfies the brief's "weekly automated payouts").
  async createConnectAccount(email?: string | null) {
    if (!this.client) return null;
    return this.client.accounts.create({
      type: "express",
      ...(email ? { email } : {}),
      capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
      settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "friday" } } },
    });
  }

  async createAccountLink(accountId: string, refreshUrl: string, returnUrl: string) {
    if (!this.client) return null;
    return this.client.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
  }

  async accountStatus(accountId: string) {
    if (!this.client) return null;
    const a = await this.client.accounts.retrieve(accountId);
    return {
      chargesEnabled: a.charges_enabled,
      payoutsEnabled: a.payouts_enabled,
      detailsSubmitted: a.details_submitted,
    };
  }

  // Transfer funds from the platform balance to a provider's connected account.
  async transfer(amountCents: number, destinationAccountId: string, metadata: Record<string, string>) {
    if (!this.client) return null;
    return this.client.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination: destinationAccountId,
      metadata,
    });
  }

  // ---- Provider $50 deposit (SetupIntent saves a card on file) ----
  async createDepositSetupIntent(metadata: Record<string, string>, paymentMethodId?: string) {
    if (!this.client) return null;
    return this.client.setupIntents.create({
      confirm: true,
      payment_method: paymentMethodId || "pm_card_visa",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      usage: "off_session",
      metadata,
    });
  }
}
