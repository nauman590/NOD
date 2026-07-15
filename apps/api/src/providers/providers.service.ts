import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { ProviderStatus, PaymentStatus, PaymentType } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "../payments/stripe.service";
import { SetRatesDto, UpdateProfileDto } from "./dto";

@Injectable()
export class ProvidersService {
  constructor(
    private prisma: PrismaService,
    private stripe: StripeService,
    private config: ConfigService,
  ) {}

  private async providerByUser(userId: string) {
    const provider = await this.prisma.provider.findUnique({ where: { userId } });
    if (!provider) throw new NotFoundException("provider profile not found");
    return provider;
  }

  async me(userId: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { userId },
      include: { categoryRates: { include: { category: true } }, user: true },
    });
    if (!provider) throw new NotFoundException("provider profile not found");
    return provider;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const provider = await this.providerByUser(userId);
    return this.prisma.provider.update({ where: { id: provider.id }, data: dto });
  }

  // ---- Stripe Connect onboarding ----
  async connectOnboard(userId: string) {
    if (!this.stripe.enabled) throw new BadRequestException("Stripe is not configured");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    let provider = await this.providerByUser(userId);

    let accountId = provider.stripeAccountId;
    if (!accountId) {
      const account = await this.stripe.createConnectAccount(user?.email ?? undefined);
      accountId = account!.id;
      provider = await this.prisma.provider.update({ where: { id: provider.id }, data: { stripeAccountId: accountId } });
    }

    const base = this.config.get<string>("APP_BASE_URL") || "http://localhost:5173";
    const link = await this.stripe.createAccountLink(
      accountId,
      `${base}/provider/onboarding?connect=refresh`,
      `${base}/provider/onboarding?connect=return`,
    );
    return { url: link!.url };
  }

  async connectStatus(userId: string) {
    const provider = await this.providerByUser(userId);
    if (!provider.stripeAccountId || !this.stripe.enabled) {
      return { connected: false, payoutsEnabled: false, chargesEnabled: false, detailsSubmitted: false };
    }
    const status = await this.stripe.accountStatus(provider.stripeAccountId);
    return { connected: true, ...status };
  }

  // ---- $50 refundable deposit (real charge, held in the platform balance) ----
  async collectDeposit(userId: string, paymentMethodId?: string) {
    if (!this.stripe.enabled) throw new BadRequestException("Stripe is not configured");
    if (!paymentMethodId) throw new BadRequestException("A card is required to collect the deposit");
    const provider = await this.providerByUser(userId);
    if (provider.depositStatus === PaymentStatus.CAPTURED) {
      return { depositStatus: provider.depositStatus };
    }
    const amountCents = parseInt(this.config.get<string>("PROVIDER_DEPOSIT_CENTS") || "5000", 10);
    const pi = await this.stripe.charge(amountCents, { providerId: provider.id, kind: "deposit" }, paymentMethodId);
    const updated = await this.prisma.provider.update({
      where: { id: provider.id },
      data: { depositPaymentIntentId: pi!.id, depositStatus: PaymentStatus.CAPTURED, depositRefundedAt: null },
    });
    await this.prisma.payment.create({
      data: {
        userId,
        type: PaymentType.PROVIDER_DEPOSIT,
        status: PaymentStatus.CAPTURED,
        amountCents,
        platformFeeCents: 0,
        providerNetCents: 0,
        stripePaymentIntentId: pi!.id,
        capturedAt: new Date(),
      },
    });
    return { depositStatus: updated.depositStatus };
  }

  // Refund the deposit in full (admin / good-standing deactivation).
  async refundDeposit(providerId: string) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException("provider not found");
    if (provider.depositStatus !== PaymentStatus.CAPTURED || !provider.depositPaymentIntentId) return { refunded: false };
    if (this.stripe.enabled) {
      try {
        await this.stripe.refund(provider.depositPaymentIntentId);
      } catch {
        /* leave status if refund fails */
      }
    }
    await this.prisma.provider.update({
      where: { id: providerId },
      data: { depositStatus: PaymentStatus.REFUNDED, depositRefundedAt: new Date() },
    });
    return { refunded: true };
  }

  async getRates(userId: string) {
    const provider = await this.providerByUser(userId);
    return this.prisma.providerCategoryRate.findMany({
      where: { providerId: provider.id },
      include: { category: true },
    });
  }

  async setRates(userId: string, dto: SetRatesDto) {
    const provider = await this.providerByUser(userId);
    const results: Awaited<ReturnType<typeof this.prisma.providerCategoryRate.upsert>>[] = [];
    for (const r of dto.rates) {
      const rate = await this.prisma.providerCategoryRate.upsert({
        where: { providerId_categoryId: { providerId: provider.id, categoryId: r.categoryId } },
        update: { hourlyRateCents: r.hourlyRateCents, active: r.active ?? true },
        create: { providerId: provider.id, categoryId: r.categoryId, hourlyRateCents: r.hourlyRateCents, active: r.active ?? true },
      });
      results.push(rate);
    }
    return results;
  }

  // Average hourly rate over ACTIVE providers serving a category.
  // Returns null when no active provider serves it (caller falls back to category default).
  async avgHourlyRateCents(categoryId: string): Promise<number | null> {
    const rows = await this.prisma.providerCategoryRate.findMany({
      where: { categoryId, active: true, provider: { status: ProviderStatus.ACTIVE } },
      select: { hourlyRateCents: true },
    });
    if (rows.length === 0) return null;
    const sum = rows.reduce((s, r) => s + r.hourlyRateCents, 0);
    return Math.round(sum / rows.length);
  }

  // Categories this provider is active in (for the job feed).
  async activeCategoryIds(userId: string): Promise<string[]> {
    const provider = await this.prisma.provider.findUnique({
      where: { userId },
      include: { categoryRates: { where: { active: true } } },
    });
    if (!provider) return [];
    if (provider.status !== ProviderStatus.ACTIVE) return [];
    return provider.categoryRates.map((r) => r.categoryId);
  }

  async assertActiveProvider(userId: string) {
    const provider = await this.providerByUser(userId);
    if (provider.status !== ProviderStatus.ACTIVE) {
      throw new ForbiddenException("provider is not active");
    }
    return provider;
  }

  async earnings(userId: string) {
    const provider = await this.providerByUser(userId);
    const completed = await this.prisma.job.findMany({
      where: { providerId: provider.id, status: "COMPLETE" },
      include: { adjustments: { where: { status: "APPROVED" } } },
    });
    const payouts = await this.prisma.payment.aggregate({
      where: { type: "PAYOUT", userId },
      _sum: { amountCents: true },
    });
    return {
      completedJobs: completed.length,
      totalPayoutCents: payouts._sum.amountCents ?? 0,
      ratingAvg: provider.ratingAvg,
      ratingCount: provider.ratingCount,
    };
  }
}
