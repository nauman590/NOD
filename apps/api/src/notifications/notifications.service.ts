import { Injectable } from "@nestjs/common";
import { NotificationChannel } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

// Twilio is stubbed for now: every "send" is recorded as an IN_APP notification row.
// Swapping in Twilio later means adding an SMS sender here, no caller changes.
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async notify(params: {
    userId: string;
    jobId?: string;
    template: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    channel?: NotificationChannel;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: params.userId,
        jobId: params.jobId ?? null,
        template: params.template,
        title: params.title,
        body: params.body,
        payload: (params.payload ?? {}) as any,
        channel: params.channel ?? NotificationChannel.IN_APP,
        status: "SENT",
        sentAt: new Date(),
      },
    });
  }

  list(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
