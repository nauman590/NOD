import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";
import { DisputeStatus, Role } from "@prisma/client";
import { DisputesService } from "./disputes.service";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";

class OpenDisputeDto {
  @IsString() @MinLength(2) reason!: string;
  @IsOptional() @IsString() description?: string;
}

class ResolveDisputeDto {
  @IsIn(["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"]) status!: DisputeStatus;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsInt() @Min(0) refundCents?: number;
}

@Controller()
export class DisputesController {
  constructor(private disputes: DisputesService) {}

  @Post("jobs/:id/disputes")
  open(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: OpenDisputeDto) {
    return this.disputes.open(id, user, dto.reason, dto.description);
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
    return this.disputes.resolve(id, user.id, dto.status, dto.resolution, dto.refundCents);
  }
}
