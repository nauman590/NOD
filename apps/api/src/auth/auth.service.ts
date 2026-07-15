import { Injectable, UnauthorizedException, ConflictException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Role, User } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterCustomerDto, RegisterProviderDto, LoginDto } from "./dto";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private async issueTokens(user: User) {
    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL") || "900s";
    const refreshDays = parseInt(this.config.get<string>("JWT_REFRESH_TTL_DAYS") || "30", 10);

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: this.config.get<string>("JWT_ACCESS_SECRET"), expiresIn: accessTtl } as any,
    );

    const refreshToken = crypto.randomBytes(48).toString("hex");
    const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({ data: { userId: user.id, refreshTokenHash, expiresAt } });

    return { accessToken, refreshToken };
  }

  private publicUser(user: User) {
    return { id: user.id, email: user.email, phone: user.phone, role: user.role, fullName: user.fullName, isGuest: user.isGuest };
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

  async updateProfile(userId: string, dto: { fullName?: string; email?: string; phone?: string }) {
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
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      },
    });
    return { user: this.publicUser(user) };
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
}
