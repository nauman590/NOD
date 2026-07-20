import { Injectable, UnauthorizedException, ConflictException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Role, User } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { getAccessSecret } from "../common/jwt-secret";
import { RegisterCustomerDto, RegisterProviderDto, LoginDto } from "./dto";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {}

  private async issueTokens(user: User) {
    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL") || "900s";
    const refreshDays = parseInt(this.config.get<string>("JWT_REFRESH_TTL_DAYS") || "30", 10);

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: getAccessSecret(this.config), expiresIn: accessTtl } as any,
    );

    const refreshToken = crypto.randomBytes(48).toString("hex");
    const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({ data: { userId: user.id, refreshTokenHash, expiresAt } });

    return { accessToken, refreshToken };
  }

  private publicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      smsOptIn: user.smsOptIn,
      role: user.role,
      fullName: user.fullName,
      profilePhotoUrl: user.profilePhotoUrl,
      isGuest: user.isGuest,
    };
  }

  async registerCustomer(dto: RegisterCustomerDto) {
    const isGuest = dto.isGuest ?? !dto.password;
    // A pure guest needs no identifier; a real signup requires email or phone.
    if (!isGuest && !dto.email && !dto.phone) throw new BadRequestException("email or phone required");
    if (dto.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing) throw new ConflictException("email already registered");
    }
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : null;
    const user = await this.prisma.user.create({
      data: {
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        passwordHash,
        fullName: dto.fullName ?? null,
        role: Role.CUSTOMER,
        isGuest,
        smsOptIn: dto.smsOptIn ?? true,
      },
    });
    const tokens = await this.issueTokens(user);
    return { user: this.publicUser(user), ...tokens };
  }

  async registerProvider(dto: RegisterProviderDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException("email already registered");
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        fullName: dto.fullName,
        role: Role.PROVIDER,
        smsOptIn: dto.smsOptIn ?? true,
        provider: {
          create: {
            vehicleType: dto.vehicleType ?? null,
            licenseUrl: dto.licenseUrl ?? null,
            profilePhotoUrl: dto.profilePhotoUrl ?? null,
          },
        },
      },
      include: { provider: true },
    });
    const tokens = await this.issueTokens(user);
    return { user: this.publicUser(user), provider: user.provider, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.emailOrPhone }, { phone: dto.emailOrPhone }] },
    });
    if (!user || !user.passwordHash) throw new UnauthorizedException("invalid credentials");
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("invalid credentials");
    if (user.suspendedUntil && user.suspendedUntil > new Date())
      throw new ForbiddenException(user.suspendedReason || "Your account is suspended");
    const tokens = await this.issueTokens(user);
    return { user: this.publicUser(user), ...tokens };
  }

  async refresh(refreshToken: string) {
    const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: hash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException("invalid refresh token");
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const tokens = await this.issueTokens(session.user);
    return { user: this.publicUser(session.user), ...tokens };
  }

  async logout(refreshToken: string) {
    const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    await this.prisma.session.updateMany({ where: { refreshTokenHash: hash }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { provider: true } });
    if (!user) throw new UnauthorizedException();
    return { user: this.publicUser(user), provider: user.provider ?? null };
  }

  async updateProfile(userId: string, dto: { fullName?: string; email?: string; phone?: string; profilePhotoUrl?: string; smsOptIn?: boolean }) {
    if (dto.email) {
      const clash = await this.prisma.user.findFirst({ where: { email: dto.email, NOT: { id: userId } } });
      if (clash) throw new ConflictException("email already in use");
    }
    if (dto.phone) {
      const clash = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: userId } } });
      if (clash) throw new ConflictException("phone already in use");
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        // Changing the phone number resets verification (must re-verify the new number).
        ...(dto.phone !== undefined ? { phone: dto.phone, phoneVerified: false } : {}),
        ...(dto.profilePhotoUrl !== undefined ? { profilePhotoUrl: dto.profilePhotoUrl } : {}),
        ...(dto.smsOptIn !== undefined ? { smsOptIn: dto.smsOptIn } : {}),
      },
    });
    return { user: this.publicUser(user) };
  }

  // ---- Phone verification (SMS OTP) ----
  // Sends a 6-digit code via Twilio (stubbed → logged when Twilio isn't configured). In
  // non-production, when SMS is stubbed, the code is returned so the flow is testable.
  private static OTP_TTL_MINUTES = 10;

  async requestPhoneOtp(userId: string, phone?: string) {
    if (phone) {
      const clash = await this.prisma.user.findFirst({ where: { phone, NOT: { id: userId } } });
      if (clash) throw new ConflictException("phone already in use");
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ...(phone ? { phone, phoneVerified: false } : {}) },
    });
    if (!user.phone) throw new BadRequestException("Add a phone number to verify.");

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const phoneOtpHash = crypto.createHash("sha256").update(code).digest("hex");
    const phoneOtpExpiresAt = new Date(Date.now() + AuthService.OTP_TTL_MINUTES * 60 * 1000);
    await this.prisma.user.update({ where: { id: userId }, data: { phoneOtpHash, phoneOtpExpiresAt, phoneOtpAttempts: 0 } });

    const send = await this.notifications.sendDirectSms(user.phone, `Your NOD verification code is ${code}. It expires in ${AuthService.OTP_TTL_MINUTES} minutes.`);
    const exposeCode = !send.sent && this.exposeResetUrl(); // stubbed + non-prod → surface for testing
    return { ok: true, sent: send.sent, ...(exposeCode ? { devCode: code } : {}) };
  }

  // Per-user wrong-guess counter, persisted on the User row (phoneOtpAttempts) so the cap
  // holds across API instances — a static in-memory Map would reset per process and let a
  // multi-instance deployment be brute-forced. Combined with the per-IP throttle on the verify
  // endpoint, this caps brute-forcing the 6-digit code: after MAX wrong guesses the active
  // code is invalidated and a fresh one must be requested. Reset to 0 whenever a code is issued.
  private static OTP_MAX_ATTEMPTS = 5;

  async verifyPhoneOtp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!user.phoneOtpHash || !user.phoneOtpExpiresAt || user.phoneOtpExpiresAt < new Date()) {
      throw new BadRequestException("No active code. Request a new one.");
    }
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    if (hash !== user.phoneOtpHash) {
      const attempts = user.phoneOtpAttempts + 1;
      if (attempts >= AuthService.OTP_MAX_ATTEMPTS) {
        // Too many wrong guesses — burn the code so it can't be brute-forced further.
        await this.prisma.user.update({ where: { id: userId }, data: { phoneOtpHash: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0 } });
        throw new BadRequestException("Too many incorrect attempts. Request a new code.");
      }
      await this.prisma.user.update({ where: { id: userId }, data: { phoneOtpAttempts: attempts } });
      throw new BadRequestException("Incorrect code.");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { phoneVerified: true, phoneOtpHash: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0 },
    });
    return { ok: true, phoneVerified: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!user.passwordHash) throw new BadRequestException("no password set on this account");
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException("current password is incorrect");
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  private static RESET_TTL_MINUTES = 60;

  // No email provider is wired in this build, so in non-production we surface the
  // reset link (server log + API response) so the flow can be exercised end to end.
  // Set NODE_ENV=production to disable exposure.
  private exposeResetUrl(): boolean {
    const env = this.config.get<string>("NODE_ENV") ?? process.env.NODE_ENV;
    return env !== "production";
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always return the same shape whether or not the account exists, so this
    // endpoint can't be used to enumerate which emails are registered.
    const result: { ok: true; resetUrl?: string } = { ok: true };
    if (!user) return result;

    // Invalidate any still-valid tokens before issuing a fresh one.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + AuthService.RESET_TTL_MINUTES * 60 * 1000);
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });

    const base = (this.config.get<string>("APP_BASE_URL") || "http://localhost:5173").replace(/\/$/, "");
    const resetUrl = `${base}/reset-password?token=${token}`;

    // Stubbed delivery: like the Twilio-stubbed notifications service, we just log
    // the link. Swap this for a real email send (SES/SendGrid/etc.) later.
    // eslint-disable-next-line no-console
    console.log(`[password-reset] reset link for ${user.email}: ${resetUrl}`);

    if (this.exposeResetUrl()) result.resetUrl = resetUrl;
    return result;
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const record = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!record) throw new BadRequestException("This reset link is invalid or has expired.");

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // A password reset invalidates every existing session — force re-login everywhere.
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }
}
