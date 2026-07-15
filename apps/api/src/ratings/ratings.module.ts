import { Module } from "@nestjs/common";
import { RatingsService } from "./ratings.service";
import { RatingsController } from "./ratings.controller";
import { StrikesModule } from "../strikes/strikes.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [StrikesModule, NotificationsModule],
  providers: [RatingsService],
  controllers: [RatingsController],
})
export class RatingsModule {}
