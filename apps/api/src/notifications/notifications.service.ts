import { Injectable } from "@nestjs/common";
import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { SmsService } from "./sms.service";

// Records every notification as an IN_APP row (+ realtime push) and ALSO delivers it as a
// Twilio SMS when the recipient has a phone on file and is opted in (brief: SMS on all
// notification triggers). When Twilio isn't configured the SMS is a graceful stub, so the
// in-app + realtime path is unaffected.
@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private rt: RealtimeService,
    private sms: SmsService,
  ) {}

  async notify(params: {
    userId: string;
    jobId?: string;
    template: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    channel?: NotificationChannel;
  }) {
    const note = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        jobId: params.jobId ?? null,
        template: params.template,
        title: params.title,
        body: params.body,
        payload: (params.payload ?? {}) as any,
        channel: params.channel ?? NotificationChannel.IN_APP,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });
    // Push it in real time to whichever of the user's devices are connected.
    this.rt.emit(this.rt.userRoom(params.userId), "notification.new", note);

    // Fan out to SMS when the recipient opted in and has a number. Best-effort: an SMS
    // failure never breaks the in-app notification. Skipped entirely when Twilio is off.
    if (this.sms.enabled) {
      this.deliverSms(params.userId, params.title, params.body).catch(() => undefined);
    }
    return note;
  }

  private async deliverSms(userId: string, title: string, body: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, smsOptIn: true },
    });
    if (!user?.phone || !user.smsOptIn) return;
    const text = title ? `${title}: ${body}` : body;
    await this.sms.send(user.phone, `NOD — ${text}`);
  }

  /** Direct SMS to a number (used for phone-verification OTP). Bypasses opt-in — a user
   *  requesting an OTP has consented to that single message. */
  async sendDirectSms(phone: string, body: string) {
    return this.sms.send(phone, body);
  }

  get smsEnabled() {
    return this.sms.enabled;
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
