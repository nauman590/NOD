import { IsEmail, IsOptional, IsString, MinLength, IsBoolean, IsNotEmpty } from "class-validator";

export class RegisterCustomerDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsBoolean() isGuest?: boolean;
  // SMS opt-in (brief: defaults to checked). Undefined → true.
  @IsOptional() @IsBoolean() smsOptIn?: boolean;
}

export class RegisterProviderDto {
  @IsEmail() email!: string;
  @IsString() phone!: string;
  @IsString() @MinLength(6) password!: string;
  @IsString() fullName!: string;
  @IsOptional() @IsString() vehicleType?: string;
  // Brief: driver's license + profile photo are REQUIRED provider signup fields.
  @IsString() @IsNotEmpty() licenseUrl!: string;
  @IsString() @IsNotEmpty() profilePhotoUrl!: string;
  @IsOptional() @IsBoolean() smsOptIn?: boolean;
}

export class RequestOtpDto {
  // Optionally set/replace the phone number being verified.
  @IsOptional() @IsString() phone?: string;
}

export class VerifyOtpDto {
  @IsString() @MinLength(4) code!: string;
}

export class LoginDto {
  @IsString() emailOrPhone!: string;
  @IsString() password!: string;
}

export class RefreshDto {
  @IsString() refreshToken!: string;
}

export class UpdateAccountDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() profilePhotoUrl?: string;
  @IsOptional() @IsBoolean() smsOptIn?: boolean;
}

export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(6) newPassword!: string;
}

export class ForgotPasswordDto {
  @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @IsString() token!: string;
  @IsString() @MinLength(6) newPassword!: string;
}
