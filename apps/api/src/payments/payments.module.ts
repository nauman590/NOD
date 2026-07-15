import { Module } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { StripeService } from "./stripe.service";
import { PaymentsController } from "./payments.controller";
import { StrikesModule } from "../strikes/strikes.module";

@Module({
  imports: [StrikesModule],
  providers: [PaymentsService, StripeService],
  controllers: [PaymentsController],
  exports: [PaymentsService, StripeService],
})
export class PaymentsModule {}
