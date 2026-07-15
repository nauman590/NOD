import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentsService } from "./payments.service";
import { StripeService } from "./stripe.service";
import { CurrentUser, AuthUser, Public } from "../common/decorators";

@Controller("payments")
export class PaymentsController {
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
    };
  }

  // Current user's payment ledger (customer charges or provider payouts).
  @Get("mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.payments.listForUser(user.id);
  }
}
