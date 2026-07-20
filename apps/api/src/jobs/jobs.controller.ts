import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JobsService } from "./jobs.service";
import { CreateJobDto, AddAdjustmentsDto, LocationDto } from "./dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";

@Controller("jobs")
export class JobsController {
  constructor(private jobs: JobsService) {}

  @Roles(Role.CUSTOMER)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobDto) {
    return this.jobs.createFromEstimate(dto, user.id);
  }

  @Roles(Role.CUSTOMER)
  @Get("mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.jobs.myJobs(user.id);
  }

  @Roles(Role.PROVIDER)
  @Get("available")
  available(@CurrentUser() user: AuthUser) {
    return this.jobs.availableFeed(user.id);
  }

  @Roles(Role.PROVIDER)
  @Get("active")
  active(@CurrentUser() user: AuthUser) {
    return this.jobs.providerActiveJobs(user.id);
  }

  @Roles(Role.PROVIDER)
  @Get("completed")
  completed(@CurrentUser() user: AuthUser) {
    return this.jobs.providerCompletedJobs(user.id);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.getJob(id, user);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/claim")
  claim(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.claim(id, user.id);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/en-route")
  enRoute(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.enRoute(id, user.id);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/arrived")
  arrived(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.arrived(id, user.id);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/start")
  start(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.start(id, user.id);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/complete")
  complete(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.complete(id, user.id);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/adjustments")
  addAdjustments(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AddAdjustmentsDto) {
    return this.jobs.addAdjustments(id, user.id, dto);
  }

  @Roles(Role.CUSTOMER)
  @Post(":id/adjustments/approve")
  approve(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.approveAdjustments(id, user.id);
  }

  @Roles(Role.CUSTOMER)
  @Post(":id/adjustments/decline")
  decline(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.declineAdjustments(id, user.id);
  }

  @Post(":id/cancel")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.cancel(id, user);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/no-show")
  noShow(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.reportNoShow(id, user.id);
  }

  // Customer reports that their assigned pro never showed (claim-and-no-show).
  @Roles(Role.CUSTOMER)
  @Post(":id/provider-no-show")
  providerNoShow(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.reportProviderNoShow(id, user.id);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/delay-notice")
  delayNotice(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.jobs.delayNotice(id, user.id);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/photos")
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: { kind: "BEFORE" | "AFTER"; url: string; lat?: number; lng?: number },
  ) {
    return this.jobs.addPhoto(id, user.id, body.kind, body.url, body.lat, body.lng);
  }

  @Roles(Role.PROVIDER)
  @Post(":id/location")
  location(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: LocationDto) {
    return this.jobs.updateLocation(id, user.id, dto.lat, dto.lng);
  }
}
