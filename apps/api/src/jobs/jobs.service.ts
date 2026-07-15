import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { JobStatus, Role, CancelledBy, CancellationTier } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProvidersService } from "../providers/providers.service";
import { PaymentsService } from "../payments/payments.service";
import { StrikesService } from "../strikes/strikes.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RealtimeService } from "../realtime/realtime.service";
import { providerPayout, providerBaseNet, addOnsTotal } from "../common/money";
import { AuthUser } from "../common/decorators";
import { CreateJobDto, AddAdjustmentsDto } from "./dto";

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    private providers: ProvidersService,
    private payments: PaymentsService,
    private strikes: StrikesService,
    private notifications: NotificationsService,
    private rt: RealtimeService,
  ) {}

  private jobInclude = {
    category: true,
    adjustments: { orderBy: { createdAt: "asc" as const } },
    provider: { include: { user: true } },
    customer: true,
    photos: { orderBy: { takenAt: "asc" as const } },
  };

  private serialize(job: any) {
    const approvedAddOns = job.adjustments?.filter((a: any) => a.status === "APPROVED") ?? [];
    const pendingAddOns = job.adjustments?.filter((a: any) => a.status === "PENDING") ?? [];
    return {
      id: job.id,
      status: job.status,
      categoryId: job.categoryId,
      category: job.category?.name ?? null,
      categorySlug: job.category?.slug ?? null,
      photoUrl: job.photoUrl,
      description: job.description,
      intakeData: job.intakeData,
      serviceAddress: job.serviceAddress,
      distanceMiles: job.distanceMiles,
      estimatedHours: job.estimatedHours,
      basePriceCents: job.basePriceCents,
      addOns: job.adjustments ?? [],
      approvedAddOnsCents: addOnsTotal(approvedAddOns),
      pendingAddOnsCents: addOnsTotal(pendingAddOns),
      customerTotalCents: job.basePriceCents + addOnsTotal(approvedAddOns),
      providerPayoutCents: providerPayout(job.basePriceCents, approvedAddOns),
      providerName: job.provider?.user?.fullName ?? null,
      providerId: job.providerId,
      customerId: job.customerId,
      providerLat: job.providerLat,
      providerLng: job.providerLng,
      etaMinutes: job.etaMinutes,
      photos: job.photos ?? [],
      createdAt: job.createdAt,
      claimedAt: job.claimedAt,
      completedAt: job.completedAt,
    };
  }

  async addPhoto(jobId: string, userId: string, kind: "BEFORE" | "AFTER", url: string, lat?: number, lng?: number) {
    const { job } = await this.assertOwningProvider(jobId, userId);
    await this.prisma.jobPhoto.create({ data: { jobId: job.id, kind, url, lat: lat ?? null, lng: lng ?? null } });
    const updated = await this.prisma.job.findUnique({ where: { id: job.id }, include: this.jobInclude });
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(updated));
    return this.serialize(updated);
  }

  private cardSummary(job: any) {
    return {
      id: job.id,
      category: job.category?.name ?? null,
      categoryId: job.categoryId,
      description: job.description,
      photoUrl: job.photoUrl,
      distanceMiles: job.distanceMiles,
      basePriceCents: job.basePriceCents,
      providerPayoutCents: providerBaseNet(job.basePriceCents),
      serviceAddress: job.serviceAddress,
      status: job.status,
      createdAt: job.createdAt,
    };
  }

  async createFromEstimate(dto: CreateJobDto, customerId: string) {
    const customer = await this.prisma.user.findUnique({ where: { id: customerId } });
    if (customer?.suspendedUntil && customer.suspendedUntil > new Date())
      throw new ForbiddenException(customer.suspendedReason || "Your account is suspended");
    const estimate = await this.prisma.estimate.findUnique({ where: { id: dto.estimateId } });
    if (!estimate) throw new NotFoundException("estimate not found");
    if (estimate.consumed) throw new BadRequestException("estimate already used");
    if (estimate.lockedUntil < new Date()) throw new ConflictException("PRICE_LOCK_EXPIRED");

    const address = dto.serviceAddress ?? estimate.serviceAddress ?? null;

    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          customerId,
          categoryId: estimate.categoryId,
          estimateId: estimate.id,
          status: JobStatus.AVAILABLE,
          photoUrl: estimate.photoUrl,
          description: estimate.description,
          intakeData: estimate.intakeData as any,
          serviceAddress: address,
          distanceMiles: estimate.distanceMiles,
          estimatedHours: estimate.estimatedHours,
          basePriceCents: estimate.basePriceCents,
          lockedPriceCents: estimate.basePriceCents,
          lockedUntil: estimate.lockedUntil,
        },
        include: this.jobInclude,
      });
      await tx.estimate.update({ where: { id: estimate.id }, data: { consumed: true } });
      return created;
    });

    // Authorize the base price (manual-capture hold) on the customer's card.
    await this.payments.authorizeBase(job.id, customerId, job.basePriceCents, dto.paymentMethodId);

    // Broadcast to all providers serving this category.
    this.rt.emit(this.rt.categoryRoom(job.categoryId), "job.available", this.cardSummary(job));
    this.rt.emit(this.rt.adminRoom(), "admin.metrics", { type: "job.created" });

    return this.serialize(job);
  }

  async myJobs(customerId: string) {
    const jobs = await this.prisma.job.findMany({
      where: { customerId },
      include: this.jobInclude,
      orderBy: { createdAt: "desc" },
    });
    return jobs.map((j) => this.serialize(j));
  }

  async availableFeed(userId: string) {
    const categoryIds = await this.providers.activeCategoryIds(userId);
    if (categoryIds.length === 0) return [];
    const jobs = await this.prisma.job.findMany({
      where: { status: JobStatus.AVAILABLE, categoryId: { in: categoryIds } },
      include: this.jobInclude,
      orderBy: { createdAt: "desc" },
    });
    return jobs.map((j) => this.cardSummary(j));
  }

  async providerActiveJobs(userId: string) {
    const provider = await this.providers.assertActiveProvider(userId);
    const jobs = await this.prisma.job.findMany({
      where: { providerId: provider.id, status: { notIn: [JobStatus.COMPLETE, JobStatus.CANCELLED, JobStatus.DECLINED] } },
      include: this.jobInclude,
      orderBy: { updatedAt: "desc" },
    });
    return jobs.map((j) => this.serialize(j));
  }

  async getJob(id: string, user: AuthUser) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: this.jobInclude });
    if (!job) throw new NotFoundException("job not found");
    if (user.role !== Role.ADMIN) {
      const isCustomer = job.customerId === user.id;
      const isProvider = job.provider?.userId === user.id;
      if (!isCustomer && !isProvider) throw new ForbiddenException("not your job");
    }
    return this.serialize(job);
  }

  // Atomic first-to-claim-wins.
  async claim(jobId: string, userId: string) {
    const provider = await this.providers.assertActiveProvider(userId);

    const result = await this.prisma.job.updateMany({
      where: { id: jobId, status: JobStatus.AVAILABLE, providerId: null },
      data: { status: JobStatus.CLAIMED, providerId: provider.id, claimedAt: new Date() },
    });
    if (result.count === 0) throw new ConflictException("ALREADY_CLAIMED");

    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    if (!job) throw new NotFoundException();

    // Tell every other provider the card is gone; assign to the winner; notify the customer.
    this.rt.emit(this.rt.categoryRoom(job.categoryId), "job.claimed", { jobId });
    this.rt.emit(this.rt.providerRoom(provider.id), "job.assigned", this.serialize(job));
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(job));
    await this.notifications.notify({
      userId: job.customerId,
      jobId,
      template: "JOB_CLAIMED",
      title: "A pro claimed your job",
      body: `${provider.vehicleType ?? "A provider"} is assigned and will be in touch.`,
    });
    return this.serialize(job);
  }

  private async assertOwningProvider(jobId: string, userId: string) {
    const provider = await this.providers.assertActiveProvider(userId);
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    if (!job) throw new NotFoundException("job not found");
    if (job.providerId !== provider.id) throw new ForbiddenException("not your job");
    return { provider, job };
  }

  private async transition(jobId: string, userId: string, status: JobStatus, stamp: Partial<any>) {
    const { job } = await this.assertOwningProvider(jobId, userId);
    const updated = await this.prisma.job.update({
      where: { id: job.id },
      data: { status, ...stamp },
      include: this.jobInclude,
    });
    this.rt.emit(this.rt.jobRoom(jobId), "job.status_changed", { jobId, status });
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(updated));
    return this.serialize(updated);
  }

  enRoute(jobId: string, userId: string) {
    return this.transition(jobId, userId, JobStatus.EN_ROUTE, { enRouteAt: new Date() });
  }
  // Provider can notify a delay (waives the auto late-penalty).
  async delayNotice(jobId: string, userId: string) {
    const { job } = await this.assertOwningProvider(jobId, userId);
    const updated = await this.prisma.job.update({ where: { id: job.id }, data: { delayNoticeAt: new Date() }, include: this.jobInclude });
    await this.notifications.notify({ userId: job.customerId, jobId, template: "PROVIDER_DELAYED", title: "Your pro is running late", body: "Your provider sent a heads-up and is on the way." });
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(updated));
    return this.serialize(updated);
  }

  async arrived(jobId: string, userId: string) {
    const { provider, job } = await this.assertOwningProvider(jobId, userId);
    const now = new Date();
    // 20+ min late vs the dispatch ETA, with no delay notice → 10% penalty credited to the customer.
    // Only auto-fires when an ETA is known (needs Maps); otherwise it can't be measured.
    let latePenaltyCents = 0;
    if (job.etaMinutes && job.enRouteAt && !job.delayNoticeAt) {
      const lateMin = Math.round((now.getTime() - new Date(job.enRouteAt).getTime()) / 60000) - job.etaMinutes;
      if (lateMin > 20) {
        const approved = job.adjustments.filter((a) => a.status === "APPROVED");
        latePenaltyCents = Math.round((job.basePriceCents + addOnsTotal(approved)) * 0.1);
      }
    }
    const updated = await this.prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.ARRIVED, arrivedAt: now, latePenaltyCents },
      include: this.jobInclude,
    });
    if (latePenaltyCents > 0) {
      await this.strikes.issue(provider.id, "LATE_ARRIVAL", { feeCents: latePenaltyCents, jobId, note: "Arrived 20+ min late without notice" });
    }
    this.rt.emit(this.rt.jobRoom(jobId), "job.status_changed", { jobId, status: JobStatus.ARRIVED });
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(updated));
    return this.serialize(updated);
  }
  start(jobId: string, userId: string) {
    return this.transition(jobId, userId, JobStatus.IN_PROGRESS, { startedAt: new Date() });
  }

  async complete(jobId: string, userId: string) {
    const { provider, job } = await this.assertOwningProvider(jobId, userId);
    const payoutInfo = await this.payments.captureAndPayout(jobId, provider.userId);
    // Credit the customer the late-arrival penalty (10%) — best-effort, never blocks completion.
    if (job.latePenaltyCents > 0) {
      try {
        await this.payments.refundLatePenalty(jobId, job.latePenaltyCents);
      } catch {
        /* credit can be reconciled later; do not fail the job completion */
      }
    }
    const updated = await this.prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.COMPLETE, completedAt: new Date() },
      include: this.jobInclude,
    });
    this.rt.emit(this.rt.jobRoom(jobId), "job.completed", { jobId, payoutCents: payoutInfo.payoutCents });
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(updated));
    this.rt.emit(this.rt.adminRoom(), "admin.metrics", { type: "job.completed" });
    await this.notifications.notify({
      userId: job.customerId,
      jobId,
      template: "JOB_COMPLETE",
      title: "Job complete",
      body: "Your job is done. Tap to rate your pro.",
    });
    return { ...this.serialize(updated), payoutCents: payoutInfo.payoutCents };
  }

  async addAdjustments(jobId: string, userId: string, dto: AddAdjustmentsDto) {
    const { provider, job } = await this.assertOwningProvider(jobId, userId);
    if (dto.items.length === 0) throw new BadRequestException("no items");

    await this.prisma.$transaction(async (tx) => {
      await tx.adjustment.deleteMany({ where: { jobId, status: "PENDING" } });
      await tx.adjustment.createMany({
        data: dto.items.map((i) => ({ jobId, providerId: provider.id, description: i.description, priceCents: i.priceCents })),
      });
      await tx.job.update({ where: { id: jobId }, data: { status: JobStatus.PENDING_APPROVAL } });
    });

    const updated = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    this.rt.emit(this.rt.jobRoom(jobId), "job.adjustment_requested", this.serialize(updated));
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(updated));
    await this.notifications.notify({
      userId: job.customerId,
      jobId,
      template: "ADDON_REQUESTED",
      title: "Your pro added items",
      body: "Review and approve the updated total.",
    });
    return this.serialize(updated);
  }

  async approveAdjustments(jobId: string, customerId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    if (!job) throw new NotFoundException("job not found");
    if (job.customerId !== customerId) throw new ForbiddenException("not your job");

    const pending = job.adjustments.filter((a) => a.status === "PENDING");
    await this.prisma.$transaction(async (tx) => {
      await tx.adjustment.updateMany({
        where: { jobId, status: "PENDING" },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      await tx.job.update({ where: { id: jobId }, data: { status: JobStatus.APPROVED } });
    });
    await this.payments.chargeAddOns(jobId, customerId, pending);

    const updated = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    const providerUserId = job.provider?.userId;
    if (providerUserId) {
      this.rt.emit(this.rt.providerRoom(job.providerId!), "job.adjustment_approved", this.serialize(updated));
      await this.notifications.notify({
        userId: providerUserId,
        jobId,
        template: "ADDON_APPROVED",
        title: "Add-ons approved",
        body: "The customer approved your added items.",
      });
    }
    this.rt.emit(this.rt.jobRoom(jobId), "job.updated", this.serialize(updated));
    return this.serialize(updated);
  }

  async declineAdjustments(jobId: string, customerId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    if (!job) throw new NotFoundException("job not found");
    if (job.customerId !== customerId) throw new ForbiddenException("not your job");

    await this.prisma.$transaction(async (tx) => {
      await tx.adjustment.updateMany({ where: { jobId, status: "PENDING" }, data: { status: "DECLINED", declinedAt: new Date() } });
      await tx.job.update({ where: { id: jobId }, data: { status: JobStatus.DECLINED } });
    });

    const updated = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    const providerUserId = job.provider?.userId;
    if (providerUserId) {
      this.rt.emit(this.rt.providerRoom(job.providerId!), "job.adjustment_declined", this.serialize(updated));
      await this.notifications.notify({
        userId: providerUserId,
        jobId,
        template: "ADDON_DECLINED",
        title: "Add-ons declined",
        body: "Proceed with the original scope.",
      });
    }
    this.rt.emit(this.rt.jobRoom(jobId), "job.updated", this.serialize(updated));
    return this.serialize(updated);
  }

  async cancel(jobId: string, user: AuthUser) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    if (!job) throw new NotFoundException("job not found");
    const isCustomer = job.customerId === user.id;
    const isProvider = job.provider?.userId === user.id;
    if (!isCustomer && !isProvider && user.role !== Role.ADMIN) throw new ForbiddenException("not your job");

    // Determine cancellation tier from current lifecycle state.
    let tier: CancellationTier;
    if (job.status === JobStatus.AVAILABLE) tier = CancellationTier.BEFORE_CLAIM;
    else if (job.status === JobStatus.EN_ROUTE || job.status === JobStatus.ARRIVED || job.status === JobStatus.IN_PROGRESS)
      tier = CancellationTier.AFTER_EN_ROUTE;
    else tier = CancellationTier.AFTER_CLAIM;

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: isCustomer ? CancelledBy.CUSTOMER : isProvider ? CancelledBy.PROVIDER : CancelledBy.ADMIN,
        cancellationTier: tier,
      },
      include: this.jobInclude,
    });
    // Charge the cancellation fee / release the base hold per tier.
    const { feeCents } = await this.payments.handleCancellation(jobId);

    // A provider abandoning a claimed job earns a strike ($20 deducted next payout).
    if (isProvider && job.providerId && tier !== CancellationTier.BEFORE_CLAIM) {
      await this.strikes.issue(job.providerId, "LATE_CANCEL", { feeCents: 2000, jobId, note: "Provider cancelled a claimed job" });
    }

    if (job.providerId) this.rt.emit(this.rt.providerRoom(job.providerId), "job.updated", this.serialize(updated));
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(updated));
    this.rt.emit(this.rt.categoryRoom(job.categoryId), "job.claimed", { jobId }); // remove from feeds
    return { ...this.serialize(updated), cancellationFeeCents: feeCents };
  }

  // Provider reports the customer was a no-show on arrival → 50% fee.
  async reportNoShow(jobId: string, userId: string) {
    const { job } = await this.assertOwningProvider(jobId, userId);
    const updated = await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: CancelledBy.PROVIDER,
        cancellationTier: CancellationTier.NO_SHOW,
      },
      include: this.jobInclude,
    });
    const { feeCents } = await this.payments.handleCancellation(jobId);

    // Three customer no-shows in 60 days → suspend the customer's account.
    const noShows = await this.prisma.job.count({
      where: { customerId: job.customerId, cancellationTier: CancellationTier.NO_SHOW, cancelledAt: { gte: new Date(Date.now() - 60 * 86400000) } },
    });
    if (noShows >= 3) {
      await this.prisma.user.update({
        where: { id: job.customerId },
        data: { suspendedUntil: new Date(Date.now() + 60 * 86400000), suspendedReason: "3 no-shows in 60 days" },
      });
      await this.notifications.notify({
        userId: job.customerId,
        template: "ACCOUNT_SUSPENDED",
        title: "Account suspended",
        body: "Your account is suspended after 3 no-shows in 60 days.",
      });
    }

    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(updated));
    return { ...this.serialize(updated), cancellationFeeCents: feeCents, customerNoShows: noShows };
  }

  async updateLocation(jobId: string, userId: string, lat: number, lng: number) {
    const { job } = await this.assertOwningProvider(jobId, userId);
    await this.prisma.job.update({ where: { id: job.id }, data: { providerLat: lat, providerLng: lng } });
    this.rt.emit(this.rt.jobRoom(jobId), "provider.location", { jobId, lat, lng, ts: Date.now() });
    return { ok: true };
  }
}
