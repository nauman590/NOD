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

    // If a provider was rated, recompute their ROLLING 30-DAY average.
    if (isCustomer && job.provider) {
      const since = new Date(Date.now() - 30 * 86400000);
      const agg = await this.prisma.rating.aggregate({
        where: { rateeId: job.provider.userId, createdAt: { gte: since } },
        _avg: { stars: true },
        _count: true,
      });
      const avg = agg._avg.stars ?? 0;
      await this.prisma.provider.update({
        where: { id: job.provider.id },
        data: { ratingAvg: avg, ratingCount: agg._count },
      });
      // Quality thresholds on the rolling 30-day average (need ≥3 ratings):
      // < 3.5 → suspend + strike; otherwise < 4.0 → warning notification only.
      if (agg._count >= 3 && avg < 3.5) {
        await this.strikes.issue(job.provider.id, "LOW_RATING", { note: `Rolling 30-day rating ${avg.toFixed(2)} below 3.5` });
        await this.prisma.provider.update({
          where: { id: job.provider.id },
          data: { status: "SUSPENDED", suspendedUntil: new Date(Date.now() + 7 * 86400000) },
        });
      } else if (agg._count >= 3 && avg < 4.0) {
        await this.notifications.notify({
          userId: job.provider.userId,
          template: "RATING_WARNING",
          title: "Rating warning",
          body: `Your rolling 30-day rating is ${avg.toFixed(1)}. Keep it above 4.0 to stay in good standing.`,
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
}
