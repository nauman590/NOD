import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobStatus, Role, CancelledBy, CancellationTier } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProvidersService } from "../providers/providers.service";
import { PaymentsService } from "../payments/payments.service";
import { StrikesService } from "../strikes/strikes.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RealtimeService } from "../realtime/realtime.service";
import { MapsService } from "../maps/maps.service";
import { providerPayout, providerBaseNet, addOnsTotal, clampNoShowFeeCents, PROVIDER_NO_SHOW_FEE_DEFAULT_CENTS } from "../common/money";
import { AuthUser } from "../common/decorators";
import { CreateJobDto, AddAdjustmentsDto } from "./dto";

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private prisma: PrismaService,
    private providers: ProvidersService,
    private payments: PaymentsService,
    private strikes: StrikesService,
    private notifications: NotificationsService,
    private rt: RealtimeService,
    private maps: MapsService,
    private config: ConfigService,
  ) {}

  // The flat penalty (in cents) a provider owes for claiming then no-showing.
  // Clamped to the $15–25 product range regardless of the configured value.
  private noShowFeeCents(): number {
    const raw = parseInt(this.config.get<string>("PROVIDER_NO_SHOW_FEE_CENTS") || String(PROVIDER_NO_SHOW_FEE_DEFAULT_CENTS), 10);
    return clampNoShowFeeCents(raw);
  }

  // Optional background sweep that auto-detects providers who claimed a job and never
  // showed (still CLAIMED/EN_ROUTE past the grace window). Off by default so it can't
  // surprise a demo; enable with NO_SHOW_SWEEP_ENABLED=true. Admins can also trigger
  // detectProviderNoShows() on demand via POST /admin/no-shows/sweep.
  onModuleInit() {
    const enabled = (this.config.get<string>("NO_SHOW_SWEEP_ENABLED") || "false").toLowerCase() === "true";
    if (!enabled) return;
    const everyMin = Math.max(1, parseInt(this.config.get<string>("NO_SHOW_SWEEP_INTERVAL_MINUTES") || "5", 10));
    setInterval(() => {
      this.detectProviderNoShows().catch((e) => this.logger.warn(`no-show sweep failed: ${(e as Error).message}`));
    }, everyMin * 60_000).unref?.();
    this.logger.log(`Provider no-show sweep enabled (every ${everyMin}m).`);
  }

  private noShowGraceMinutes(): number {
    return Math.max(1, parseInt(this.config.get<string>("NO_SHOW_GRACE_MINUTES") || "30", 10));
  }

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
      providerPhotoUrl: job.provider?.profilePhotoUrl ?? null,
      vehicleType: job.provider?.vehicleType ?? null,
      customerId: job.customerId,
      customerName: job.customer?.fullName ?? null,
      customerPhotoUrl: job.customer?.profilePhotoUrl ?? null,
      customerRatingAvg: job.customer?.customerRatingAvg ?? 0,
      customerRatingCount: job.customer?.customerRatingCount ?? 0,
      providerLat: job.providerLat,
      providerLng: job.providerLng,
      etaMinutes: job.etaMinutes,
      photos: job.photos ?? [],
      createdAt: job.createdAt,
      claimedAt: job.claimedAt,
      enRouteAt: job.enRouteAt,
      arrivedAt: job.arrivedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      cancelledAt: job.cancelledAt,
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
      // Customer reputation shown to providers before they accept (Sprint 4, item 1).
      customerRatingAvg: job.customer?.customerRatingAvg ?? 0,
      customerRatingCount: job.customer?.customerRatingCount ?? 0,
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

    // Broadcast to all providers serving this category (real-time feed).
    this.rt.emit(this.rt.categoryRoom(job.categoryId), "job.available", this.cardSummary(job));
    this.rt.emit(this.rt.adminRoom(), "admin.metrics", { type: "job.created" });

    // Notify providers serving this category that a new job is available in their area
    // (brief trigger: SMS to provider on new job, configurable radius). Fire-and-forget so
    // job creation isn't blocked on the fan-out.
    this.notifyAvailableProviders(job).catch((e) =>
      this.logger.warn(`notifyAvailableProviders failed: ${(e as Error).message}`),
    );

    return this.serialize(job);
  }

  private appBaseUrl(): string {
    return (this.config.get<string>("APP_BASE_URL") || "http://localhost:5173").replace(/\/$/, "");
  }

  // The service radius (miles from the dispatch hub) within which a new job is broadcast
  // to providers. Brief launch area is 15 miles from downtown Atlanta.
  private jobRadiusMiles(): number {
    return Math.max(1, parseInt(this.config.get<string>("PROVIDER_JOB_RADIUS_MILES") || "15", 10));
  }
  private notifyLimit(): number {
    return Math.max(1, parseInt(this.config.get<string>("PROVIDER_JOB_NOTIFY_LIMIT") || "25", 10));
  }

  // Notify active providers serving the job's category that a new job is available. When a
  // Maps key is configured, gate on the configurable service radius (jobs beyond it don't
  // broadcast); without Maps, distance can't be measured so all category providers are
  // notified. Capped at notifyLimit() to bound the fan-out; the cap is logged when hit.
  private async notifyAvailableProviders(job: any) {
    if (this.maps.enabled) {
      const dist = await this.maps.poolDistanceMiles(job.serviceAddress);
      if (dist > this.jobRadiusMiles()) {
        this.logger.log(
          `Job ${job.id} is ${dist}mi from hub (> ${this.jobRadiusMiles()}mi radius) — not broadcasting to providers.`,
        );
        return;
      }
    }
    const limit = this.notifyLimit();
    const providers = await this.providers.activeProvidersForCategory(job.categoryId, limit);
    if (providers.length >= limit) {
      this.logger.log(`Job ${job.id}: notifying the first ${limit} providers (notify cap reached).`);
    }
    for (const p of providers) {
      await this.notifications
        .notify({
          userId: p.userId,
          jobId: job.id,
          template: "NEW_JOB_AVAILABLE",
          title: "New job available",
          body: `A new ${job.category?.name ?? "job"} is available in your area${job.serviceAddress ? ` (${job.serviceAddress})` : ""}. Open NOD to claim it.`,
          payload: { categoryId: job.categoryId, basePriceCents: job.basePriceCents },
        })
        .catch(() => undefined);
    }
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

  // Completed jobs for a provider, with the two-way rating status so the provider can
  // rate the customer (Sprint 4, item 2). Newest first.
  async providerCompletedJobs(userId: string) {
    const provider = await this.providers.assertActiveProvider(userId);
    const jobs = await this.prisma.job.findMany({
      where: { providerId: provider.id, status: JobStatus.COMPLETE },
      include: { ...this.jobInclude, ratings: true },
      orderBy: { completedAt: "desc" },
      take: 50,
    });
    return jobs.map((j) => {
      const mine = j.ratings.find((r) => r.raterId === userId) ?? null;
      const theirs = j.ratings.find((r) => r.raterId === j.customerId) ?? null;
      return {
        ...this.serialize(j),
        // Did the provider already rate the customer? and what did the customer give?
        providerRatedCustomer: !!mine,
        providerGaveStars: mine?.stars ?? null,
        customerRatedProvider: !!theirs,
        customerGaveStars: theirs?.stars ?? null,
      };
    });
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
    const provider = await this.providers.assertCanClaim(userId);

    const result = await this.prisma.job.updateMany({
      where: { id: jobId, status: JobStatus.AVAILABLE, providerId: null },
      data: { status: JobStatus.CLAIMED, providerId: provider.id, claimedAt: new Date() },
    });
    if (result.count === 0) throw new ConflictException("ALREADY_CLAIMED");

    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    if (!job) throw new NotFoundException();

    // Put the winning provider's socket(s) into the job room so they immediately
    // receive job-scoped events (chat, status, live location) without re-subscribing.
    this.rt.joinRoomToRoom(this.rt.providerRoom(provider.id), this.rt.jobRoom(jobId));

    // Tell every other provider the card is gone; assign to the winner; notify the customer.
    this.rt.emit(this.rt.categoryRoom(job.categoryId), "job.claimed", { jobId });
    this.rt.emit(this.rt.providerRoom(provider.id), "job.assigned", this.serialize(job));
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(job));
    // Notify the customer with the provider's NAME (and ETA when known) per the brief.
    const proName = job.provider?.user?.fullName || "Your pro";
    const etaSuffix = job.etaMinutes ? ` ETA ~${job.etaMinutes} min.` : "";
    await this.notifications.notify({
      userId: job.customerId,
      jobId,
      template: "JOB_CLAIMED",
      title: "A pro claimed your job",
      body: `${proName} (${provider.vehicleType ?? "provider"}) is assigned and will be in touch.${etaSuffix}`,
      payload: { providerName: proName, vehicleType: provider.vehicleType, etaMinutes: job.etaMinutes ?? null },
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

  async enRoute(jobId: string, userId: string) {
    const res = await this.transition(jobId, userId, JobStatus.EN_ROUTE, { enRouteAt: new Date() });
    // Customer SMS/notification: provider en route (brief trigger).
    const etaSuffix = res.etaMinutes ? ` ETA ~${res.etaMinutes} min.` : "";
    await this.notifications.notify({
      userId: res.customerId,
      jobId,
      template: "PROVIDER_EN_ROUTE",
      title: "Your pro is on the way",
      body: `${res.providerName ?? "Your pro"} is en route.${etaSuffix}`,
      payload: { etaMinutes: res.etaMinutes ?? null },
    });
    return res;
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
    // Hard gate: a "before" photo is required on arrival (Sprint 4, item 6).
    if (!job.photos?.some((p) => p.kind === "BEFORE")) {
      throw new BadRequestException("Add a 'before' photo before marking arrived.");
    }
    const now = new Date();
    // 20+ min late vs the dispatch ETA (frozen at trip start), with no delay notice → 10%
    // penalty credited to the customer. Only auto-fires when a dispatch ETA is known
    // (needs Maps); otherwise lateness can't be measured.
    let latePenaltyCents = 0;
    if (job.dispatchEtaMinutes && job.enRouteAt && !job.delayNoticeAt) {
      const lateMin = Math.round((now.getTime() - new Date(job.enRouteAt).getTime()) / 60000) - job.dispatchEtaMinutes;
      if (lateMin >= 20) {
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
    // Customer SMS/notification: provider arrived (brief trigger).
    await this.notifications.notify({
      userId: job.customerId,
      jobId,
      template: "PROVIDER_ARRIVED",
      title: "Your pro has arrived",
      body: `${job.provider?.user?.fullName ?? "Your pro"} has arrived at your location.`,
    });
    return this.serialize(updated);
  }
  async start(jobId: string, userId: string) {
    const { job } = await this.assertOwningProvider(jobId, userId);
    // Work can only start after arrival, which itself hard-gates the BEFORE photo. Enforcing
    // the state here (not just in the UI) keeps the BEFORE-photo requirement non-bypassable:
    // otherwise a direct start() from CLAIMED/EN_ROUTE would skip it entirely.
    if (job.status !== JobStatus.ARRIVED) {
      throw new ConflictException("Mark arrived (with a 'before' photo) before starting the job");
    }
    if (!job.photos?.some((p) => p.kind === "BEFORE")) {
      throw new BadRequestException("Add a 'before' photo before starting the job.");
    }
    return this.transition(jobId, userId, JobStatus.IN_PROGRESS, { startedAt: new Date() });
  }

  // A job can only be completed once work is underway. This blocks completing (and
  // capturing/paying out) straight from CLAIMED/EN_ROUTE/ARRIVED with no work done.
  // APPROVED/DECLINED are the add-on-detour states that resume in-progress work.
  private static readonly COMPLETABLE: JobStatus[] = [JobStatus.IN_PROGRESS, JobStatus.APPROVED, JobStatus.DECLINED];

  async complete(jobId: string, userId: string) {
    const { provider, job } = await this.assertOwningProvider(jobId, userId);
    if (!JobsService.COMPLETABLE.includes(job.status)) {
      throw new ConflictException("Job must be started before it can be completed");
    }
    // Hard gate: an "after" photo is required to complete (Sprint 4, item 6).
    if (!job.photos?.some((p) => p.kind === "AFTER")) {
      throw new BadRequestException("Add an 'after' photo before completing the job.");
    }
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
    // Customer: job complete WITH a receipt link (brief trigger).
    const receiptUrl = `${this.appBaseUrl()}/job/${jobId}`;
    await this.notifications.notify({
      userId: job.customerId,
      jobId,
      template: "JOB_COMPLETE",
      title: "Job complete",
      body: `Your job is done. View your receipt and rate your pro: ${receiptUrl}`,
      payload: { receiptUrl },
    });
    // Provider: payout deposited (brief trigger).
    await this.notifications.notify({
      userId: provider.userId,
      jobId,
      template: "PAYOUT_DEPOSITED",
      title: "Payout on the way",
      body: `Your $${(payoutInfo.payoutCents / 100).toFixed(2)} payout for this job has been sent to your connected account.`,
      payload: { payoutCents: payoutInfo.payoutCents },
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
    const pendingIds = pending.map((a) => a.id);
    // Flip only the adjustments we just read, gated on status=PENDING. The count tells us
    // whether THIS call actually approved them — a concurrent/duplicate approval finds them
    // already APPROVED (count 0) and must not charge again (would double-charge the customer).
    const approvedNow = await this.prisma.$transaction(async (tx) => {
      const res = await tx.adjustment.updateMany({
        where: { jobId, id: { in: pendingIds }, status: "PENDING" },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      await tx.job.update({ where: { id: jobId }, data: { status: JobStatus.APPROVED } });
      return res.count;
    });
    if (approvedNow > 0) {
      await this.payments.chargeAddOns(jobId, customerId, pending);
    }

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

    // Notify the assigned provider that the job was cancelled, with reason + fee status
    // (brief trigger). Not sent when the provider themselves cancelled.
    if (job.providerId && job.provider?.userId && !isProvider) {
      const feeLine =
        feeCents > 0
          ? `A $${(feeCents / 100).toFixed(2)} cancellation fee was charged to the customer and credited to you.`
          : "No cancellation fee applied.";
      await this.notifications.notify({
        userId: job.provider.userId,
        jobId,
        template: "JOB_CANCELLED_PROVIDER",
        title: "A job was cancelled",
        body: `${user.role === Role.ADMIN ? "An admin" : "The customer"} cancelled this job. ${feeLine}`,
        payload: { feeCents, tier },
      });
    }
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

  // ---- Provider claim-and-no-show (Sprint 4, item 3) ----
  // A provider who claims a job and never shows (still CLAIMED/EN_ROUTE, never ARRIVED)
  // is a no-show: the customer is fully released (no charge), and the provider owes a
  // $15–25 penalty on their next payout plus a NO_SHOW strike.
  private static readonly NO_SHOW_ELIGIBLE: JobStatus[] = [JobStatus.CLAIMED, JobStatus.EN_ROUTE];

  private async markProviderNoShow(jobId: string, opts: { source: "customer" | "auto" | "admin" } = { source: "auto" }) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: this.jobInclude });
    if (!job) throw new NotFoundException("job not found");
    if (!job.providerId || !JobsService.NO_SHOW_ELIGIBLE.includes(job.status)) {
      throw new ConflictException("Job is not eligible for a provider no-show");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: CancelledBy.PROVIDER,
        // No customer-facing fee tier — the customer is fully released, not charged.
        cancellationTier: null,
      },
      include: this.jobInclude,
    });

    // Release the customer's authorized-but-uncaptured base hold (never charged).
    await this.payments.handleCancellation(jobId);

    // Penalty + strike on the provider. Deducted from the next payout by StrikesService.
    const feeCents = this.noShowFeeCents();
    await this.strikes.issue(job.providerId, "NO_SHOW", {
      feeCents,
      jobId,
      note: `Claim-and-no-show (${opts.source})`,
    });

    await this.notifications.notify({
      userId: job.provider!.userId,
      jobId,
      template: "PROVIDER_NO_SHOW",
      title: "No-show penalty applied",
      body: `You didn't show for a claimed job. A $${(feeCents / 100).toFixed(0)} penalty will be deducted from your next payout, plus a strike.`,
    });
    await this.notifications.notify({
      userId: job.customerId,
      jobId,
      template: "PROVIDER_NO_SHOW_CUSTOMER",
      title: "Your pro didn't show",
      body: "We've cancelled this job and you won't be charged. Feel free to re-book — sorry about that.",
    });

    this.rt.emit(this.rt.providerRoom(job.providerId), "job.updated", this.serialize(updated));
    this.rt.emit(this.rt.customerRoom(job.customerId), "job.updated", this.serialize(updated));
    this.rt.emit(this.rt.adminRoom(), "admin.metrics", { type: "provider.no_show" });
    this.logger.warn(`Provider ${job.providerId} no-show on job ${jobId} (${opts.source}) — $${(feeCents / 100).toFixed(0)} penalty`);

    return { ...this.serialize(updated), noShowFeeCents: feeCents };
  }

  // Customer reports that their assigned pro never showed up.
  async reportProviderNoShow(jobId: string, customerId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException("job not found");
    if (job.customerId !== customerId) throw new ForbiddenException("not your job");
    if (!job.providerId || !JobsService.NO_SHOW_ELIGIBLE.includes(job.status)) {
      throw new BadRequestException("You can only report a no-show while a pro is assigned and hasn't arrived.");
    }
    return this.markProviderNoShow(jobId, { source: "customer" });
  }

  // Sweep: auto-detect providers who claimed but never showed past the grace window.
  // Triggered on a timer (opt-in) or on demand by an admin.
  async detectProviderNoShows() {
    const cutoff = new Date(Date.now() - this.noShowGraceMinutes() * 60000);
    const stale = await this.prisma.job.findMany({
      where: {
        status: { in: JobsService.NO_SHOW_ELIGIBLE },
        providerId: { not: null },
        arrivedAt: null,
        claimedAt: { lt: cutoff },
      },
      select: { id: true },
    });
    const results: string[] = [];
    for (const j of stale) {
      try {
        await this.markProviderNoShow(j.id, { source: "admin" });
        results.push(j.id);
      } catch (e) {
        this.logger.warn(`Skipped no-show for job ${j.id}: ${(e as Error).message}`);
      }
    }
    return { detected: results.length, jobIds: results };
  }

  async updateLocation(jobId: string, userId: string, lat: number, lng: number) {
    const { job } = await this.assertOwningProvider(jobId, userId);
    // Dynamic ETA: recompute from the provider's live point to the customer address on
    // each GPS ping (needs a Maps key to geocode; stays null otherwise). Keep the prior
    // value if this recompute can't produce one, so the ETA doesn't flicker away.
    const eta = await this.maps.etaMinutesFromPoint(lat, lng, job.serviceAddress);
    const etaMinutes = eta ?? job.etaMinutes ?? null;
    // Freeze the dispatch ETA ONCE, on the first ping after the trip starts. This is the
    // baseline the late-arrival penalty compares against — the live `etaMinutes` above
    // decays toward 0 as the provider approaches, so it can't be used for lateness.
    const captureDispatchEta =
      job.dispatchEtaMinutes == null && eta != null && (job.status === JobStatus.EN_ROUTE || !!job.enRouteAt);
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        providerLat: lat,
        providerLng: lng,
        etaMinutes,
        ...(captureDispatchEta ? { dispatchEtaMinutes: eta } : {}),
      },
    });
    this.rt.emit(this.rt.jobRoom(jobId), "provider.location", { jobId, lat, lng, etaMinutes, ts: Date.now() });
    return { ok: true, etaMinutes };
  }
}
