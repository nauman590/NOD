import { Controller, Get, Post, Req, BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentsService } from "./payments.service";
import { StripeService } from "./stripe.service";
import { CurrentUser, AuthUser, Public } from "../common/decorators";

@Controller("payments")
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private payments: PaymentsService,
    private stripe: StripeService,
    private configService: ConfigService,
  ) {}

  // Publishable key + mode for the frontend Stripe.js / PaymentElement.
  @Public()
  @Get("config")
  config() {
    return {
      publishableKey: this.configService.get<string>("STRIPE_PUBLISHABLE_KEY") || "",
      enabled: this.stripe.enabled,
      // Whether providers must fund the $50 deposit before they can claim jobs.
      depositRequired: (this.configService.get<string>("REQUIRE_DEPOSIT_TO_CLAIM") || "false").trim().toLowerCase() === "true",
    };
  }

  // Stripe webhook receiver. Verifies the signature against STRIPE_WEBHOOK_SECRET
  // (raw body is preserved via `rawBody: true` in main.ts) and reconciles payments.
  @Public()
  @Post("webhook")
  async webhook(@Req() req: any) {
    if (!this.stripe.enabled) return { ignored: true };
    const signature = req.headers["stripe-signature"] as string | undefined;
    const raw: Buffer | undefined = req.rawBody;
    if (!raw) throw new BadRequestException("missing raw body");
    let parsed;
    try {
      parsed = this.stripe.constructEvent(raw, signature);
    } catch (e) {
      this.logger.warn(`Webhook signature verification failed: ${(e as Error).message}`);
      throw new BadRequestException("invalid signature");
    }
    if (!parsed) return { ignored: true };
    // constructEvent returns verified:false only when STRIPE_WEBHOOK_SECRET is unset. An
    // unverified event can be forged by anyone who can reach this endpoint, and the handler
    // mutates payment state (CAPTURED / REFUNDED / FAILED) — never process one. In prod the
    // StripeService boot guard requires the secret, so this path can only occur in local dev.
    if (!parsed.verified) {
      this.logger.warn("Rejecting unverified Stripe webhook — STRIPE_WEBHOOK_SECRET is not configured.");
      throw new BadRequestException("webhook signature verification is not configured");
    }
    return this.payments.handleWebhook(parsed.event);
  }

  // Current user's payment ledger (customer charges or provider payouts).
  @Get("mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.payments.listForUser(user.id);
  }
}
