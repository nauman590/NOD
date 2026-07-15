import { Module } from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { JobsController } from "./jobs.controller";
import { ProvidersModule } from "../providers/providers.module";
import { PaymentsModule } from "../payments/payments.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { StrikesModule } from "../strikes/strikes.module";

@Module({
  imports: [ProvidersModule, PaymentsModule, NotificationsModule, RealtimeModule, StrikesModule],
  providers: [JobsService],
  controllers: [JobsController],
  exports: [JobsService],
})
export class JobsModule {}
