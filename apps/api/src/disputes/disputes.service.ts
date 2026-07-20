import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { DisputeStatus, Role, PaymentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PaymentsService } from "../payments/payments.service";
import { AuthUser } from "../common/decorators";

@Injectable()
export class DisputesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private payments: PaymentsService,
  ) {}

  // Assert the user is a party to the job (customer or provider) or an admin.
  private async assertJobParty(jobId: string, user: AuthUser) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { provider: true } });
    if (!job) throw new NotFoundException("job not found");
    const isCustomer = job.customerId === user.id;
    const isProvider = job.provider?.userId === user.id;
    if (!isCustomer && !isProvider && user.role !== Role.ADMIN) throw new ForbiddenException("not your job");
    return job;
  }

  async open(jobId: string, user: AuthUser, reason: string, description?: string, photoUrls?: string[]) {
    await this.assertJobParty(jobId, user);
    return this.prisma.dispute.create({
      data: {
        jobId,
        raisedById: user.id,
        reason,
        description: description ?? null,
        photos: photoUrls?.length
          ? { create: photoUrls.map((url) => ({ url, uploaderId: user.id })) }
          : undefined,
      },
      include: { photos: true },
    });
  }

  // Either party (or admin) attaches an evidence photo to an existing dispute.
  async addPhoto(disputeId: string, user: AuthUser, url: string) {
    if (!url) throw new BadRequestException("url required");
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException("dispute not found");
    await this.assertJobParty(dispute.jobId, user);
    return this.prisma.disputePhoto.create({ data: { disputeId, uploaderId: user.id, url } });
  }

  mine(userId: string) {
    return this.prisma.dispute.findMany({
      where: { raisedById: userId },
      orderBy: { createdAt: "desc" },
      include: { job: { include: { category: true } }, photos: true },
    });
  }

  // All disputes on a job — visible to either party or an admin (so a provider can see
  // and add evidence to a customer-opened dispute, and vice-versa).
  async listForJob(jobId: string, user: AuthUser) {
    await this.assertJobParty(jobId, user);
    return this.prisma.dispute.findMany({
      where: { jobId },
      orderBy: { createdAt: "desc" },
      include: { photos: { orderBy: { createdAt: "asc" } }, raisedBy: { select: { id: true, fullName: true, role: true } } },
    });
  }

  queue() {
    return this.prisma.dispute.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        job: { include: { category: true, customer: true, provider: { include: { user: true } } } },
        raisedBy: true,
        photos: { include: { uploader: { select: { id: true, fullName: true, role: true } } }, orderBy: { createdAt: "asc" } },
      },
    });
  }

  async resolve(
    id: string,
    adminId: string,
    status: DisputeStatus,
    resolution?: string,
    refundCents?: number,
    additionalChargeCents?: number,
  ) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException("dispute not found");
    if (refundCents && additionalChargeCents) {
      throw new BadRequestException("A resolution can refund or add a charge, not both.");
    }

    // Outcome A — refund (full/partial) the job's base payment.
    let refunded = 0;
    if (refundCents && refundCents > 0 && dispute.jobId) {
      const base = await this.prisma.payment.findFirst({
        where: { jobId: dispute.jobId, type: PaymentType.BASE, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } },
      });
      if (base) {
        await this.payments.refundPayment(base.id, refundCents);
        refunded = refundCents;
      }
    }

    // Outcome B — additional charge to the customer, credited to the provider.
    let charged = 0;
    if (additionalChargeCents && additionalChargeCents > 0 && dispute.jobId) {
      const c = await this.payments.chargeDispute(dispute.jobId, additionalChargeCents, dispute.id);
      charged = c.chargedCents;
    }

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: { status, resolution: resolution ?? null, resolvedById: adminId, resolvedAt: new Date() },
    });

    // Recover any refund from the provider FIRST (before releasing escrow), so a held
    // payout is reduced in place rather than released in full and then clawed back — those
    // two must never both fire. A still-held payout (pre-completion dispute) is reduced;
    // an already-paid-out one becomes a ledger claw-back on the next payout. Then release
    // whatever escrow remains now the dispute is resolved.
    let payoutReleased = false;
    let clawbackCents = 0;
    if (dispute.jobId) {
      if (refunded > 0) {
        const applied = await this.payments.applyRefundToProviderPayout(dispute.id, dispute.jobId, refunded);
        clawbackCents = applied.clawbackCents;
        if (clawbackCents > 0 && applied.providerUserId) {
          await this.notifications.notify({
            userId: applied.providerUserId,
            jobId: dispute.jobId,
            template: "DISPUTE_CLAWBACK",
            title: "Dispute resolved — payout adjustment",
            body: `A resolved dispute refunded the customer $${(clawbackCents / 100).toFixed(2)}. This is recovered from your held deposit and/or your next payout.`,
          });
        }
      }
      const release = await this.payments.releaseHeldPayout(dispute.jobId);
      payoutReleased = release.released;
    }

    const money =
      (refunded ? ` · Refund issued: $${(refunded / 100).toFixed(2)}` : "") +
      (charged ? ` · Additional charge: $${(charged / 100).toFixed(2)}` : "");
    await this.notifications.notify({
      userId: dispute.raisedById,
      jobId: dispute.jobId,
      template: "DISPUTE_RESOLVED",
      title: "Your report was reviewed",
      body: (resolution || `Status: ${status}`) + money,
    });
    return { ...updated, refundedCents: refunded, chargedCents: charged, clawbackCents, payoutReleased };
  }
}
