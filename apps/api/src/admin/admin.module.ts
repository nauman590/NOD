import { Module } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentsModule } from "../payments/payments.module";
import { StrikesModule } from "../strikes/strikes.module";
import { ProvidersModule } from "../providers/providers.module";

@Module({
  imports: [NotificationsModule, PaymentsModule, StrikesModule, ProvidersModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
