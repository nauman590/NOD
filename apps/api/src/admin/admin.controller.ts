import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { ProviderStatus, Role } from "@prisma/client";
import { AdminService } from "./admin.service";
import { Roles } from "../common/decorators";

class AdjustRatingDto {
  @IsOptional() @IsInt() @Min(1) @Max(5) stars?: number;
  @IsOptional() @IsString() comment?: string;
}

class RefundDto {
  // Partial refund amount in cents; omit for a full refund. Must be a positive integer —
  // an unvalidated "abc"/negative previously reached Stripe as NaN → 500.
  @IsOptional() @IsInt() @Min(1) amountCents?: number;
}

class SuspendCustomerDto {
  @IsOptional() @IsString() reason?: string;
  // Days must be a positive integer — `days:-5` previously produced a past suspendedUntil
  // (a silent no-op), and "abc" a NaN date. Capped at 10 years.
  @IsOptional() @IsInt() @Min(1) @Max(3650) days?: number;
}

@Roles(Role.ADMIN)
@Controller("admin")
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get("metrics")
  metrics() {
    return this.admin.metrics();
  }

  // Detect providers who claimed a job and never showed (past the grace window).
  @Post("no-shows/sweep")
  detectNoShows() {
    return this.admin.detectNoShows();
  }

  @Get("analytics")
  analytics() {
    return this.admin.analytics();
  }

  @Post("payments/:id/refund")
  refund(@Param("id") id: string, @Body() body: RefundDto) {
    return this.admin.refundPayment(id, body?.amountCents);
  }

  @Post("providers/:id/deposit/refund")
  refundDeposit(@Param("id") id: string) {
    return this.admin.refundDeposit(id);
  }

  @Post("customers/:id/suspend")
  suspendCustomer(@Param("id") id: string, @Body() body: SuspendCustomerDto) {
    return this.admin.setCustomerSuspension(id, true, body?.reason, body?.days);
  }

  @Post("customers/:id/unsuspend")
  unsuspendCustomer(@Param("id") id: string) {
    return this.admin.setCustomerSuspension(id, false);
  }

  @Post("providers/:id/background")
  backgroundCheck(@Param("id") id: string, @Body() body: { result: "PASSED" | "FAILED" }) {
    return this.admin.setBackgroundCheck(id, body?.result === "FAILED" ? "FAILED" : "PASSED");
  }

  @Post("providers/:id/strikes")
  issueStrike(@Param("id") id: string, @Body() body: { reason?: string; feeCents?: number; note?: string }) {
    return this.admin.issueStrike(id, (body?.reason as any) || "OTHER", body?.feeCents, body?.note);
  }

  @Delete("strikes/:id")
  removeStrike(@Param("id") id: string) {
    return this.admin.removeStrike(id);
  }

  // ---- Manual rating adjustments ----
  @Get("users/:id/ratings")
  userRatings(@Param("id") id: string) {
    return this.admin.userRatings(id);
  }

  @Patch("ratings/:id")
  adjustRating(@Param("id") id: string, @Body() dto: AdjustRatingDto) {
    return this.admin.adjustRating(id, dto);
  }

  @Delete("ratings/:id")
  removeRating(@Param("id") id: string) {
    return this.admin.removeRating(id);
  }

  @Get("providers")
  providers(@Query("status") status?: ProviderStatus) {
    return this.admin.providers(status);
  }

  @Post("providers/:id/approve")
  approve(@Param("id") id: string) {
    return this.admin.approve(id);
  }

  @Post("providers/:id/reject")
  reject(@Param("id") id: string) {
    return this.admin.reject(id);
  }

  @Post("providers/:id/suspend")
  suspend(@Param("id") id: string) {
    return this.admin.suspend(id);
  }

  @Post("providers/:id/deactivate")
  deactivate(@Param("id") id: string) {
    return this.admin.deactivate(id);
  }

  // Generate a Stripe Connect onboarding link an admin can send to a recruited provider.
  @Post("providers/:id/connect-link")
  connectLink(@Param("id") id: string) {
    return this.admin.providerConnectLink(id);
  }

  // Kick off a Checkr background check for a provider (falls back to manual gate if unset).
  @Post("providers/:id/checkr/initiate")
  checkrInitiate(@Param("id") id: string) {
    return this.admin.checkrInitiate(id);
  }

  @Get("customers")
  customers() {
    return this.admin.customers();
  }

  @Get("jobs")
  jobs(@Query("status") status?: string) {
    return this.admin.jobs(status);
  }

  @Get("payments")
  payments() {
    return this.admin.payments();
  }
}
