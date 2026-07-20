import { Module } from "@nestjs/common";
import { OffPlatformService } from "./off-platform.service";
import { OffPlatformController } from "./off-platform.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";

@Module({
  imports: [NotificationsModule, RealtimeModule],
  providers: [OffPlatformService],
  controllers: [OffPlatformController],
})
export class OffPlatformModule {}
