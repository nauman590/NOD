import { Injectable, Logger } from "@nestjs/common";
import { PaymentStatus, PaymentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "./stripe.service";
import { StrikesService } from "../strikes/strikes.service";
import { platformFee, providerBaseNet, addOnsTotal } from "../common/money";

// Real Stripe when STRIPE_SECRET_KEY is set; otherwise a simulated ledger.
// Either way the Payment rows carry correct fee/payout math.
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private stripe: StripeService,
    private strikes: StrikesService,
  ) {}

  // Customer authorizes the base price at checkout (manual-capture hold).
  async authorizeBase(jobId: string, userId: string, baseCents: number, paymentMethodId?: string) {
    let stripePaymentIntentId: string | null = null;
    if (this.stripe.enabled) {
      const pi = await this.stripe.authorize(baseCents, { jobId, userId, kind: "base" }, paymentMethodId);
      stripePaymentIntentId = pi?.id ?? null;
      this.logger.log(`Stripe authorize ${pi?.id} status=${pi?.status} for job ${jobId}`);
    }
    return this.prisma.payment.create({
      data: {
        jobId,
        userId,
        type: PaymentType.BASE,
        status: PaymentStatus.AUTHORIZED,
        amountCents: baseCents,
        platformFeeCents: platformFee(baseCents),
        providerNetCents: providerBaseNet(baseCents),
        stripePaymentIntentId,
      },
    });
  }

  // Customer approves add-ons (provider keeps 100%) — charged immediately.
  async chargeAddOns(jobId: string, userId: string, addOns: { priceCents: number }[], paymentMethodId?: string) {
    const total = addOnsTotal(addOns);
    if (total <= 0) return null;
    let stripePaymentIntentId: string | null = null;
    if (this.stripe.enabled) {
      const pi = await this.stripe.charge(total, { jobId, userId, kind: "addon" }, paymentMethodId);
      stripePaymentIntentId = pi?.id ?? null;
      this.logger.log(`Stripe addon charge ${pi?.id} status=${pi?.status} for job ${jobId}`);
    }
    return this.prisma.payment.create({
      data: {
        jobId,
        userId,
        type: PaymentType.ADDON,
        status: PaymentStatus.CAPTURED,
        amountCents: total,
        platformFeeCents: 0,
        providerNetCents: total,
        stripePaymentIntentId,
        capturedAt: new Date(),
      },
    });
  }

  // Provider completes the job → capture the authorized base + queue provider payout.
  async captureAndPayout(jobId: string, providerUserId: string) {
    const payments = await this.prisma.payment.findMany({ where: { jobId } });
    const base = payments.find((p) => p.type === PaymentType.BASE);
    const addOns = payments.filter((p) => p.type === PaymentType.ADDON && p.status === PaymentStatus.CAPTURED);

    if (base && base.status === PaymentStatus.AUTHORIZED) {
      if (this.stripe.enabled && base.stripePaymentIntentId) {
        const cap = await this.stripe.capture(base.stripePaymentIntentId);
        this.logger.log(`Stripe capture ${cap?.id} status=${cap?.status} for job ${jobId}`);
      }
      await this.prisma.payment.update({
        where: { id: base.id },
        data: { status: PaymentStatus.CAPTURED, capturedAt: new Date() },
      });
    }

    const baseNet = base ? providerBaseNet(base.amountCents) : 0;
    const addOnNet = addOns.reduce((s, p) => s + p.amountCents, 0);
    const provider = await this.prisma.provider.findUnique({ where: { userId: providerUserId } });

    // Deduct any unsettled strike fees from this payout (floored at 0).
    const strikeDeductionCents = provider ? await this.strikes.settleForPayout(provider.id) : 0;
    const payoutCents = Math.max(0, baseNet + addOnNet - strikeDeductionCents);

    // Provider payout: with Stripe Connect this is a transfer to the provider's
    // connected account (platform keeps the 18% base fee). If the provider hasn't
    // completed Connect onboarding, fall back to a ledger-only entry.
    // Escrow: if a dispute is open on this job, hold the payout (no transfer) until resolved.
    const openDispute = await this.prisma.dispute.findFirst({
      where: { jobId, status: { in: ["OPEN", "UNDER_REVIEW"] } },
    });
    if (openDispute) this.logger.warn(`Payout for job ${jobId} held in escrow — dispute ${openDispute.id} open`);

    let stripeTransferId: string | null = null;
    if (!openDispute && this.stripe.enabled && payoutCents > 0 && provider?.stripeAccountId) {
      try {
        const status = await this.stripe.accountStatus(provider.stripeAccountId);
        if (status?.payoutsEnabled) {
          const transfer = await this.stripe.transfer(payoutCents, provider.stripeAccountId, { jobId, kind: "payout" });
          stripeTransferId = transfer?.id ?? null;
          this.logger.log(`Stripe transfer ${transfer?.id} of ${payoutCents} to ${provider.stripeAccountId}`);
        } else {
          this.logger.warn(`Provider ${provider.id} payouts not enabled — ledger-only payout for job ${jobId}`);
        }
      } catch (e) {
        this.logger.warn(`Transfer failed (${(e as Error).message}) — ledger-only payout for job ${jobId}`);
      }
    }

    const payout = await this.prisma.payment.create({
      data: {
        jobId,
        userId: providerUserId,
        type: PaymentType.PAYOUT,
        status: PaymentStatus.CAPTURED,
        amountCents: payoutCents,
        platformFeeCents: 0,
        providerNetCents: payoutCents,
        stripeTransferId,
        capturedAt: new Date(),
      },
    });
    return { payout, payoutCents, platformFeeCents: base ? platformFee(base.amountCents) : 0 };
  }

  // Release an authorized-but-uncaptured base hold (job won't complete).
  private async releaseBase(jobId: string) {
    const base = await this.prisma.payment.findFirst({ where: { jobId, type: PaymentType.BASE } });
    if (base && base.status === PaymentStatus.AUTHORIZED) {
      if (this.stripe.enabled && base.stripePaymentIntentId) {
        try {
          await this.stripe.cancelPaymentIntent(base.stripePaymentIntentId);
        } catch (e) {
          this.logger.warn(`Could not cancel base PI for job ${jobId}: ${(e as Error).message}`);
        }
      }
      await this.prisma.payment.update({ where: { id: base.id }, data: { status: PaymentStatus.CANCELLED } });
    }
  }

  // Cancellation tiers: BEFORE_CLAIM=$0; AFTER_CLAIM=$10 flat; AFTER_EN_ROUTE=25%; NO_SHOW=50%.
  // Customer pays the fee; provider keeps 100% of it. The base hold is released.
  async handleCancellation(jobId: string): Promise<{ feeCents: number }> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { adjustments: { where: { status: "APPROVED" } }, provider: true },
    });
    if (!job) return { feeCents: 0 };

    await this.releaseBase(jobId);

    const approvedAddOns = job.adjustments.reduce((s, a) => s + a.priceCents, 0);
    const total = job.basePriceCents + approvedAddOns;

    let feeCents = 0;
    if (job.cancellationTier === "AFTER_CLAIM") feeCents = 1000;
    else if (job.cancellationTier === "AFTER_EN_ROUTE") feeCents = Math.round(total * 0.25);
    else if (job.cancellationTier === "NO_SHOW") feeCents = Math.round(total * 0.5);
    if (feeCents <= 0) return { feeCents: 0 };

    let stripePaymentIntentId: string | null = null;
    if (this.stripe.enabled) {
      const pi = await this.stripe.charge(feeCents, { jobId, kind: "cancellation" });
      stripePaymentIntentId = pi?.id ?? null;
    }

    // Provider keeps 100% of the cancellation fee.
    let stripeTransferId: string | null = null;
    if (this.stripe.enabled && job.provider?.stripeAccountId) {
      try {
        const status = await this.stripe.accountStatus(job.provider.stripeAccountId);
        if (status?.payoutsEnabled) {
          const t = await this.stripe.transfer(feeCents, job.provider.stripeAccountId, { jobId, kind: "cancellation_payout" });
          stripeTransferId = t?.id ?? null;
        }
      } catch (e) {
        this.logger.warn(`Cancellation transfer failed for job ${jobId}: ${(e as Error).message}`);
      }
    }

    await this.prisma.payment.create({
      data: {
        jobId,
        userId: job.customerId,
        type: PaymentType.CANCELLATION_FEE,
        status: PaymentStatus.CAPTURED,
        amountCents: feeCents,
        platformFeeCents: 0,
        providerNetCents: feeCents,
        stripePaymentIntentId,
        stripeTransferId,
        capturedAt: new Date(),
      },
    });
    return { feeCents };
  }

  // Admin refund of a captured payment (full or partial).
  async refundPayment(paymentId: string, amountCents?: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("payment not found");
    let stripeRefundId: string | null = payment.stripeRefundId ?? null;
    if (this.stripe.enabled && payment.stripePaymentIntentId) {
      const refund = await this.stripe.refund(payment.stripePaymentIntentId, amountCents);
      stripeRefundId = refund?.id ?? null;
    }
    const refunded = (payment.refundedAmountCents ?? 0) + (amountCents ?? payment.amountCents);
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        stripeRefundId,
        refundedAmountCents: refunded,
        status: refunded >= payment.amountCents ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
      },
    });
  }

  // Credit the customer a late-arrival penalty by partially refunding the captured base.
  // Retries once — Stripe can briefly reject a refund on a just-captured PaymentIntent.
  async refundLatePenalty(jobId: string, cents: number) {
    if (cents <= 0) return;
    const base = await this.prisma.payment.findFirst({ where: { jobId, type: PaymentType.BASE } });
    if (!base) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.refundPayment(base.id, cents);
        return;
      } catch (e) {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
        else throw e;
      }
    }
  }

  async listForUser(userId: string) {
    return this.prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }
}
