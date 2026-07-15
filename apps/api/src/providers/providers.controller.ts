import { Body, Controller, Get, Patch, Post, Put } from "@nestjs/common";
import { Role } from "@prisma/client";
import { ProvidersService } from "./providers.service";
import { SetRatesDto, UpdateProfileDto } from "./dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";

@Roles(Role.PROVIDER)
@Controller("providers")
export class ProvidersController {
  constructor(private providers: ProvidersService) {}

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.providers.me(user.id);
  }

  @Patch("me")
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.providers.updateProfile(user.id, dto);
  }

  @Get("me/rates")
  getRates(@CurrentUser() user: AuthUser) {
    return this.providers.getRates(user.id);
  }

  @Put("me/rates")
  setRates(@CurrentUser() user: AuthUser, @Body() dto: SetRatesDto) {
    return this.providers.setRates(user.id, dto);
  }

  @Get("me/earnings")
  earnings(@CurrentUser() user: AuthUser) {
    return this.providers.earnings(user.id);
  }

  @Post("me/connect/onboard")
  connectOnboard(@CurrentUser() user: AuthUser) {
    return this.providers.connectOnboard(user.id);
  }

  @Get("me/connect/status")
  connectStatus(@CurrentUser() user: AuthUser) {
    return this.providers.connectStatus(user.id);
  }

  @Post("me/deposit")
  collectDeposit(@CurrentUser() user: AuthUser, @Body() body: { paymentMethodId?: string }) {
    return this.providers.collectDeposit(user.id, body?.paymentMethodId);
  }
}
