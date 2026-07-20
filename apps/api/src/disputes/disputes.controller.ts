import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";
import { DisputeStatus, Role } from "@prisma/client";
import { DisputesService } from "./disputes.service";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";

class OpenDisputeDto {
  @IsString() @MinLength(2) reason!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) photoUrls?: string[];
}

class AddDisputePhotoDto {
  @IsString() url!: string;
}

class ResolveDisputeDto {
  @IsIn(["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"]) status!: DisputeStatus;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsInt() @Min(0) refundCents?: number;
  @IsOptional() @IsInt() @Min(0) additionalChargeCents?: number;
}

@Controller()
export class DisputesController {
  constructor(private disputes: DisputesService) {}

  @Post("jobs/:id/disputes")
  open(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: OpenDisputeDto) {
    return this.disputes.open(id, user, dto.reason, dto.description, dto.photoUrls);
  }

  // All disputes on a job (either party or admin) — with evidence photos.
  @Get("jobs/:id/disputes")
  listForJob(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.disputes.listForJob(id, user);
  }

  // Attach an evidence photo to an existing dispute.
  @Post("disputes/:id/photos")
  addPhoto(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AddDisputePhotoDto) {
    return this.disputes.addPhoto(id, user, dto.url);
  }

  @Get("disputes/mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.disputes.mine(user.id);
  }

  @Roles(Role.ADMIN)
  @Get("admin/disputes")
  queue() {
    return this.disputes.queue();
  }

  @Roles(Role.ADMIN)
  @Patch("admin/disputes/:id")
  resolve(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: ResolveDisputeDto) {
    return this.disputes.resolve(id, user.id, dto.status, dto.resolution, dto.refundCents, dto.additionalChargeCents);
  }
}
