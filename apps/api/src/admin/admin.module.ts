import { Module } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentsModule } from "../payments/payments.module";
import { StrikesModule } from "../strikes/strikes.module";
import { ProvidersModule } from "../providers/providers.module";
import { JobsModule } from "../jobs/jobs.module";
import { RatingsModule } from "../ratings/ratings.module";
import { MapsModule } from "../maps/maps.module";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [
    NotificationsModule,
    PaymentsModule,
    StrikesModule,
    ProvidersModule,
    JobsModule,
    RatingsModule,
    MapsModule,
    AiModule,
  ],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
