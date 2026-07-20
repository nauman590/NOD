import { Controller, Post, Req } from "@nestjs/common";
import { CheckrService } from "./checkr.service";
import { Public } from "../common/decorators";

// The Checkr webhook lives outside the provider-scoped ProvidersController so it can be
// Public (Checkr posts here unauthenticated; signature-verified when a secret is set).
// The admin-initiate route is on AdminController → AdminService → CheckrService.
@Controller()
export class CheckrController {
  constructor(private checkr: CheckrService) {}

  @Public()
  @Post("webhooks/checkr")
  webhook(@Req() req: any) {
    return this.checkr.handleWebhook(req.rawBody, req.headers["x-checkr-signature"]);
  }
}
