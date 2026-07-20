import { IsObject, IsOptional, IsString, IsNumber, MinLength, Min } from "class-validator";

export class CreateEstimateDto {
  @IsString() categorySlug!: string;
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsObject() intakeData?: Record<string, unknown>;
  @IsOptional() @IsString() serviceAddress?: string;
  @IsOptional() @IsString() pickupAddress?: string;
  @IsOptional() @IsString() dropoffAddress?: string;
  // Distance is a price input, so a negative value must never reach the estimator (it
  // would drive labor + mileage negative and collapse the base price). It's also only a
  // hint: when Maps is configured the server computes the authoritative distance itself.
  @IsOptional() @IsNumber() @Min(0) distanceMiles?: number;
}
