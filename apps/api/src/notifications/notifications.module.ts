import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { SmsService } from "./sms.service";
import { RealtimeModule } from "../realtime/realtime.module";

@Module({
  imports: [RealtimeModule],
  providers: [NotificationsService, SmsService],
  controllers: [NotificationsController],
  exports: [NotificationsService, SmsService],
})
export class NotificationsModule {}
