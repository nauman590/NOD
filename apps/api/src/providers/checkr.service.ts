import { Injectable, Logger, BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

// Checkr background-check integration. Fully key-ready:
//   • With CHECKR_API_KEY set, initiateForProvider() creates a Checkr candidate + report
//     and the provider's backgroundCheckStatus is driven by report webhooks.
//   • Without a key, initiate throws so the existing MANUAL admin PASS/FAIL gate
//     (admin.service.setBackgroundCheck) remains the path — activation still requires a
//     passed check either way.
@Injectable()
export class CheckrService {
  private readonly logger = new Logger(CheckrService.name);
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly pkg: string;
  private readonly base = "https://api.checkr.com/v1";

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {
    this.apiKey = (config.get<string>("CHECKR_API_KEY") || "").trim();
    this.webhookSecret = (config.get<string>("CHECKR_WEBHOOK_SECRET") || "").trim();
    this.pkg = (config.get<string>("CHECKR_PACKAGE") || "tasker_standard").trim();
    if (this.enabled) this.logger.log(`Checkr enabled (package: ${this.pkg}).`);
    else this.logger.warn("CHECKR_API_KEY not set — provider background checks use the manual admin gate.");
  }

  get enabled(): boolean {
    return !!this.apiKey;
  }

  private authHeader() {
    // Checkr uses HTTP Basic with the API key as the username and an empty password.
    return `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`;
  }

  private async post(path: string, body: Record<string, unknown>) {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { Authorization: this.authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(data?.error || `Checkr ${path} failed (HTTP ${res.status})`);
    return data;
  }

  // Admin kicks off a real Checkr check for a provider.
  async initiateForProvider(providerId: string) {
    if (!this.enabled) {
      throw new BadRequestException("Checkr is not configured. Use the manual PASS/FAIL background gate instead.");
    }
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId }, include: { user: true } });
    if (!provider) throw new NotFoundException("provider not found");
    const [firstName, ...rest] = (provider.user.fullName || "").trim().split(/\s+/);

    let candidateId = provider.checkrCandidateId;
    if (!candidateId) {
      const candidate = await this.post("/candidates", {
        email: provider.user.email,
        first_name: firstName || undefined,
        last_name: rest.join(" ") || undefined,
        phone: provider.user.phone || undefined,
      });
      candidateId = candidate.id;
    }
    const report = await this.post("/reports", { candidate_id: candidateId, package: this.pkg });

    const updated = await this.prisma.provider.update({
      where: { id: providerId },
      data: { checkrCandidateId: candidateId, checkrReportId: report.id, backgroundCheckStatus: "CHECKR_PENDING" },
    });
    return { candidateId, reportId: report.id, backgroundCheckStatus: updated.backgroundCheckStatus };
  }

  // Public webhook receiver: report.completed → map result to backgroundCheckStatus.
  async handleWebhook(raw: Buffer | undefined, signature?: string) {
    // Fail closed: without a signing secret we cannot verify the sender, and this handler
    // flips a provider's background-check status — so refuse to process rather than trust
    // anything. (Checkr is only live when both the API key and webhook secret are set.)
    if (!this.webhookSecret) {
      this.logger.warn("Rejecting Checkr webhook — CHECKR_WEBHOOK_SECRET is not configured.");
      throw new UnauthorizedException("Checkr webhook secret is not configured");
    }
    if (!raw) throw new BadRequestException("missing raw body");
    const expected = crypto.createHmac("sha256", this.webhookSecret).update(raw).digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const signatureBuf = Buffer.from(signature || "", "utf8");
    // timingSafeEqual throws on unequal lengths — check length first so a wrong-length
    // signature is a clean 401, not an unhandled 500.
    if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
      throw new UnauthorizedException("invalid Checkr signature");
    }
    const event = JSON.parse((raw ?? Buffer.from("{}")).toString("utf8"));
    if (event?.type !== "report.completed") return { ignored: event?.type ?? "unknown" };

    const report = event.data?.object ?? {};
    const status = report.result === "clear" ? "PASSED" : report.result === "consider" ? "CONSIDER" : "CHECKR_PENDING";
    const provider = await this.prisma.provider.findFirst({ where: { checkrReportId: report.id } });
    if (!provider) return { ignored: "no matching provider" };

    await this.prisma.provider.update({ where: { id: provider.id }, data: { backgroundCheckStatus: status } });
    await this.notifications.notify({
      userId: provider.userId,
      template: "BG_CHECK_RESULT",
      title: "Background check update",
      body:
        status === "PASSED"
          ? "Your background check passed — pending final activation."
          : status === "CONSIDER"
            ? "Your background check needs review by our team."
            : "Your background check is being processed.",
    });
    return { providerId: provider.id, backgroundCheckStatus: status };
  }
}
