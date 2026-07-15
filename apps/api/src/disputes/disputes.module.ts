import { Module } from "@nestjs/common";
import { DisputesService } from "./disputes.service";
import { DisputesController } from "./disputes.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentsModule } from "../payments/payments.module";

@Module({
  imports: [NotificationsModule, PaymentsModule],
  providers: [DisputesService],
  controllers: [DisputesController],
})
export class DisputesModule {}
