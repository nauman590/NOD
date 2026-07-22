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

  // Admin-generated Connect onboarding link for a recruited provider (brief: Sprint 5 —
  // "Provider Stripe Connect onboarding link Kimball can send to recruited providers").
  async adminConnectLink(providerId: string) {
    if (!this.stripe.enabled) throw new BadRequestException("Stripe is not configured");
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId }, include: { user: true } });
    if (!provider) throw new NotFoundException("provider not found");
    let accountId = provider.stripeAccountId;
    if (!accountId) {
      const account = await this.stripe.createConnectAccount(provider.user?.email ?? undefined);
      accountId = account!.id;
      await this.prisma.provider.update({ where: { id: provider.id }, data: { stripeAccountId: accountId } });
    }
    const base = this.config.get<string>("APP_BASE_URL") || "http://localhost:5173";
    const link = await this.stripe.createAccountLink(
      accountId,
      `${base}/provider/onboarding?connect=refresh`,
      `${base}/provider/onboarding?connect=return`,
    );
    return { url: link!.url, providerId: provider.id };
  }

  async connectStatus(userId: string) {
    const provider = await this.providerByUser(userId);
    if (!provider.stripeAccountId || !this.stripe.enabled) {
      return { connected: false, payoutsEnabled: false, chargesEnabled: false, detailsSubmitted: false };
    }
    const status = await this.stripe.accountStatus(provider.stripeAccountId);
    return { connected: true, ...status };
  }

  // ---- $50 refundable deposit ----
  // Hybrid flow (per product decision): a SetupIntent first SAVES the provider's card
  // on file, then we immediately charge the $50 off-session and hold it in the platform
  // balance (refundable on good-standing exit). The saved card also stays on the
  // Customer for any future off-session deduction.
  async collectDeposit(userId: string, paymentMethodId?: string) {
    if (!this.stripe.enabled) throw new BadRequestException("Stripe is not configured");
    if (!paymentMethodId) throw new BadRequestException("A card is required to collect the deposit");
    const provider = await this.providerByUser(userId);
    if (provider.depositStatus === PaymentStatus.CAPTURED) {
      return { depositStatus: provider.depositStatus };
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const amountCents = parseInt(this.config.get<string>("PROVIDER_DEPOSIT_CENTS") || "5000", 10);

    // 1) Ensure a Stripe Customer so the card can be saved & reused.
    let customerId = provider.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.createCustomer(user?.email, { providerId: provider.id });
      customerId = customer!.id;
    }

    // 2) SetupIntent saves the card on the Customer (off-session usage), no charge.
    const setup = await this.stripe.createDepositSetupIntent(
      { providerId: provider.id, kind: "deposit_setup" },
      paymentMethodId,
      customerId,
      `deposit_setup:${provider.id}`,
    );
    const savedCard =
      (typeof setup!.payment_method === "string" ? setup!.payment_method : setup!.payment_method?.id) || paymentMethodId;

    // 3) Immediately charge the $50 off-session using the saved card; held in the
    // platform balance. Idempotency-keyed so a retry never double-charges.
    const pi = await this.stripe.chargeSavedCard(
      amountCents,
      customerId,
      savedCard,
      { providerId: provider.id, kind: "deposit" },
      `deposit:${provider.id}`,
    );

    const updated = await this.prisma.provider.update({
      where: { id: provider.id },
      data: {
        stripeCustomerId: customerId,
        depositSetupId: setup!.id,
        depositPaymentIntentId: pi!.id,
        depositStatus: PaymentStatus.CAPTURED,
        depositBalanceCents: amountCents,
        depositRefundedAt: null,
      },
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

  // Refund the REMAINING held deposit (admin / good-standing deactivation). Only the
  // balance that wasn't already consumed by strike/claw-back deductions is returned.
  async refundDeposit(providerId: string) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException("provider not found");
    if (provider.depositStatus !== PaymentStatus.CAPTURED || !provider.depositPaymentIntentId) return { refunded: false };
    const refundCents = provider.depositBalanceCents ?? 0;
    // Only flip the deposit to REFUNDED once the money has actually moved. If the Stripe
    // refund throws we must NOT mark it refunded: the DB would claim the $50 was returned
    // while the funds are still held, and the CAPTURED guard above blocks any retry — the
    // provider would lose the deposit permanently. Surface the failure so the caller (admin
    // deactivate / manual refund) can retry once the underlying issue is resolved.
    if (this.stripe.enabled && refundCents > 0) {
      try {
        await this.stripe.refund(provider.depositPaymentIntentId, refundCents);
      } catch (e) {
        throw new BadRequestException(`Deposit refund failed; deposit left CAPTURED for retry: ${(e as Error).message}`);
      }
    }
    await this.prisma.provider.update({
      where: { id: providerId },
      data: { depositStatus: PaymentStatus.REFUNDED, depositBalanceCents: 0, depositRefundedAt: new Date() },
    });
    return { refunded: true, refundedCents: refundCents };
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

  // Active providers serving a category (for the "new job available" broadcast), capped at
  // `limit` so the fan-out stays bounded.
  //
  // The cap must ROTATE. An unordered `take: limit` returns the same arbitrary slice every
  // time, so once a category has more than `limit` active providers the earliest ones win
  // every broadcast and everyone after them is never notified again — they'd only ever find
  // work by manually refreshing the job feed. Ordering by each provider's most recent
  // NEW_JOB_AVAILABLE (never-notified first) turns the cap into a fair round-robin.
  async activeProvidersForCategory(categoryId: string, limit = 25): Promise<{ id: string; userId: string }[]> {
    return this.prisma.$queryRaw<{ id: string; userId: string }[]>`
      SELECT p."id", p."userId"
      FROM "ProviderCategoryRate" r
      JOIN "Provider" p ON p."id" = r."providerId"
      LEFT JOIN LATERAL (
        SELECT MAX(n."createdAt") AS last_at
        FROM "Notification" n
        WHERE n."userId" = p."userId" AND n."template" = 'NEW_JOB_AVAILABLE'
      ) l ON TRUE
      WHERE r."categoryId" = ${categoryId}
        AND r."active" = true
        AND p."status" = 'ACTIVE'::"ProviderStatus"
      ORDER BY l.last_at ASC NULLS FIRST, p."id" ASC
      LIMIT ${limit}
    `;
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

  // Whether a funded $50 deposit is required before a provider can claim jobs.
  // Off by default (dev/demo/E2E claim without a deposit); operators enable it in prod.
  get depositRequiredToClaim(): boolean {
    return (this.config.get<string>("REQUIRE_DEPOSIT_TO_CLAIM") || "false").trim().toLowerCase() === "true";
  }

  // Gate used specifically at claim time: active AND (when required) a captured deposit
  // on file. Deliberately NOT part of assertActiveProvider, so a provider mid-job can
  // still progress (en-route/arrive/complete) even if this flag flips on later.
  async assertCanClaim(userId: string) {
    const provider = await this.assertActiveProvider(userId);
    if (this.depositRequiredToClaim && provider.depositStatus !== PaymentStatus.CAPTURED) {
      throw new ForbiddenException("Pay your $50 refundable deposit before claiming jobs.");
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

  // ---- Instant payout to debit card (alongside the standard weekly schedule) ----

  // Current balance on the provider's connected account, split into instant-eligible
  // and standard buckets. Drives the "cash out" UI.
  async payoutBalance(userId: string) {
    const provider = await this.providerByUser(userId);
    if (!provider.stripeAccountId || !this.stripe.enabled) {
      return { instantAvailableCents: 0, availableCents: 0, pendingCents: 0, payoutsEnabled: false };
    }
    const status = await this.stripe.accountStatus(provider.stripeAccountId);
    const balance = await this.stripe.connectBalance(provider.stripeAccountId);
    return {
      instantAvailableCents: balance?.instantAvailableCents ?? 0,
      availableCents: balance?.availableCents ?? 0,
      pendingCents: balance?.pendingCents ?? 0,
      payoutsEnabled: !!status?.payoutsEnabled,
    };
  }

  // Trigger an instant payout of the connected account's instant-available balance to
  // the provider's debit card. Amount defaults to the full instant-available balance.
  async instantPayout(userId: string, amountCents?: number) {
    if (!this.stripe.enabled) throw new BadRequestException("Stripe is not configured");
    const provider = await this.providerByUser(userId);
    if (!provider.stripeAccountId) throw new BadRequestException("Connect payouts must be set up first");

    const status = await this.stripe.accountStatus(provider.stripeAccountId);
    if (!status?.payoutsEnabled) throw new BadRequestException("Payouts are not enabled on your Stripe account yet");

    const balance = await this.stripe.connectBalance(provider.stripeAccountId);
    const instantAvailable = balance?.instantAvailableCents ?? 0;
    if (instantAvailable <= 0) throw new BadRequestException("No funds are available for instant payout right now");

    const amount = amountCents ?? instantAvailable;
    if (amount <= 0) throw new BadRequestException("Payout amount must be greater than zero");
    if (amount > instantAvailable) {
      throw new BadRequestException(`Amount exceeds instant-available balance (${instantAvailable} cents)`);
    }

    let payout;
    try {
      payout = await this.stripe.createInstantPayout(
        provider.stripeAccountId,
        amount,
        { providerId: provider.id, kind: "instant_payout" },
      );
    } catch (e) {
      // Surface Stripe's reason (e.g. no instant-eligible debit card on file).
      throw new BadRequestException((e as Error).message || "Instant payout failed");
    }

    return {
      payoutId: payout?.id ?? null,
      amountCents: amount,
      status: payout?.status ?? null,
      method: "instant" as const,
      arrivalDate: payout?.arrival_date ?? null,
    };
  }
}
