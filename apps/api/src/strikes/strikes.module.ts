import { Module } from "@nestjs/common";
import { StrikesService } from "./strikes.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  providers: [StrikesService],
  exports: [StrikesService],
})
export class StrikesModule {}
