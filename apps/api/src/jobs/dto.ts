import { Type } from "class-transformer";
import { IsArray, IsNumber, IsOptional, IsString, Min, MinLength, MaxLength, ValidateNested } from "class-validator";

export class CreateJobDto {
  @IsString() estimateId!: string;
  @IsOptional() @IsString() serviceAddress?: string;
  @IsOptional() @IsString() paymentMethodId?: string;
}

export class CancelJobDto {
  // Optional free-text reason captured at cancel (brief B8). Capped to keep it a note.
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class AdjustmentItemDto {
  @IsString() @MinLength(1) description!: string;
  @IsNumber() @Min(1) priceCents!: number;
}

export class AddAdjustmentsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AdjustmentItemDto) items!: AdjustmentItemDto[];
}

export class LocationDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}
