import { Module } from "@nestjs/common";
import { ProvidersService } from "./providers.service";
import { ProvidersController } from "./providers.controller";
import { CheckrService } from "./checkr.service";
import { CheckrController } from "./checkr.controller";
import { PaymentsModule } from "../payments/payments.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [PaymentsModule, NotificationsModule],
  providers: [ProvidersService, CheckrService],
  controllers: [ProvidersController, CheckrController],
  exports: [ProvidersService, CheckrService],
})
export class ProvidersModule {}
