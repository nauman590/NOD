import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface SmsSendResult {
  sent: boolean;
  sid?: string;
  stubbed?: boolean;
  error?: string;
}

// Twilio SMS sender. Uses the Twilio REST API directly over fetch (no SDK dependency),
// so it is fully key-ready: set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + a sender
// (TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM) and real SMS goes out. Without a key it
// is a graceful stub that logs the message (dev/E2E) and reports stubbed=true, so every
// caller works unchanged whether or not Twilio is configured.
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly from: string;
  private readonly messagingServiceSid: string;

  constructor(private config: ConfigService) {
    this.accountSid = (config.get<string>("TWILIO_ACCOUNT_SID") || "").trim();
    this.authToken = (config.get<string>("TWILIO_AUTH_TOKEN") || "").trim();
    this.from = (config.get<string>("TWILIO_FROM") || "").trim();
    this.messagingServiceSid = (config.get<string>("TWILIO_MESSAGING_SERVICE_SID") || "").trim();
    if (this.enabled) {
      this.logger.log(`Twilio SMS enabled (${this.messagingServiceSid ? "messaging service" : `from ${this.from}`}).`);
      if (!this.messagingServiceSid) {
        // US carriers block application-to-person traffic from an unregistered long code.
        // Twilio still ACCEPTS these sends (we get a message SID and report sent:true) and
        // only drops them downstream, so without this warning the app looks healthy while
        // delivering nothing. 10DLC registration requires sending via a Messaging Service.
        this.logger.warn(
          "Twilio is sending from a bare from-number. US A2P traffic requires 10DLC " +
            "registration (Brand + Campaign) and must send via a Messaging Service — set " +
            "TWILIO_MESSAGING_SERVICE_SID once registered, or carriers will filter these messages.",
        );
      }
    } else {
      this.logger.warn("Twilio not configured — SMS is stubbed (messages logged, not sent).");
    }
  }

  // Enabled only when we have credentials AND a sender (a from-number or messaging service).
  get enabled(): boolean {
    return !!(this.accountSid && this.authToken && (this.from || this.messagingServiceSid));
  }

  // Which sender real SMS goes out from — the from-number, or "messaging-service" when a
  // Messaging Service SID is used (its SID is a credential, so it is never echoed back).
  // Null when Twilio isn't configured. Diagnostics only; contains no secret.
  get senderDescription(): string | null {
    if (!this.enabled) return null;
    return this.messagingServiceSid ? "messaging-service" : this.from;
  }

  // True when sending through a Messaging Service — the delivery path US A2P traffic needs.
  // Surfaced so an operator can see at a glance that a "Twilio enabled" instance is still
  // on the unregistered long-code path that carriers filter.
  get usesMessagingService(): boolean {
    return this.enabled && !!this.messagingServiceSid;
  }

  async send(to: string | null | undefined, body: string): Promise<SmsSendResult> {
    if (!to) return { sent: false, error: "no destination number" };
    if (!this.enabled) {
      // Dev/E2E stub — surface the message so flows (incl. OTP) can be exercised without keys.
      this.logger.log(`[sms-stub] → ${to}: ${body}`);
      return { sent: false, stubbed: true };
    }
    try {
      const params = new URLSearchParams();
      params.set("To", to);
      params.set("Body", body);
      if (this.messagingServiceSid) params.set("MessagingServiceSid", this.messagingServiceSid);
      else params.set("From", this.from);

      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        },
      );
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.message || `HTTP ${res.status}`;
        this.logger.warn(`Twilio send to ${to} failed: ${msg}`);
        return { sent: false, error: msg };
      }
      return { sent: true, sid: data?.sid };
    } catch (e) {
      this.logger.warn(`Twilio send to ${to} errored: ${(e as Error).message}`);
      return { sent: false, error: (e as Error).message };
    }
  }
}
