import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StrikesService } from "../strikes/strikes.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class RatingsService {
  constructor(
    private prisma: PrismaService,
    private strikes: StrikesService,
    private notifications: NotificationsService,
  ) {}

  // Recompute a ratee's stored aggregate from their Rating rows. Providers use a
  // ROLLING 30-DAY window (drives good-standing thresholds); customers use an all-time
  // average (shown to providers before accepting a job). Returns the fresh figures.
  private async recomputeAggregateFor(rateeUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: rateeUserId }, include: { provider: true } });
    if (!user) return null;

    if (user.provider) {
      const since = new Date(Date.now() - 30 * 86400000);
      const agg = await this.prisma.rating.aggregate({
        where: { rateeId: rateeUserId, createdAt: { gte: since } },
        _avg: { stars: true },
        _count: true,
      });
      const avg = agg._avg.stars ?? 0;
      await this.prisma.provider.update({ where: { id: user.provider.id }, data: { ratingAvg: avg, ratingCount: agg._count } });
      return { isProvider: true as const, providerId: user.provider.id, avg, count: agg._count };
    }

    const agg = await this.prisma.rating.aggregate({ where: { rateeId: rateeUserId }, _avg: { stars: true }, _count: true });
    await this.prisma.user.update({ where: { id: rateeUserId }, data: { customerRatingAvg: agg._avg.stars ?? 0, customerRatingCount: agg._count } });
    return { isProvider: false as const, avg: agg._avg.stars ?? 0, count: agg._count };
  }

  async rate(jobId: string, raterUserId: string, stars: number, comment?: string) {
    if (stars < 1 || stars > 5) throw new BadRequestException("stars must be 1-5");
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { provider: true },
    });
    if (!job) throw new NotFoundException("job not found");
    if (job.status !== "COMPLETE") throw new BadRequestException("can only rate a completed job");

    const isCustomer = job.customerId === raterUserId;
    const isProvider = job.provider?.userId === raterUserId;
    if (!isCustomer && !isProvider) throw new ForbiddenException("not your job");

    const rateeId = isCustomer ? job.provider!.userId : job.customerId;

    const rating = await this.prisma.rating.upsert({
      where: { jobId_raterId: { jobId, raterId: raterUserId } },
      update: { stars, comment: comment ?? null, rateeId },
      create: { jobId, raterId: raterUserId, rateeId, stars, comment: comment ?? null },
    });

    const agg = await this.recomputeAggregateFor(rateeId);

    // Quality thresholds on a provider's rolling 30-day average (need ≥3 ratings):
    // < 3.5 → suspend + strike; otherwise < 4.0 → warning notification only.
    if (isCustomer && job.provider && agg?.isProvider && agg.count >= 3) {
      if (agg.avg < 3.5) {
        await this.strikes.issue(job.provider.id, "LOW_RATING", { note: `Rolling 30-day rating ${agg.avg.toFixed(2)} below 3.5` });
        await this.prisma.provider.update({
          where: { id: job.provider.id },
          data: { status: "SUSPENDED", suspendedUntil: new Date(Date.now() + 7 * 86400000) },
        });
      } else if (agg.avg < 4.0) {
        await this.notifications.notify({
          userId: job.provider.userId,
          template: "RATING_WARNING",
          title: "Rating warning",
          body: `Your rolling 30-day rating is ${agg.avg.toFixed(1)}. Keep it above 4.0 to stay in good standing.`,
        });
      }
    }
    return rating;
  }

  providerRatings(userId: string) {
    return this.prisma.rating.findMany({
      where: { rateeId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  // ---- Admin manual rating adjustments (Sprint 5) ----

  // Ratings a given user (provider or customer) has RECEIVED, with rater + job context.
  listReceived(userId: string) {
    return this.prisma.rating.findMany({
      where: { rateeId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        rater: { select: { id: true, fullName: true, role: true } },
        job: { select: { id: true, category: { select: { name: true } } } },
      },
    });
  }

  async adminUpdate(ratingId: string, data: { stars?: number; comment?: string }) {
    if (data.stars !== undefined && (data.stars < 1 || data.stars > 5)) throw new BadRequestException("stars must be 1-5");
    const rating = await this.prisma.rating.findUnique({ where: { id: ratingId } });
    if (!rating) throw new NotFoundException("rating not found");
    const updated = await this.prisma.rating.update({
      where: { id: ratingId },
      data: {
        ...(data.stars !== undefined ? { stars: data.stars } : {}),
        ...(data.comment !== undefined ? { comment: data.comment } : {}),
      },
    });
    const agg = await this.recomputeAggregateFor(rating.rateeId);
    return { rating: updated, aggregate: agg };
  }

  async adminDelete(ratingId: string) {
    const rating = await this.prisma.rating.findUnique({ where: { id: ratingId } });
    if (!rating) throw new NotFoundException("rating not found");
    await this.prisma.rating.delete({ where: { id: ratingId } });
    const agg = await this.recomputeAggregateFor(rating.rateeId);
    return { ok: true, aggregate: agg };
  }
}
