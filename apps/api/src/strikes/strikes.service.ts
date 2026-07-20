import { Injectable, Logger } from "@nestjs/common";
import { PaymentStatus, PaymentType, ProviderStatus, StrikeReason } from "@prisma/client";
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

    // The held deposit is the primary deduction source: cover the fee from it first, and
    // leave any uncovered remainder owed (settled from the next payout by settleForPayout).
    if (strike.feeCents > 0) {
      const drawn = await this.drawFromDeposit(providerId, strike.feeCents, { reason: `strike:${reason}`, jobId: opts.jobId });
      if (drawn > 0) {
        const remaining = strike.feeCents - drawn;
        await this.prisma.strike.update({
          where: { id: strike.id },
          data: remaining > 0 ? { feeCents: remaining } : { feeCents: 0, settledAt: new Date() },
        });
      }
    }

    const now = Date.now();
    const [last30, last90] = await Promise.all([
      this.prisma.strike.count({ where: { providerId, createdAt: { gte: new Date(now - 30 * DAY) } } }),
      this.prisma.strike.count({ where: { providerId, createdAt: { gte: new Date(now - 90 * DAY) } } }),
    ]);

    let statusChange: ProviderStatus | null = null;
    let extra: Record<string, unknown> = {};
    if (last90 >= 5) {
      statusChange = ProviderStatus.DEACTIVATED;
    } else if (last30 >= 3 && provider.status !== ProviderStatus.DEACTIVATED) {
      // Only suspend if not already DEACTIVATED — as older strikes age out of the 90-day
      // window, last90 can dip below 5 while last30 is still ≥3, which would otherwise
      // DOWNGRADE a deactivated provider back to a temporary 7-day suspension.
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

  // Deduct unsettled strike fees from a payout, but never more than the payout can
  // cover (`availableCents`). Fully-covered strikes are settled; a partially-covered
  // one has its remaining balance reduced and carries forward to the next payout, so
  // no fee is ever silently dropped. Returns the amount actually deducted.
  async settleForPayout(providerId: string, availableCents: number): Promise<number> {
    if (availableCents <= 0) return 0;
    const open = await this.prisma.strike.findMany({
      where: { providerId, settledAt: null, feeCents: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      select: { id: true, feeCents: true },
    });

    let remaining = availableCents;
    let deducted = 0;
    for (const strike of open) {
      if (remaining <= 0) break;
      const take = Math.min(strike.feeCents, remaining);
      deducted += take;
      remaining -= take;
      if (take >= strike.feeCents) {
        await this.prisma.strike.update({ where: { id: strike.id }, data: { settledAt: new Date() } });
      } else {
        // Partial payment — reduce the outstanding balance, leave it unsettled.
        await this.prisma.strike.update({ where: { id: strike.id }, data: { feeCents: strike.feeCents - take } });
      }
    }
    return deducted;
  }

  // Draw a deduction (strike fee or dispute claw-back) from the provider's held deposit
  // balance — the deposit is the primary deduction source. Returns the amount actually
  // drawn; the caller recovers any remainder from the next payout. No-ops (returns 0)
  // when there's no captured deposit or the balance is empty.
  async drawFromDeposit(
    providerId: string,
    amountCents: number,
    opts: { reason: string; jobId?: string | null } = { reason: "deduction" },
  ): Promise<number> {
    if (amountCents <= 0) return 0;
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    const balance = provider?.depositBalanceCents ?? 0;
    if (!provider || provider.depositStatus !== PaymentStatus.CAPTURED || balance <= 0) return 0;
    const draw = Math.min(amountCents, balance);
    await this.prisma.provider.update({ where: { id: providerId }, data: { depositBalanceCents: balance - draw } });
    await this.prisma.payment.create({
      data: {
        userId: provider.userId,
        jobId: opts.jobId ?? null,
        type: PaymentType.DEPOSIT_DEDUCTION,
        status: PaymentStatus.CAPTURED,
        amountCents: draw,
        platformFeeCents: 0,
        providerNetCents: 0,
        capturedAt: new Date(),
      },
    });
    this.logger.warn(`Drew $${(draw / 100).toFixed(2)} from provider ${providerId} deposit for ${opts.reason} (balance ${balance} → ${balance - draw})`);
    return draw;
  }

  async remove(strikeId: string) {
    return this.prisma.strike.delete({ where: { id: strikeId } });
  }
}
