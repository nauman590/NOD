import { IsString, IsOptional, IsInt, IsNumber, IsObject, IsBoolean, Min } from "class-validator";

export class CreateCategoryDto {
  @IsString() slug!: string;
  @IsString() name!: string;
  @IsString() promptTemplate!: string;
  @IsObject() intakeConfig!: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsInt() @Min(0) baseFeeCents?: number;
  @IsOptional() @IsInt() @Min(0) disposalFeeCents?: number;
  @IsOptional() @IsInt() @Min(0) perMileFeeCents?: number;
  @IsOptional() @IsInt() @Min(0) fallbackHourlyRateCents?: number;
  @IsOptional() @IsNumber() minHours?: number;
  @IsOptional() @IsNumber() maxHours?: number;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() promptTemplate?: string;
  @IsOptional() @IsObject() intakeConfig?: Record<string, unknown>;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsInt() @Min(0) baseFeeCents?: number;
  @IsOptional() @IsInt() @Min(0) disposalFeeCents?: number;
  @IsOptional() @IsInt() @Min(0) perMileFeeCents?: number;
  @IsOptional() @IsInt() @Min(0) fallbackHourlyRateCents?: number;
  @IsOptional() @IsNumber() minHours?: number;
  @IsOptional() @IsNumber() maxHours?: number;
}
