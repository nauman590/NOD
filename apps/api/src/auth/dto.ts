import { IsEmail, IsOptional, IsString, MinLength, IsBoolean } from "class-validator";

export class RegisterCustomerDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsBoolean() isGuest?: boolean;
}

export class RegisterProviderDto {
  @IsEmail() email!: string;
  @IsString() phone!: string;
  @IsString() @MinLength(6) password!: string;
  @IsString() fullName!: string;
  @IsOptional() @IsString() vehicleType?: string;
  @IsOptional() @IsString() licenseUrl?: string;
  @IsOptional() @IsString() profilePhotoUrl?: string;
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
}

export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(6) newPassword!: string;
}
