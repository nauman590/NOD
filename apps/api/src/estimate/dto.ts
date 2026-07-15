import { IsObject, IsOptional, IsString, IsNumber, MinLength } from "class-validator";

export class CreateEstimateDto {
  @IsString() categorySlug!: string;
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsObject() intakeData?: Record<string, unknown>;
  @IsOptional() @IsString() serviceAddress?: string;
  @IsOptional() @IsString() pickupAddress?: string;
  @IsOptional() @IsString() dropoffAddress?: string;
  @IsOptional() @IsNumber() distanceMiles?: number;
}
