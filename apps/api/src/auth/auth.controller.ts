import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { RegisterCustomerDto, RegisterProviderDto, LoginDto, RefreshDto, UpdateAccountDto, ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto, RequestOtpDto, VerifyOtpDto } from "./dto";
import { Public, CurrentUser, AuthUser } from "../common/decorators";

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post("register/customer")
  registerCustomer(@Body() dto: RegisterCustomerDto) {
    return this.auth.registerCustomer(dto);
  }

  @Public()
  @Post("register/provider")
  registerProvider(@Body() dto: RegisterProviderDto) {
    return this.auth.registerProvider(dto);
  }

  @Public()
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post("forgot-password")
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post("reset-password")
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @Post("logout")
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Patch("profile")
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateAccountDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  @Post("change-password")
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  // Phone verification (SMS OTP).
  @Post("phone/request-otp")
  requestOtp(@CurrentUser() user: AuthUser, @Body() dto: RequestOtpDto) {
    return this.auth.requestPhoneOtp(user.id, dto.phone);
  }

  @Post("phone/verify-otp")
  verifyOtp(@CurrentUser() user: AuthUser, @Body() dto: VerifyOtpDto) {
    return this.auth.verifyPhoneOtp(user.id, dto.code);
  }
}
