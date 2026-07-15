import { Injectable, Logger } from "@nestjs/common";
import { ProviderStatus, StrikeReason } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class StrikesService {
  private readonly logger = new Logger(StrikesService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // Issue a strike and enforce thresholds:
  // 3 strikes / 30 days → 7-day suspension; 5 / 90 days → deactivation.
  async issue(providerId: string, reason: StrikeReason, opts: { feeCents?: number; jobId?: string; note?: string } = {}) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) return null;

    const strike = await this.prisma.strike.create({
      data: { providerId, reason, feeCents: opts.feeCents ?? 0, jobId: opts.jobId ?? null, note: opts.note ?? null },
    });

    const now = Date.now();
    const [last30, last90] = await Promise.all([
      this.prisma.strike.count({ where: { providerId, createdAt: { gte: new Date(now - 30 * DAY) } } }),
      this.prisma.strike.count({ where: { providerId, createdAt: { gte: new Date(now - 90 * DAY) } } }),
    ]);

    let statusChange: ProviderStatus | null = null;
    let extra: Record<string, unknown> = {};
    if (last90 >= 5) {
      statusChange = ProviderStatus.DEACTIVATED;
    } else if (last30 >= 3) {
      statusChange = ProviderStatus.SUSPENDED;
      extra = { suspendedUntil: new Date(now + 7 * DAY) };
    }

    if (statusChange) {
      await this.prisma.provider.update({ where: { id: providerId }, data: { status: statusChange, ...extra } });
      await this.notifications.notify({
        userId: provider.userId,
        template: `PROVIDER_${statusChange}`,
        title: statusChange === ProviderStatus.DEACTIVATED ? "Account deactivated" : "Account suspended",
        body:
          statusChange === ProviderStatus.DEACTIVATED
            ? "5 strikes in 90 days — your account has been deactivated."
            : "3 strikes in 30 days — your account is suspended for 7 days.",
      });
      this.logger.warn(`Provider ${providerId} → ${statusChange} (30d=${last30}, 90d=${last90})`);
    }
    return strike;
  }

  // Sum unsettled strike fees, mark them settled, and return the amount to deduct.
  async settleForPayout(providerId: string): Promise<number> {
    const open = await this.prisma.strike.findMany({
      where: { providerId, settledAt: null, feeCents: { gt: 0 } },
      select: { id: true, feeCents: true },
    });
    if (open.length === 0) return 0;
    const total = open.reduce((s, x) => s + x.feeCents, 0);
    await this.prisma.strike.updateMany({
      where: { id: { in: open.map((x) => x.id) } },
      data: { settledAt: new Date() },
    });
    return total;
  }

  async remove(strikeId: string) {
    return this.prisma.strike.delete({ where: { id: strikeId } });
  }
}
