import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
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
    // Global per-IP rate limiting. Default 300 req/min bounds abuse without tripping normal
    // SPA usage; sensitive endpoints (login/OTP/reset) set tighter per-route limits via
    // @Throttle. skipIf disables all throttling when THROTTLE_DISABLED=true — used by the
    // E2E run, which hammers the API from a single IP.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: parseInt(process.env.THROTTLE_GLOBAL_LIMIT || "300", 10) }],
      skipIf: () => (process.env.THROTTLE_DISABLED || "").trim().toLowerCase() === "true",
    }),
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
    // Rate-limit FIRST, so brute-force against the (public) auth endpoints is capped before
    // any auth/role logic runs.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
