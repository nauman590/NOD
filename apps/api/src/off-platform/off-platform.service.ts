import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { OffPlatformReportStatus, ProviderStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RealtimeService } from "../realtime/realtime.service";
import { AuthUser } from "../common/decorators";

// Report → admin-verify → immediate ban flow for off-platform payment solicitation
// (Sprint 4, item 4). Distinct from the generic dispute/suspend helpers: a VERIFIED
// report bans the reported party outright.
const BAN_DAYS = 3650; // effectively permanent for a customer account

@Injectable()
export class OffPlatformService {
  private readonly logger = new Logger(OffPlatformService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private rt: RealtimeService,
  ) {}

  // A job counterparty (customer or provider) reports the OTHER party.
  async report(jobId: string, reporter: AuthUser, description: string, evidenceUrl?: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { provider: true } });
    if (!job) throw new NotFoundException("job not found");

    const isCustomer = job.customerId === reporter.id;
    const isProvider = job.provider?.userId === reporter.id;
    if (!isCustomer && !isProvider) throw new ForbiddenException("not your job");

    const reportedUserId = isCustomer ? job.provider?.userId : job.customerId;
    if (!reportedUserId) throw new BadRequestException("No counterparty is assigned to this job yet.");

    const report = await this.prisma.offPlatformReport.create({
      data: {
        jobId,
        reporterId: reporter.id,
        reportedUserId,
        description: description?.trim() || "Off-platform payment solicitation",
        evidenceUrl: evidenceUrl ?? null,
      },
    });
    this.rt.emit(this.rt.adminRoom(), "admin.metrics", { type: "off_platform.reported" });
    this.logger.warn(`Off-platform report ${report.id} filed by ${reporter.id} against ${reportedUserId} (job ${jobId})`);
    return report;
  }

  mine(userId: string) {
    return this.prisma.offPlatformReport.findMany({
      where: { reporterId: userId },
      orderBy: { createdAt: "desc" },
      include: { job: { include: { category: true } } },
    });
  }

  queue() {
    return this.prisma.offPlatformReport.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        job: { include: { category: true } },
        reporter: { select: { id: true, fullName: true, email: true, role: true } },
        reportedUser: { select: { id: true, fullName: true, email: true, role: true, suspendedUntil: true, provider: { select: { status: true } } } },
      },
    });
  }

  // Verify a report → immediately ban the reported user.
  async verify(reportId: string, adminId: string) {
    const report = await this.prisma.offPlatformReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException("report not found");
    if (report.status !== OffPlatformReportStatus.PENDING) throw new BadRequestException("This report has already been reviewed.");

    const ban = await this.banUser(report.reportedUserId);

    const updated = await this.prisma.offPlatformReport.update({
      where: { id: reportId },
      data: { status: OffPlatformReportStatus.VERIFIED, reviewedById: adminId, reviewedAt: new Date(), banApplied: true },
    });

    await this.notifications.notify({
      userId: report.reporterId,
      jobId: report.jobId ?? undefined,
      template: "OFF_PLATFORM_VERIFIED",
      title: "Report verified",
      body: "Thanks for reporting. We verified the off-platform payment attempt and banned the account involved.",
    });
    this.rt.emit(this.rt.adminRoom(), "admin.metrics", { type: "off_platform.verified" });
    return { ...updated, ban };
  }

  async dismiss(reportId: string, adminId: string) {
    const report = await this.prisma.offPlatformReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException("report not found");
    if (report.status !== OffPlatformReportStatus.PENDING) throw new BadRequestException("This report has already been reviewed.");
    return this.prisma.offPlatformReport.update({
      where: { id: reportId },
      data: { status: OffPlatformReportStatus.DISMISSED, reviewedById: adminId, reviewedAt: new Date() },
    });
  }

  // Immediate ban: providers are DEACTIVATED, customers are suspended long-term.
  private async banUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { provider: true } });
    if (!user) throw new NotFoundException("reported user not found");

    if (user.role === Role.PROVIDER && user.provider) {
      await this.prisma.provider.update({
        where: { id: user.provider.id },
        data: { status: ProviderStatus.DEACTIVATED, suspendedUntil: new Date(Date.now() + BAN_DAYS * 86400000) },
      });
      await this.notifications.notify({
        userId,
        template: "OFF_PLATFORM_BAN",
        title: "Account banned",
        body: "Your account has been banned for requesting off-platform payment, in violation of our terms.",
      });
      this.logger.warn(`Provider ${user.provider.id} (user ${userId}) banned for off-platform solicitation`);
      return { role: "PROVIDER" as const, status: ProviderStatus.DEACTIVATED };
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        suspendedUntil: new Date(Date.now() + BAN_DAYS * 86400000),
        suspendedReason: "Off-platform payment solicitation (verified) — banned",
      },
    });
    await this.notifications.notify({
      userId,
      template: "OFF_PLATFORM_BAN",
      title: "Account banned",
      body: "Your account has been banned for attempting off-platform payment, in violation of our terms.",
    });
    this.logger.warn(`Customer ${userId} banned for off-platform solicitation`);
    return { role: "CUSTOMER" as const, bannedUntil: new Date(Date.now() + BAN_DAYS * 86400000) };
  }
}
