import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { Role, JobStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AuthUser } from "../common/decorators";

// In-app chat is withheld until the job is actually in progress (brief: "no phone
// numbers exchanged until job is in progress"). Reading history stays open to job
// parties at any status; only *sending* is gated to this window.
const CHAT_OPEN_STATUSES: JobStatus[] = [JobStatus.IN_PROGRESS, JobStatus.COMPLETE];

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private rt: RealtimeService,
    private notifications: NotificationsService,
  ) {}

  // Both parties of the job (or an admin). Reading is always allowed; sending is
  // gated to CHAT_OPEN_STATUSES in send() (no phone numbers are ever exchanged —
  // chat is the only channel).
  private async authorize(jobId: string, user: AuthUser) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { provider: true } });
    if (!job) throw new NotFoundException("job not found");
    const isCustomer = job.customerId === user.id;
    const isProvider = job.provider?.userId === user.id;
    if (!isCustomer && !isProvider && user.role !== Role.ADMIN) throw new ForbiddenException("not your job");
    return { job, isCustomer, isProvider };
  }

  async list(jobId: string, user: AuthUser) {
    await this.authorize(jobId, user);
    return this.prisma.message.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
      include: { sender: { select: { id: true, fullName: true, role: true } } },
    });
  }

  async send(jobId: string, user: AuthUser, body: string) {
    const { job } = await this.authorize(jobId, user);
    if (!CHAT_OPEN_STATUSES.includes(job.status))
      throw new BadRequestException("messaging opens once the job is in progress");
    const text = (body || "").trim();
    if (!text) throw new BadRequestException("empty message");

    const message = await this.prisma.message.create({
      data: { jobId, senderId: user.id, body: text },
      include: { sender: { select: { id: true, fullName: true, role: true } } },
    });

    this.rt.emit(this.rt.jobRoom(jobId), "message.new", message);

    // Notify the other party.
    const recipientId = user.id === job.customerId ? job.providerId && (await this.providerUserId(job.providerId)) : job.customerId;
    if (recipientId) {
      await this.notifications.notify({
        userId: recipientId,
        jobId,
        template: "NEW_MESSAGE",
        title: "New message",
        body: text.slice(0, 80),
      });
    }
    return message;
  }

  private async providerUserId(providerId: string) {
    const p = await this.prisma.provider.findUnique({ where: { id: providerId }, select: { userId: true } });
    return p?.userId ?? null;
  }
}
