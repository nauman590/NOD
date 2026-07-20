import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard, RolesGuard } from "./auth/guards";
import { CategoriesModule } from "./categories/categories.module";
import { ProvidersModule } from "./providers/providers.module";
import { EstimateModule } from "./estimate/estimate.module";
import { JobsModule } from "./jobs/jobs.module";
import { PaymentsModule } from "./payments/payments.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { RatingsModule } from "./ratings/ratings.module";
import { AdminModule } from "./admin/admin.module";
import { DisputesModule } from "./disputes/disputes.module";
import { OffPlatformModule } from "./off-platform/off-platform.module";
import { UploadsModule } from "./uploads/uploads.module";
import { MapsModule } from "./maps/maps.module";
import { MessagesModule } from "./messages/messages.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UploadsModule,
    MapsModule,
    MessagesModule,
    CategoriesModule,
    ProvidersModule,
    EstimateModule,
    JobsModule,
    PaymentsModule,
    NotificationsModule,
    RealtimeModule,
    RatingsModule,
    AdminModule,
    DisputesModule,
    OffPlatformModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
