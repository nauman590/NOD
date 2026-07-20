import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe = require("stripe");

// Wraps the Stripe SDK. When no secret key is configured, `enabled` is false and
// callers fall back to the simulated ledger so the app still runs without keys.
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe.Stripe | null;
  private readonly webhookSecret: string;
  // Whether to request the Stripe `tax_reporting_us_1099_k` capability on new Connect
  // accounts (enables Stripe-hosted year-end 1099-K generation). Defaults on; set
  // STRIPE_1099K_ENABLED="false" to opt out.
  private readonly taxReporting1099kEnabled: boolean;

  constructor(private config: ConfigService) {
    const key = (config.get<string>("STRIPE_SECRET_KEY") || "").trim();
    this.webhookSecret = (config.get<string>("STRIPE_WEBHOOK_SECRET") || "").trim();
    this.taxReporting1099kEnabled = (config.get<string>("STRIPE_1099K_ENABLED") || "true").trim().toLowerCase() !== "false";
    this.client = key ? new Stripe(key) : null;
    if (!this.client) this.logger.warn("STRIPE_SECRET_KEY not set — payments are simulated.");
    else this.logger.log(`Stripe enabled (live SDK). 1099-K reporting ${this.taxReporting1099kEnabled ? "on" : "off"}.`);
  }

  get taxReporting1099kOn() {
    return this.taxReporting1099kEnabled;
  }

  get enabled() {
    return !!this.client;
  }

  // An idempotency key makes a mutating Stripe call safe to retry: Stripe returns the
  // original result instead of creating a duplicate charge/transfer/refund.
  private idem(key?: string) {
    return key ? { idempotencyKey: key } : undefined;
  }

  // Authorize (manual capture) — money is held, not captured.
  // Test mode: confirm with the provided payment method or the Stripe test card.
  // When a real card + Customer are supplied, `setup_future_usage: off_session` saves
  // the card on the Customer so later charges (add-ons, cancellation/dispute fees) can
  // bill it off-session. The saved card is `pi.payment_method` after confirmation.
  async authorize(
    amountCents: number,
    metadata: Record<string, string>,
    paymentMethodId?: string,
    idempotencyKey?: string,
    customerId?: string,
  ) {
    if (!this.client) return null;
    // Only save the card when it's a real, customer-owned payment method — never the
    // shared `pm_card_visa` test token (which can't be attached/reused).
    const saveCard = !!(customerId && paymentMethodId);
    const pi = await this.client.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        capture_method: "manual",
        confirm: true,
        payment_method: paymentMethodId || "pm_card_visa",
        ...(customerId ? { customer: customerId } : {}),
        ...(saveCard ? { setup_future_usage: "off_session" as const } : {}),
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata,
      },
      this.idem(idempotencyKey),
    );
    return pi;
  }

  async capture(paymentIntentId: string) {
    if (!this.client) return null;
    return this.client.paymentIntents.capture(paymentIntentId);
  }

  // Immediate charge (used for approved add-ons).
  async charge(amountCents: number, metadata: Record<string, string>, paymentMethodId?: string, idempotencyKey?: string) {
    if (!this.client) return null;
    return this.client.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        confirm: true,
        payment_method: paymentMethodId || "pm_card_visa",
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata,
      },
      this.idem(idempotencyKey),
    );
  }

  async refund(paymentIntentId: string, amountCents?: number, idempotencyKey?: string) {
    if (!this.client) return null;
    return this.client.refunds.create(
      {
        payment_intent: paymentIntentId,
        ...(amountCents ? { amount: amountCents } : {}),
      },
      this.idem(idempotencyKey),
    );
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

  // The platform's Stripe country (cached). Connected Express accounts inherit it, and
  // `tax_reporting_us_1099_k` is only requestable for US accounts. `undefined` = not yet
  // fetched; `null` = fetch failed / unknown.
  private platformCountry: string | null | undefined = undefined;
  private async getPlatformCountry(): Promise<string | null> {
    if (!this.client) return null;
    if (this.platformCountry !== undefined) return this.platformCountry;
    try {
      const platform = await this.client.accounts.retrieveCurrent();
      this.platformCountry = platform.country ?? null;
    } catch (e) {
      this.logger.warn(`Could not determine platform country: ${(e as Error).message}`);
      this.platformCountry = null;
    }
    return this.platformCountry;
  }

  // Create an Express connected account with a weekly automatic payout schedule
  // (satisfies the brief's "weekly automated payouts"). For US platforms we also request
  // the `tax_reporting_us_1099_k` capability so Stripe tracks the account's earnings and
  // auto-generates its year-end 1099-K (Stripe-hosted); gated by STRIPE_1099K_ENABLED.
  async createConnectAccount(email?: string | null) {
    if (!this.client) return null;
    // 1099-K is a US-only IRS form; requesting the capability on a non-US account errors,
    // so only request it when the platform (and thus the connected account) is US-based.
    const country = await this.getPlatformCountry();
    const request1099k = this.taxReporting1099kEnabled && country === "US";
    if (this.taxReporting1099kEnabled && !request1099k) {
      this.logger.warn(`1099-K enabled but platform country is ${country ?? "unknown"} (US-only) — skipping tax_reporting_us_1099_k.`);
    }
    return this.client.accounts.create({
      type: "express",
      ...(email ? { email } : {}),
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
        ...(request1099k ? { tax_reporting_us_1099_k: { requested: true } } : {}),
      },
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
      // "active" once Stripe has everything it needs to file this account's 1099-K.
      taxReporting1099k: a.capabilities?.tax_reporting_us_1099_k ?? "inactive",
    };
  }

  // Available balance on a connected account, split into instant-eligible and
  // standard buckets (used to drive the instant-payout UI). Amounts in USD cents.
  async connectBalance(accountId: string) {
    if (!this.client) return null;
    const b = await this.client.balance.retrieve({}, { stripeAccount: accountId });
    const sumUsd = (arr?: Array<{ amount: number; currency: string }>) =>
      (arr || []).filter((x) => x.currency === "usd").reduce((s, x) => s + x.amount, 0);
    return {
      instantAvailableCents: sumUsd(b.instant_available),
      availableCents: sumUsd(b.available),
      pendingCents: sumUsd(b.pending),
    };
  }

  // Instant payout: pushes funds from the connected account's Stripe balance to the
  // provider's debit card within minutes (method: "instant"), alongside the standard
  // weekly schedule. Runs on the connected account (stripeAccount).
  async createInstantPayout(accountId: string, amountCents: number, metadata: Record<string, string>, idempotencyKey?: string) {
    if (!this.client) return null;
    return this.client.payouts.create(
      { amount: amountCents, currency: "usd", method: "instant", metadata },
      { stripeAccount: accountId, ...(idempotencyKey ? { idempotencyKey } : {}) },
    );
  }

  // Transfer funds from the platform balance to a provider's connected account.
  async transfer(amountCents: number, destinationAccountId: string, metadata: Record<string, string>, idempotencyKey?: string) {
    if (!this.client) return null;
    return this.client.transfers.create(
      {
        amount: amountCents,
        currency: "usd",
        destination: destinationAccountId,
        metadata,
      },
      this.idem(idempotencyKey),
    );
  }

  // ---- Provider $50 deposit (SetupIntent saves a card on file) ----

  // A Stripe Customer is required for a card to be saved and reused off-session
  // (e.g. the deposit charge below, or future strike deductions).
  async createCustomer(email?: string | null, metadata?: Record<string, string>) {
    if (!this.client) return null;
    return this.client.customers.create({
      ...(email ? { email } : {}),
      ...(metadata ? { metadata } : {}),
    });
  }

  // Confirm a SetupIntent to save the provided card on the customer for later
  // off-session use (no charge). Returns the SetupIntent (its `payment_method` is the
  // now-saved card).
  async createDepositSetupIntent(
    metadata: Record<string, string>,
    paymentMethodId?: string,
    customerId?: string,
    idempotencyKey?: string,
  ) {
    if (!this.client) return null;
    return this.client.setupIntents.create(
      {
        confirm: true,
        ...(customerId ? { customer: customerId } : {}),
        payment_method: paymentMethodId || "pm_card_visa",
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        usage: "off_session",
        metadata,
      },
      this.idem(idempotencyKey),
    );
  }

  // Charge a saved card off-session (customer not present). Used to collect the $50
  // deposit immediately after the SetupIntent saves the card.
  async chargeSavedCard(
    amountCents: number,
    customerId: string,
    paymentMethodId: string,
    metadata: Record<string, string>,
    idempotencyKey?: string,
  ) {
    if (!this.client) return null;
    return this.client.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata,
      },
      this.idem(idempotencyKey),
    );
  }

  // ---- Webhooks ----
  // Verify a webhook payload's signature. When a signing secret is configured we use
  // Stripe's constructEvent; without one (local dev) we parse the JSON but flag it as
  // unverified so callers can decide how much to trust it.
  constructEvent(
    rawBody: Buffer | string,
    signature?: string,
  ): { event: { type: string; data: { object: any } }; verified: boolean } | null {
    if (!this.client) return null;
    // When a signing secret is configured we ALWAYS verify — fail closed. A missing
    // Stripe-Signature header must be rejected, not silently downgraded to "unverified"
    // (otherwise anyone who omits the header can forge events against this endpoint).
    if (this.webhookSecret) {
      if (!signature) throw new Error("Missing Stripe-Signature header");
      const event = this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
      return { event, verified: true };
    }
    // No signing secret configured — accept but mark unverified (dev only).
    const event = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
    this.logger.warn(`Webhook '${event.type}' accepted WITHOUT signature verification (STRIPE_WEBHOOK_SECRET not set).`);
    return { event, verified: false };
  }

  get webhookConfigured() {
    return !!this.webhookSecret;
  }
}
