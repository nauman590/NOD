import { Injectable, Logger } from "@nestjs/common";
import { PaymentStatus, PaymentType } from "@prisma/client";
import { createHash } from "crypto";
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

  // Ensure the customer has a Stripe Customer (needed to save a card for reuse).
  // Reuses the stored id when present; otherwise creates one and persists it.
  private async ensureCustomerForUser(userId: string): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.stripeCustomerId) return user.stripeCustomerId;
    const customer = await this.stripe.createCustomer(user?.email, { userId });
    const id = customer?.id;
    if (id) await this.prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: id } });
    return id ?? undefined;
  }

  // Charge the customer's saved card off-session (add-ons, cancellation, dispute charges).
  // Falls back to the test-mode default card only when no card was saved at checkout
  // (dev/E2E, where jobs are created via API without a payment method) — in production a
  // real card is always on file, so this path bills the customer correctly.
  private async chargeCustomer(
    userId: string,
    amountCents: number,
    metadata: Record<string, string>,
    idempotencyKey?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.stripeCustomerId && user?.stripePaymentMethodId) {
      return this.stripe.chargeSavedCard(amountCents, user.stripeCustomerId, user.stripePaymentMethodId, metadata, idempotencyKey);
    }
    this.logger.warn(`No saved card for user ${userId} — falling back to default card for '${metadata.kind ?? "charge"}' (dev/test only).`);
    return this.stripe.charge(amountCents, metadata, undefined, idempotencyKey);
  }

  // Customer authorizes the base price at checkout (manual-capture hold). When a real
  // card is supplied we attach a Stripe Customer and save the card (setup_future_usage)
  // so later off-session charges can reuse it.
  async authorizeBase(jobId: string, userId: string, baseCents: number, paymentMethodId?: string) {
    let stripePaymentIntentId: string | null = null;
    if (this.stripe.enabled) {
      // Only create/attach a Customer when a real card is provided (not the API/E2E path
      // that relies on the test-card fallback).
      const customerId = paymentMethodId ? await this.ensureCustomerForUser(userId) : undefined;
      const pi = await this.stripe.authorize(baseCents, { jobId, userId, kind: "base" }, paymentMethodId, `base:${jobId}`, customerId);
      stripePaymentIntentId = pi?.id ?? null;
      this.logger.log(`Stripe authorize ${pi?.id} status=${pi?.status} for job ${jobId}`);
      // Persist the now-saved card so add-on/cancellation/dispute charges can bill it.
      if (paymentMethodId && customerId) {
        const savedPm = typeof pi?.payment_method === "string" ? pi?.payment_method : pi?.payment_method?.id;
        await this.prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customerId, stripePaymentMethodId: savedPm ?? paymentMethodId },
        });
      }
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

  // Customer approves add-ons (provider keeps 100%) — charged immediately to the saved card.
  async chargeAddOns(jobId: string, userId: string, addOns: { id: string; priceCents: number }[]) {
    const total = addOnsTotal(addOns);
    if (total <= 0) return null;
    // Idempotency keyed to the SPECIFIC adjustments being charged (not the total), so two
    // distinct approval batches that happen to sum to the same amount are separate charges,
    // while a genuine retry of the same batch stays idempotent (no duplicate charge).
    const batchKey = createHash("sha1").update(addOns.map((a) => a.id).sort().join(",")).digest("hex").slice(0, 24);
    let stripePaymentIntentId: string | null = null;
    if (this.stripe.enabled) {
      const pi = await this.chargeCustomer(userId, total, { jobId, userId, kind: "addon" }, `addon:${jobId}:${batchKey}`);
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

    // Idempotency: a PAYOUT row already exists → this job was already completed.
    // Never capture the base or transfer a payout twice (protects real Stripe money).
    const existingPayout = payments.find((p) => p.type === PaymentType.PAYOUT);
    if (existingPayout) {
      this.logger.warn(`captureAndPayout: job ${jobId} already has a payout (${existingPayout.id}) — skipping.`);
      return {
        payout: existingPayout,
        payoutCents: existingPayout.amountCents,
        held: existingPayout.status === PaymentStatus.AUTHORIZED,
        platformFeeCents: base ? platformFee(base.amountCents) : 0,
        alreadyProcessed: true as const,
      };
    }

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
    const grossPayout = baseNet + addOnNet;
    const provider = await this.prisma.provider.findUnique({ where: { userId: providerUserId } });

    // Deduct unsettled strike fees, then dispute claw-backs, both capped at this payout
    // so nothing is dropped; any excess is carried to the provider's next payout.
    const strikeDeductionCents = provider ? await this.strikes.settleForPayout(provider.id, grossPayout) : 0;
    const clawbackDeductionCents = provider ? await this.settleClawbacksForPayout(provider.id, grossPayout - strikeDeductionCents) : 0;
    const payoutCents = Math.max(0, grossPayout - strikeDeductionCents - clawbackDeductionCents);

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
          const transfer = await this.stripe.transfer(payoutCents, provider.stripeAccountId, { jobId, kind: "payout" }, `payout:${jobId}`);
          stripeTransferId = transfer?.id ?? null;
          this.logger.log(`Stripe transfer ${transfer?.id} of ${payoutCents} to ${provider.stripeAccountId}`);
        } else {
          this.logger.warn(`Provider ${provider.id} payouts not enabled — ledger-only payout for job ${jobId}`);
        }
      } catch (e) {
        this.logger.warn(`Transfer failed (${(e as Error).message}) — ledger-only payout for job ${jobId}`);
      }
    }

    // Held in escrow (dispute open) → record as AUTHORIZED/owed, not CAPTURED/paid.
    // It's released to CAPTURED by releaseHeldPayout() once the dispute resolves.
    const held = !!openDispute;
    const payout = await this.prisma.payment.create({
      data: {
        jobId,
        userId: providerUserId,
        type: PaymentType.PAYOUT,
        status: held ? PaymentStatus.AUTHORIZED : PaymentStatus.CAPTURED,
        amountCents: payoutCents,
        platformFeeCents: 0,
        providerNetCents: payoutCents,
        stripeTransferId,
        capturedAt: held ? null : new Date(),
      },
    });
    return { payout, payoutCents, held, platformFeeCents: base ? platformFee(base.amountCents) : 0 };
  }

  // Release a payout that was held in escrow while a dispute was open. Safe to call
  // after any dispute update — it no-ops if a dispute is still open or nothing is held.
  async releaseHeldPayout(jobId: string) {
    const stillOpen = await this.prisma.dispute.findFirst({
      where: { jobId, status: { in: ["OPEN", "UNDER_REVIEW"] } },
    });
    if (stillOpen) return { released: false as const, reason: "dispute_open" };

    const payout = await this.prisma.payment.findFirst({
      where: { jobId, type: PaymentType.PAYOUT, status: PaymentStatus.AUTHORIZED },
    });
    if (!payout) return { released: false as const, reason: "no_held_payout" };

    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { provider: true } });
    let stripeTransferId: string | null = payout.stripeTransferId ?? null;
    if (this.stripe.enabled && payout.amountCents > 0 && job?.provider?.stripeAccountId) {
      try {
        const status = await this.stripe.accountStatus(job.provider.stripeAccountId);
        if (status?.payoutsEnabled) {
          const t = await this.stripe.transfer(payout.amountCents, job.provider.stripeAccountId, { jobId, kind: "payout_release" }, `payout_release:${jobId}`);
          stripeTransferId = t?.id ?? null;
          this.logger.log(`Released escrow payout ${payout.id} (${payout.amountCents}) for job ${jobId}`);
        }
      } catch (e) {
        this.logger.warn(`Escrow release transfer failed for job ${jobId}: ${(e as Error).message}`);
      }
    }
    const updated = await this.prisma.payment.update({
      where: { id: payout.id },
      data: { status: PaymentStatus.CAPTURED, capturedAt: new Date(), stripeTransferId },
    });
    return { released: true as const, payoutCents: updated.amountCents };
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
  // The fee is a percentage of the BASE service price ONLY — add-ons the customer already
  // paid are refunded here (see refundCapturedAddOns), never re-billed as part of the fee.
  // Customer pays the fee; provider keeps 100% of it. The base hold is released.
  async handleCancellation(jobId: string): Promise<{ feeCents: number; refundedAddOnCents: number }> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { provider: true },
    });
    if (!job) return { feeCents: 0, refundedAddOnCents: 0 };

    await this.releaseBase(jobId);

    // The cancelled job won't be delivered, so refund every add-on the customer already paid
    // (captured at approval). Otherwise that money strands in the platform balance — the
    // provider is only ever paid add-ons at completion, which now never happens. Runs for
    // EVERY cancellation (customer, provider, or no-show) and before any fee/early-return.
    const refundedAddOnCents = await this.refundCapturedAddOns(jobId);

    // Fee is a percentage of the base service price only (add-ons were just refunded, so
    // charging a slice of them would double-bill).
    let feeCents = 0;
    if (job.cancellationTier === "AFTER_CLAIM") feeCents = 1000;
    else if (job.cancellationTier === "AFTER_EN_ROUTE") feeCents = Math.round(job.basePriceCents * 0.25);
    else if (job.cancellationTier === "NO_SHOW") feeCents = Math.round(job.basePriceCents * 0.5);

    // If the provider arrived late, the customer earned a 10% credit that's normally applied at
    // completion. A cancel never completes, so honour that credit here by netting it off the
    // cancellation fee (floored at 0) — otherwise the provider's late penalty is charged with no
    // matching customer credit (the desync between arrived() and complete()).
    if (feeCents > 0 && job.latePenaltyCents > 0) feeCents = Math.max(0, feeCents - job.latePenaltyCents);

    if (feeCents <= 0) return { feeCents: 0, refundedAddOnCents };

    // Charge the customer's saved card. The job is already committed CANCELLED, so a
    // charge failure must NOT throw (that would 500 and lose the fee) — record a FAILED
    // fee row for reconciliation and skip the provider transfer.
    let stripePaymentIntentId: string | null = null;
    if (this.stripe.enabled) {
      try {
        const pi = await this.chargeCustomer(job.customerId, feeCents, { jobId, kind: "cancellation" }, `cancel:${jobId}`);
        stripePaymentIntentId = pi?.id ?? null;
      } catch (e) {
        this.logger.warn(`Cancellation fee charge failed for job ${jobId}: ${(e as Error).message}`);
        await this.prisma.payment.create({
          data: {
            jobId,
            userId: job.customerId,
            type: PaymentType.CANCELLATION_FEE,
            status: PaymentStatus.FAILED,
            amountCents: feeCents,
            platformFeeCents: 0,
            providerNetCents: feeCents,
          },
        });
        return { feeCents: 0, refundedAddOnCents };
      }
    }

    // Provider keeps 100% of the cancellation fee.
    let stripeTransferId: string | null = null;
    if (this.stripe.enabled && job.provider?.stripeAccountId) {
      try {
        const status = await this.stripe.accountStatus(job.provider.stripeAccountId);
        if (status?.payoutsEnabled) {
          const t = await this.stripe.transfer(feeCents, job.provider.stripeAccountId, { jobId, kind: "cancellation_payout" }, `cancel_payout:${jobId}`);
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
    return { feeCents, refundedAddOnCents };
  }

  // Refund every add-on the customer already paid on a job that's being cancelled (the extra
  // work won't happen). Returns the total refunded. Idempotent: only CAPTURED add-on rows are
  // refunded, so a re-run skips ones already REFUNDED. Never throws — the job is already
  // committed CANCELLED, so a Stripe hiccup is logged for reconciliation, not surfaced as a 500.
  private async refundCapturedAddOns(jobId: string): Promise<number> {
    const addOns = await this.prisma.payment.findMany({
      where: { jobId, type: PaymentType.ADDON, status: PaymentStatus.CAPTURED },
    });
    let refundedCents = 0;
    for (const addOn of addOns) {
      try {
        await this.refundPayment(addOn.id);
        refundedCents += addOn.amountCents;
      } catch (e) {
        this.logger.warn(`Add-on refund failed for payment ${addOn.id} on job ${jobId}: ${(e as Error).message}`);
      }
    }
    if (refundedCents > 0) this.logger.log(`Refunded ${refundedCents}c of add-ons on cancelled job ${jobId}`);
    return refundedCents;
  }

  // ---- Dispute resolution money movement (Sprint 5) ----

  // "Additional charge" outcome: charge the customer an extra amount and credit it to
  // the provider (100%, like a cancellation fee). Idempotency-keyed per dispute.
  async chargeDispute(jobId: string, amountCents: number, disputeId: string): Promise<{ chargedCents: number }> {
    if (amountCents <= 0) return { chargedCents: 0 };
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { provider: true } });
    if (!job) return { chargedCents: 0 };

    let stripePaymentIntentId: string | null = null;
    if (this.stripe.enabled) {
      const pi = await this.chargeCustomer(job.customerId, amountCents, { jobId, disputeId, kind: "dispute_charge" }, `dispute_charge:${disputeId}`);
      stripePaymentIntentId = pi?.id ?? null;
    }
    let stripeTransferId: string | null = null;
    if (this.stripe.enabled && job.provider?.stripeAccountId) {
      try {
        const status = await this.stripe.accountStatus(job.provider.stripeAccountId);
        if (status?.payoutsEnabled) {
          const t = await this.stripe.transfer(amountCents, job.provider.stripeAccountId, { jobId, disputeId, kind: "dispute_charge_payout" }, `dispute_charge_payout:${disputeId}`);
          stripeTransferId = t?.id ?? null;
        }
      } catch (e) {
        this.logger.warn(`Dispute charge transfer failed for job ${jobId}: ${(e as Error).message}`);
      }
    }
    await this.prisma.payment.create({
      data: {
        jobId,
        userId: job.customerId,
        type: PaymentType.DISPUTE_CHARGE,
        status: PaymentStatus.CAPTURED,
        amountCents,
        platformFeeCents: 0,
        providerNetCents: amountCents,
        stripePaymentIntentId,
        stripeTransferId,
        capturedAt: new Date(),
      },
    });
    return { chargedCents: amountCents };
  }

  // Record a ledger claw-back when a dispute on an ALREADY-PAID-OUT job resolves to a
  // refund. The amount is recovered from the provider's next payout(s) — no Stripe
  // transfer reversal. No-op (returns 0) if the payout hasn't been captured/paid yet
  // (that case is handled by the escrow hold on the payout instead).
  async recordDisputeClawback(disputeId: string, jobId: string, amountCents: number): Promise<{ clawbackCents: number; providerUserId: string | null }> {
    if (amountCents <= 0) return { clawbackCents: 0, providerUserId: null as string | null };
    const paidOut = await this.prisma.payment.findFirst({
      where: { jobId, type: PaymentType.PAYOUT, status: PaymentStatus.CAPTURED },
    });
    if (!paidOut) return { clawbackCents: 0, providerUserId: null as string | null };
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { provider: { include: { user: true } } } });
    if (!job?.providerId) return { clawbackCents: 0, providerUserId: null as string | null };

    // Never claw back more than the provider actually netted on this job.
    const amount = Math.min(amountCents, paidOut.amountCents);
    if (amount <= 0) return { clawbackCents: 0, providerUserId: null as string | null };
    const cb = await this.prisma.disputeClawback.create({ data: { disputeId, providerId: job.providerId, amountCents: amount } });

    // Deposit is the primary deduction source: draw what it can cover now and settle that
    // portion of the claw-back; any remainder stays on the ledger for the next payout.
    const drawn = await this.strikes.drawFromDeposit(job.providerId, amount, { reason: `dispute_clawback:${disputeId}`, jobId });
    if (drawn > 0) {
      const remaining = amount - drawn;
      await this.prisma.disputeClawback.update({
        where: { id: cb.id },
        data: remaining > 0 ? { amountCents: remaining } : { amountCents: 0, settledAt: new Date() },
      });
    }
    this.logger.warn(`Dispute ${disputeId}: recorded $${(amount / 100).toFixed(2)} claw-back against provider ${job.providerId} (from deposit $${(drawn / 100).toFixed(2)})`);
    return { clawbackCents: amount, providerUserId: job.provider?.userId ?? null };
  }

  // Recover a dispute refund from the provider, picking the correct mechanism so the two
  // never double-fire:
  //  - Payout still HELD in escrow (pre-completion dispute, not yet paid) → reduce the
  //    held amount in place BEFORE it's released, so the provider is released only the net.
  //  - Payout already CAPTURED (paid out) → ledger claw-back recovered from next payout.
  // MUST run before releaseHeldPayout() so a held payout is seen as held, not released.
  async applyRefundToProviderPayout(
    disputeId: string,
    jobId: string,
    refundCents: number,
  ): Promise<{ clawbackCents: number; reducedCents: number; providerUserId: string | null }> {
    if (refundCents <= 0) return { clawbackCents: 0, reducedCents: 0, providerUserId: null };
    const held = await this.prisma.payment.findFirst({
      where: { jobId, type: PaymentType.PAYOUT, status: PaymentStatus.AUTHORIZED },
    });
    if (held) {
      const reduce = Math.min(refundCents, held.amountCents);
      await this.prisma.payment.update({
        where: { id: held.id },
        data: { amountCents: held.amountCents - reduce, providerNetCents: held.amountCents - reduce },
      });
      this.logger.warn(`Dispute ${disputeId}: reduced held escrow payout for job ${jobId} by $${(reduce / 100).toFixed(2)} before release`);
      return { clawbackCents: 0, reducedCents: reduce, providerUserId: null };
    }
    const cb = await this.recordDisputeClawback(disputeId, jobId, refundCents);
    return { clawbackCents: cb.clawbackCents, reducedCents: 0, providerUserId: cb.providerUserId };
  }

  // Deduct unsettled dispute claw-backs from a payout, capped at what's available;
  // fully-covered claw-backs are settled, a partial one carries its remainder forward.
  async settleClawbacksForPayout(providerId: string, availableCents: number): Promise<number> {
    if (availableCents <= 0) return 0;
    const open = await this.prisma.disputeClawback.findMany({
      where: { providerId, settledAt: null, amountCents: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      select: { id: true, amountCents: true },
    });
    let remaining = availableCents;
    let deducted = 0;
    for (const cb of open) {
      if (remaining <= 0) break;
      const take = Math.min(cb.amountCents, remaining);
      deducted += take;
      remaining -= take;
      if (take >= cb.amountCents) {
        await this.prisma.disputeClawback.update({ where: { id: cb.id }, data: { settledAt: new Date() } });
      } else {
        await this.prisma.disputeClawback.update({ where: { id: cb.id }, data: { amountCents: cb.amountCents - take } });
      }
    }
    return deducted;
  }

  // Total unsettled claw-back balance a provider still owes (for admin/reporting).
  async outstandingClawbackCents(providerId: string): Promise<number> {
    const agg = await this.prisma.disputeClawback.aggregate({
      where: { providerId, settledAt: null },
      _sum: { amountCents: true },
    });
    return agg._sum.amountCents ?? 0;
  }

  // Admin refund of a captured payment (full or partial).
  async refundPayment(paymentId: string, amountCents?: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("payment not found");
    let stripeRefundId: string | null = payment.stripeRefundId ?? null;
    if (this.stripe.enabled && payment.stripePaymentIntentId) {
      const refund = await this.stripe.refund(payment.stripePaymentIntentId, amountCents, `refund:${paymentId}:${amountCents ?? "full"}`);
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

  // Reconcile local Payment rows from Stripe webhook events (a secondary source of
  // truth alongside the synchronous SDK responses). Safe to receive duplicates.
  async handleWebhook(event: { type: string; data: { object: any } }) {
    const obj = event.data?.object ?? {};
    switch (event.type) {
      case "payment_intent.succeeded": {
        await this.prisma.payment.updateMany({
          where: { stripePaymentIntentId: obj.id, status: { in: [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.AUTHORIZED] } },
          data: { status: PaymentStatus.CAPTURED, capturedAt: new Date(), stripeChargeId: obj.latest_charge ?? null },
        });
        break;
      }
      case "payment_intent.payment_failed": {
        await this.prisma.payment.updateMany({ where: { stripePaymentIntentId: obj.id }, data: { status: PaymentStatus.FAILED } });
        this.logger.warn(`Webhook: payment_intent.payment_failed ${obj.id}`);
        break;
      }
      case "charge.refunded": {
        if (obj.payment_intent) {
          const refunded = obj.amount_refunded ?? 0;
          await this.prisma.payment.updateMany({
            where: { stripePaymentIntentId: obj.payment_intent },
            data: {
              refundedAmountCents: refunded,
              status: refunded >= (obj.amount ?? 0) ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
            },
          });
        }
        break;
      }
      case "charge.dispute.created":
        this.logger.warn(`Webhook: chargeback opened for charge ${obj.id} (pi ${obj.payment_intent}).`);
        break;
      case "account.updated":
        this.logger.log(`Webhook: Connect account ${obj.id} updated (payouts_enabled=${obj.payouts_enabled}).`);
        break;
      default:
        this.logger.log(`Webhook: unhandled event ${event.type}`);
    }
    return { handled: true, type: event.type };
  }

  async listForUser(userId: string) {
    return this.prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }
}
