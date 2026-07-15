import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
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

  async open(jobId: string, user: AuthUser, reason: string, description?: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { provider: true } });
    if (!job) throw new NotFoundException("job not found");
    const isCustomer = job.customerId === user.id;
    const isProvider = job.provider?.userId === user.id;
    if (!isCustomer && !isProvider && user.role !== Role.ADMIN) throw new ForbiddenException("not your job");

    return this.prisma.dispute.create({
      data: { jobId, raisedById: user.id, reason, description: description ?? null },
    });
  }

  mine(userId: string) {
    return this.prisma.dispute.findMany({
      where: { raisedById: userId },
      orderBy: { createdAt: "desc" },
      include: { job: { include: { category: true } } },
    });
  }

  queue() {
    return this.prisma.dispute.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { job: { include: { category: true, customer: true, provider: { include: { user: true } } } }, raisedBy: true },
    });
  }

  async resolve(id: string, adminId: string, status: DisputeStatus, resolution?: string, refundCents?: number) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException("dispute not found");

    // Optional refund as part of the resolution (refunds the job's base payment).
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

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: { status, resolution: resolution ?? null, resolvedById: adminId, resolvedAt: new Date() },
    });
    await this.notifications.notify({
      userId: dispute.raisedById,
      jobId: dispute.jobId,
      template: "DISPUTE_RESOLVED",
      title: "Your report was reviewed",
      body: (resolution || `Status: ${status}`) + (refunded ? ` · Refund issued: $${(refunded / 100).toFixed(2)}` : ""),
    });
    return { ...updated, refundedCents: refunded };
  }
}
