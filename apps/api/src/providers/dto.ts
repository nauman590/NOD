import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class UpdateProfileDto {
  @IsOptional() @IsString() vehicleType?: string;
  @IsOptional() @IsString() licenseUrl?: string;
  @IsOptional() @IsString() profilePhotoUrl?: string;
  @IsOptional() @IsString() bio?: string;
}

export class RateItemDto {
  @IsString() categoryId!: string;
  @IsInt() @Min(0) hourlyRateCents!: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class SetRatesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => RateItemDto) rates!: RateItemDto[];
}
