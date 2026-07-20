import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { ProviderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PaymentsService } from "../payments/payments.service";
import { StrikesService } from "../strikes/strikes.service";
import { ProvidersService } from "../providers/providers.service";
import { CheckrService } from "../providers/checkr.service";
import { JobsService } from "../jobs/jobs.service";
import { RatingsService } from "../ratings/ratings.service";
import { StrikeReason } from "@prisma/client";

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private paymentsService: PaymentsService,
    private strikesService: StrikesService,
    private providersService: ProvidersService,
    private checkrService: CheckrService,
    private jobsService: JobsService,
    private ratingsService: RatingsService,
  ) {}

  // Admin-sent Stripe Connect onboarding link for a recruited provider (Sprint 5).
  providerConnectLink(providerId: string) {
    return this.providersService.adminConnectLink(providerId);
  }

  // Kick off a real Checkr background check (falls back to manual gate if Checkr unset).
  checkrInitiate(providerId: string) {
    return this.checkrService.initiateForProvider(providerId);
  }

  // Run the provider claim-and-no-show sweep on demand.
  detectNoShows() {
    return this.jobsService.detectProviderNoShows();
  }

  // ---- Manual rating adjustments (Sprint 5) ----
  userRatings(userId: string) {
    return this.ratingsService.listReceived(userId);
  }
  adjustRating(ratingId: string, data: { stars?: number; comment?: string }) {
    return this.ratingsService.adminUpdate(ratingId, data);
  }
  removeRating(ratingId: string) {
    return this.ratingsService.adminDelete(ratingId);
  }

  refundPayment(paymentId: string, amountCents?: number) {
    return this.paymentsService.refundPayment(paymentId, amountCents);
  }

  refundDeposit(providerId: string) {
    return this.providersService.refundDeposit(providerId);
  }

  // Suspend / unsuspend / ban a CUSTOMER (also used by the off-platform ban flow).
  async setCustomerSuspension(userId: string, suspend: boolean, reason?: string, days = 60) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("user not found");
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: suspend
        ? { suspendedUntil: new Date(Date.now() + days * 86400000), suspendedReason: reason ?? "Policy violation" }
        : { suspendedUntil: null, suspendedReason: null },
    });
    await this.notifications.notify({
      userId,
      template: suspend ? "ACCOUNT_SUSPENDED" : "ACCOUNT_REINSTATED",
      title: suspend ? "Account suspended" : "Account reinstated",
      body: suspend ? reason ?? "Your account has been suspended." : "Your account has been reinstated.",
    });
    return { suspendedUntil: updated.suspendedUntil };
  }

  // Basic analytics (per the brief): jobs/day, revenue, top categories, provider performance.
  async analytics() {
    const jobs = await this.prisma.job.findMany({
      select: { createdAt: true, status: true, categoryId: true, category: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const jobsByDay: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const j of jobs) {
      jobsByDay[dayKey(j.createdAt)] = (jobsByDay[dayKey(j.createdAt)] ?? 0) + 1;
      const name = j.category?.name ?? "—";
      byCategory[name] = (byCategory[name] ?? 0) + 1;
    }
    const topCategories = Object.entries(byCategory)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const providers = await this.prisma.provider.findMany({
      include: { user: { select: { fullName: true, email: true } }, _count: { select: { claimedJobs: true } } },
      orderBy: { ratingCount: "desc" },
      take: 10,
    });
    const providerPerformance = providers.map((p) => ({
      name: p.user.fullName ?? p.user.email,
      jobs: p._count.claimedJobs,
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      status: p.status,
    }));

    const [fees, payouts, customers, repeatCustomers] = await Promise.all([
      this.prisma.payment.aggregate({ where: { type: "BASE" }, _sum: { platformFeeCents: true } }),
      this.prisma.payment.aggregate({ where: { type: "PAYOUT" }, _sum: { amountCents: true } }),
      this.prisma.user.count({ where: { role: "CUSTOMER" } }),
      this.prisma.job.groupBy({ by: ["customerId"], _count: true, having: { customerId: { _count: { gt: 1 } } } }),
    ]);

    return {
      jobsByDay: Object.entries(jobsByDay).sort().slice(-14).map(([day, count]) => ({ day, count })),
      topCategories,
      providerPerformance,
      platformRevenueCents: fees._sum.platformFeeCents ?? 0,
      totalPayoutCents: payouts._sum.amountCents ?? 0,
      customers,
      repeatCustomers: repeatCustomers.length,
    };
  }

  issueStrike(providerId: string, reason: StrikeReason, feeCents?: number, note?: string) {
    return this.strikesService.issue(providerId, reason, { feeCents, note });
  }

  removeStrike(strikeId: string) {
    return this.strikesService.remove(strikeId);
  }

  async metrics() {
    const [jobs, providers, customers, completed, pendingProviders, payouts, fees] = await Promise.all([
      this.prisma.job.count(),
      this.prisma.provider.count(),
      this.prisma.user.count({ where: { role: "CUSTOMER" } }),
      this.prisma.job.count({ where: { status: "COMPLETE" } }),
      this.prisma.provider.count({ where: { status: "PENDING_APPROVAL" } }),
      this.prisma.payment.aggregate({ where: { type: "PAYOUT" }, _sum: { amountCents: true } }),
      this.prisma.payment.aggregate({ where: { type: "BASE" }, _sum: { platformFeeCents: true } }),
    ]);
    const byStatus = await this.prisma.job.groupBy({ by: ["status"], _count: true });
    return {
      totalJobs: jobs,
      completedJobs: completed,
      totalProviders: providers,
      pendingProviders,
      totalCustomers: customers,
      totalPayoutCents: payouts._sum.amountCents ?? 0,
      platformRevenueCents: fees._sum.platformFeeCents ?? 0,
      jobsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    };
  }

  providers(status?: ProviderStatus) {
    return this.prisma.provider.findMany({
      where: status ? { status } : {},
      include: { user: true, categoryRates: { include: { category: true } }, strikes: true },
      orderBy: { createdAt: "desc" },
    });
  }

  private async setStatus(id: string, status: ProviderStatus, extra: Record<string, unknown> = {}) {
    const provider = await this.prisma.provider.findUnique({ where: { id }, include: { user: true } });
    if (!provider) throw new NotFoundException("provider not found");
    const updated = await this.prisma.provider.update({ where: { id }, data: { status, ...extra } });
    await this.notifications.notify({
      userId: provider.userId,
      template: `PROVIDER_${status}`,
      title: `Account ${status.toLowerCase().replace("_", " ")}`,
      body: `Your provider account status is now ${status}.`,
    });
    return updated;
  }

  // Activation is gated on a passed background check (manual review).
  async approve(id: string) {
    const provider = await this.prisma.provider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException("provider not found");
    const passed = ["PASSED", "STUB_PASSED"].includes(provider.backgroundCheckStatus || "");
    if (!passed) throw new BadRequestException("Mark the background check Passed before activating this provider.");
    return this.setStatus(id, ProviderStatus.ACTIVE, { approvedAt: new Date() });
  }

  // Manual background-check review (Checkr can replace this behind the same field later).
  async setBackgroundCheck(id: string, result: "PASSED" | "FAILED") {
    const provider = await this.prisma.provider.findUnique({ where: { id }, include: { user: true } });
    if (!provider) throw new NotFoundException("provider not found");
    if (result === "FAILED") {
      return this.setStatus(id, ProviderStatus.REJECTED, { backgroundCheckStatus: "FAILED" });
    }
    const updated = await this.prisma.provider.update({ where: { id }, data: { backgroundCheckStatus: "PASSED" } });
    await this.notifications.notify({
      userId: provider.userId,
      template: "BG_PASSED",
      title: "Background check passed",
      body: "Your background check passed — pending final activation.",
    });
    return updated;
  }

  reject(id: string) {
    return this.setStatus(id, ProviderStatus.REJECTED);
  }
  suspend(id: string, days = 7) {
    return this.setStatus(id, ProviderStatus.SUSPENDED, { suspendedUntil: new Date(Date.now() + days * 86400000) });
  }
  async deactivate(id: string) {
    const result = await this.setStatus(id, ProviderStatus.DEACTIVATED);
    // Good standing = no unsettled strike fees → refund the deposit in full.
    const openFees = await this.prisma.strike.count({ where: { providerId: id, settledAt: null, feeCents: { gt: 0 } } });
    if (openFees === 0) await this.providersService.refundDeposit(id).catch(() => {});
    return result;
  }

  customers() {
    return this.prisma.user.findMany({
      where: { role: "CUSTOMER" },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, phone: true, fullName: true, isGuest: true, createdAt: true, suspendedUntil: true, suspendedReason: true, _count: { select: { customerJobs: true } } },
    });
  }

  jobs(status?: string) {
    return this.prisma.job.findMany({
      where: status ? { status: status as any } : {},
      include: { category: true, provider: { include: { user: true } }, customer: true, adjustments: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  payments() {
    return this.prisma.payment.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
