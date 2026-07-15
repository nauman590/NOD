import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ProviderStatus, Role } from "@prisma/client";
import { AdminService } from "./admin.service";
import { Roles } from "../common/decorators";

@Roles(Role.ADMIN)
@Controller("admin")
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get("metrics")
  metrics() {
    return this.admin.metrics();
  }

  @Get("analytics")
  analytics() {
    return this.admin.analytics();
  }

  @Post("payments/:id/refund")
  refund(@Param("id") id: string, @Body() body: { amountCents?: number }) {
    return this.admin.refundPayment(id, body?.amountCents);
  }

  @Post("providers/:id/deposit/refund")
  refundDeposit(@Param("id") id: string) {
    return this.admin.refundDeposit(id);
  }

  @Post("customers/:id/suspend")
  suspendCustomer(@Param("id") id: string, @Body() body: { reason?: string; days?: number }) {
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
