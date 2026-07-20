import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IsOptional, IsString, MinLength } from "class-validator";
import { Role } from "@prisma/client";
import { OffPlatformService } from "./off-platform.service";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";

class ReportOffPlatformDto {
  @IsString() @MinLength(2) description!: string;
  @IsOptional() @IsString() evidenceUrl?: string;
}

@Controller()
export class OffPlatformController {
  constructor(private offPlatform: OffPlatformService) {}

  // Either party on a job reports the other for an off-platform payment attempt.
  @Post("jobs/:id/report-off-platform")
  report(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: ReportOffPlatformDto) {
    return this.offPlatform.report(id, user, dto.description, dto.evidenceUrl);
  }

  @Get("off-platform-reports/mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.offPlatform.mine(user.id);
  }

  @Roles(Role.ADMIN)
  @Get("admin/off-platform-reports")
  queue() {
    return this.offPlatform.queue();
  }

  @Roles(Role.ADMIN)
  @Post("admin/off-platform-reports/:id/verify")
  verify(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.offPlatform.verify(id, user.id);
  }

  @Roles(Role.ADMIN)
  @Post("admin/off-platform-reports/:id/dismiss")
  dismiss(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.offPlatform.dismiss(id, user.id);
  }
}
