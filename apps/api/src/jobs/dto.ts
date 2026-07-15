import { Type } from "class-transformer";
import { IsArray, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from "class-validator";

export class CreateJobDto {
  @IsString() estimateId!: string;
  @IsOptional() @IsString() serviceAddress?: string;
  @IsOptional() @IsString() paymentMethodId?: string;
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
