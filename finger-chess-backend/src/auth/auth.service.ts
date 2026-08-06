import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { TwoFactorService } from './two-factor/two-factor.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { OAuthProfile } from './strategies/google.strategy';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RequestMeta {
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
}

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30min
const TWO_FACTOR_SESSION_TTL = '5m';

// Used on the unknown-email login path so argon2 time is still burned — this
// closes the timing side-channel that would otherwise reveal whether an email
// is registered (real account + wrong password ~= one verify; unknown email ~=
// zero). The hash itself is of a throwaway password nobody could present.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$15fikcnc7FEoBlj53oDSmA$nrU9fD+mGIkXMEM1nLfGlkCxqIiVHrdPsYeyYJCDYgs';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  // ==========================================================================
  // REGISTER
  // ==========================================================================

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        countryCode: dto.countryCode,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        preferredIdType: dto.preferredIdType,
      },
    });

    await this.prisma.wallet.create({ data: { userId: user.id } });
    await this.issueEmailVerificationToken(user.id, user.email);

    return { id: user.id, email: user.email, message: 'Registered — check your email to verify your account.' };
  }

  // ==========================================================================
  // EMAIL VERIFICATION
  // ==========================================================================

  async issueEmailVerificationToken(userId: string, email: string) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
    });

    await this.mail.sendVerificationEmail(email, rawToken);
  }

  async resendVerificationEmail(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always return a generic success response regardless of whether the
    // email exists — prevents account enumeration via this endpoint.
    if (user && !user.emailVerifiedAt) {
      await this.issueEmailVerificationToken(user.id, user.email);
    }
    return { message: 'If that email exists and is unverified, a new verification link has been sent.' };
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const record = await this.prisma.emailVerificationToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });

    if (!record) {
      throw new BadRequestException('Verification link is invalid or has expired');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      this.prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);

    return { message: 'Email verified successfully.' };
  }

  // ==========================================================================
  // LOGIN  (password step -> optional 2FA step -> token issuance)
  // ==========================================================================

  async login(dto: LoginDto, meta: RequestMeta): Promise<TokenPair | { requiresTwoFactor: true; twoFactorSessionToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Constant-shape response whether the email exists or not, to avoid
    // leaking which emails are registered via response-time/shape differences.
    if (!user || !user.passwordHash) {
      // Burn comparable argon2 time against a dummy hash so an unknown email
      // responds in the same time window as a wrong password on a real one.
      await argon2.verify(DUMMY_PASSWORD_HASH, dto.password);
      await this.logSecurityEvent(null, 'login_failed', meta);
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.assertAccountNotLocked(user);

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      await this.handleFailedLogin(user);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      throw new ForbiddenException('Account is not active');
    }

    // Successful password check resets the failed-attempt counter.
    if (user.failedLoginAttempts > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }

    if (user.twoFactorEnabled) {
      const twoFactorSessionToken = await this.jwt.signAsync(
        { sub: user.id, purpose: '2fa_pending' },
        { secret: this.config.get<string>('jwt.accessSecret'), expiresIn: TWO_FACTOR_SESSION_TTL },
      );
      return { requiresTwoFactor: true, twoFactorSessionToken };
    }

    return this.completeLogin(user.id, meta);
  }

  /** Step 2 of a 2FA-protected login: exchanges the pending-session token + TOTP/backup code for real tokens. */
  async loginWithTwoFactor(twoFactorSessionToken: string, code: string, meta: RequestMeta): Promise<TokenPair> {
    let payload: { sub: string; purpose: string };
    try {
      payload = await this.jwt.verifyAsync(twoFactorSessionToken, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException('2FA session expired — please log in again');
    }

    if (payload.purpose !== '2fa_pending') {
      throw new UnauthorizedException('Invalid session token');
    }

    const isValidCode = await this.twoFactor.verifyCode(payload.sub, code);
    if (!isValidCode) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    return this.completeLogin(payload.sub, meta);
  }

  // ==========================================================================
  // OAUTH (Google / Discord)
  // ==========================================================================

  async loginOrRegisterOAuth(profile: OAuthProfile, meta: RequestMeta): Promise<TokenPair> {
    const existingLink = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider: profile.provider, providerUserId: profile.providerUserId } },
    });

    if (existingLink) {
      return this.completeLogin(existingLink.userId, meta);
    }

    // No existing OAuth link — match by verified email if the account already
    // exists (lets a user link Google to an account they registered with a
    // password), otherwise create a brand-new account.
    let user = await this.prisma.user.findUnique({ where: { email: profile.email } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          fullName: profile.fullName,
          emailVerifiedAt: new Date(), // OAuth providers already verify email ownership
        },
      });
      await this.prisma.wallet.create({ data: { userId: user.id } });
    }

    await this.prisma.oAuthAccount.create({
      data: { userId: user.id, provider: profile.provider, providerUserId: profile.providerUserId, email: profile.email },
    });

    return this.completeLogin(user.id, meta);
  }

  // ==========================================================================
  // FORGOT / RESET PASSWORD
  // ==========================================================================

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(rawToken);
      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
      });
      await this.mail.sendPasswordResetEmail(user.email, rawToken);
    }
    // Same generic response regardless of whether the account exists.
    return { message: 'If that email exists, a password reset link has been sent.' };
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = this.hashToken(rawToken);
    const record = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });

    if (!record) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Resetting your password is a strong signal to kill every other
      // session — if an attacker had a stolen refresh token, this ends it.
      this.prisma.session.updateMany({ where: { userId: record.userId }, data: { isRevoked: true } }),
    ]);

    return { message: 'Password reset successfully. Please log in again.' };
  }

  // ==========================================================================
  // REFRESH / LOGOUT
  // ==========================================================================

  async refreshTokens(userId: string, presentedToken: string, meta: RequestMeta): Promise<TokenPair> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
    });

    let matchedSession = null;
    for (const session of sessions) {
      if (await argon2.verify(session.refreshTokenHash, presentedToken)) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) {
      await this.prisma.session.updateMany({ where: { userId }, data: { isRevoked: true } });
      throw new UnauthorizedException('Refresh token invalid or reused — all sessions revoked');
    }

    // Bind the refresh token to the device/UA it was issued on: sessions store
    // a deviceFingerprint at creation, and a token presented from a different
    // UA is treated exactly like token reuse. Without this, a stolen refresh
    // token could be replayed from any browser on any machine for the full
    // 7-day lifetime.
    const currentFingerprint = this.computeDeviceFingerprint(meta);
    if (matchedSession.deviceFingerprint !== currentFingerprint) {
      await this.prisma.session.updateMany({ where: { userId }, data: { isRevoked: true } });
      throw new UnauthorizedException('Refresh token invalid or reused — all sessions revoked');
    }

    await this.prisma.session.update({ where: { id: matchedSession.id }, data: { isRevoked: true } });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Defense in depth: ban/suspend already revokes every session and sets a
    // Redis revocation flag, but a suspended account must never be able to
    // keep a refresh loop alive through any surviving edge-case session.
    if (user.status !== 'active') {
      throw new ForbiddenException('Account is not active');
    }
    const tokens = await this.issueTokenPair(user.id, user.email, user.role);
    await this.persistSession(user.id, tokens.refreshToken, meta, false);

    return tokens;
  }

  async logout(userId: string, presentedToken: string) {
    const sessions = await this.prisma.session.findMany({ where: { userId, isRevoked: false } });
    for (const session of sessions) {
      if (await argon2.verify(session.refreshTokenHash, presentedToken)) {
        await this.prisma.session.update({ where: { id: session.id }, data: { isRevoked: true } });
        break;
      }
    }
    return { success: true };
  }

  async logoutAllDevices(userId: string) {
    await this.prisma.session.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } });
    return { success: true };
  }

  // ==========================================================================
  // SESSION / DEVICE MANAGEMENT
  // ==========================================================================

  async listSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        ipAddress: true,
        isTrustedDevice: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    return sessions;
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new BadRequestException('Session not found');
    await this.prisma.session.update({ where: { id: sessionId }, data: { isRevoked: true } });
    return { success: true };
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async completeLogin(userId: string, meta: RequestMeta): Promise<TokenPair> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Enforce active status at this single choke point so EVERY login path
    // (password, 2FA step two, OAuth) is covered — the password path also
    // checks before the 2FA branch, but the 2FA and OAuth completions would
    // otherwise re-issue tokens for a since-suspended/banned account.
    if (user.status !== 'active') {
      throw new ForbiddenException('Account is not active');
    }
    const tokens = await this.issueTokenPair(user.id, user.email, user.role);

    const fingerprint = this.computeDeviceFingerprint(meta);
    const isNewDevice = await this.isNewDevice(userId, fingerprint);

    await this.persistSession(userId, tokens.refreshToken, meta, false, fingerprint);
    await this.logSecurityEvent(userId, isNewDevice ? 'device_new' : 'login_success', meta);

    if (isNewDevice) {
      await this.mail.sendNewDeviceAlert(user.email, meta.deviceLabel ?? 'Unknown device', meta.ip ?? 'unknown', new Date());
    }

    return tokens;
  }

  private async assertAccountNotLocked(user: { lockedUntil: Date | null }) {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Account temporarily locked. Try again in ${minutesLeft} minute(s), or reset your password.`);
    }
  }

  private async handleFailedLogin(user: { id: string; email: string; failedLoginAttempts: number }) {
    const maxAttempts = this.config.get<number>('lockout.maxFailedAttempts')!;
    const lockMinutes = this.config.get<number>('lockout.lockMinutes')!;
    const attempts = user.failedLoginAttempts + 1;

    const shouldLock = attempts >= maxAttempts;
    const lockedUntil = shouldLock ? new Date(Date.now() + lockMinutes * 60_000) : null;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: attempts, lockedUntil },
    });

    await this.logSecurityEvent(user.id, 'login_failed', {});

    if (shouldLock) {
      await this.logSecurityEvent(user.id, 'account_locked', {});
      await this.mail.sendAccountLockedAlert(user.email, lockedUntil!);
    }
  }

  private async issueTokenPair(userId: string, email: string, role: string): Promise<TokenPair> {
    const payload = { sub: userId, email, role };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
    });

    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti: randomUUID() },
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
      },
    );

    return { accessToken, refreshToken };
  }

  private async persistSession(
    userId: string,
    refreshToken: string,
    meta: RequestMeta,
    isTrustedDevice: boolean,
    fingerprint?: string,
  ) {
    const refreshTokenHash = await argon2.hash(refreshToken);
    const expiresInMs = this.parseExpiry(this.config.get<string>('jwt.refreshExpiresIn') ?? '7d');

    await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        deviceLabel: meta.deviceLabel,
        deviceFingerprint: fingerprint ?? this.computeDeviceFingerprint(meta),
        isTrustedDevice,
        expiresAt: new Date(Date.now() + expiresInMs),
      },
    });
  }

  private computeDeviceFingerprint(meta: RequestMeta): string {
    return createHash('sha256').update(`${meta.userAgent ?? ''}`).digest('hex');
  }

  private async isNewDevice(userId: string, fingerprint: string): Promise<boolean> {
    const seen = await this.prisma.session.findFirst({ where: { userId, deviceFingerprint: fingerprint } });
    return !seen;
  }

  private async logSecurityEvent(userId: string | null, eventType: string, meta: RequestMeta) {
    this.prisma.securityLog
      .create({
        data: { userId: userId ?? undefined, eventType, ipAddress: meta.ip, userAgent: meta.userAgent },
      })
      .catch(() => undefined); // security logging must never block or fail the auth flow it's observing
  }

  private hashToken(rawToken: string): string {
    // Verification/reset tokens are hashed with SHA-256 (not argon2) because
    // they're looked up by exact match, not verified interactively — argon2's
    // per-call random salt would make a direct WHERE tokenHash = ? lookup
    // impossible. The token itself is 32 random bytes, so a fast hash is fine.
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private parseExpiry(expr: string): number {
    const match = /^(\d+)([smhd])$/.exec(expr);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = Number(match[1]);
    const unit = match[2];
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 86_400_000;
    return value * unitMs;
  }
}
