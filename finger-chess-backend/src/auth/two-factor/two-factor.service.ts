import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

const BACKUP_CODE_COUNT = 10;
const PENDING_SETUP_TTL_SEC = 10 * 60; // 10 minutes to complete setup before the secret is discarded

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private pendingSetupKey(userId: string) {
    return `2fa:pending_setup:${userId}`;
  }

  /**
   * Step 1 of enabling 2FA: generate a secret and a scannable QR code.
   *
   * SECURITY FIX: the secret is now held server-side (Redis, 10-minute TTL)
   * keyed by userId, not trusted back from the client on confirmation. The
   * original implementation accepted whatever `secret` the client sent to
   * `/2fa/confirm` — which meant anyone holding a valid access token for an
   * account (e.g. from a briefly-stolen but not-yet-2FA-protected session)
   * could enable 2FA using a secret THEY chose and already know the codes
   * for, silently planting persistent, attacker-controlled access on the
   * account without ever needing to see the real QR code. Reading the
   * secret back from server-side storage instead of the request body closes
   * that off entirely — the only secret `/2fa/confirm` can ever act on is
   * the one this endpoint itself generated for this exact user.
   */
  async generateSetup(userId: string, email: string) {
    const secret = authenticator.generateSecret();
    const appName = this.config.get<string>('twoFactor.appName');
    const otpauthUrl = authenticator.keyuri(email, appName!, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    await this.redis.set(this.pendingSetupKey(userId), secret, 'EX', PENDING_SETUP_TTL_SEC);

    return { qrCodeDataUrl }; // secret itself is never returned to the client
  }

  /** Step 2: user submits a code generated from their authenticator app to prove setup worked. */
  async confirmEnable(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const secret = await this.redis.get(this.pendingSetupKey(userId));
    if (!secret) {
      throw new BadRequestException('No 2FA setup in progress — request a new QR code');
    }

    const isValid = authenticator.check(code, secret);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => this.generateBackupCode());
    const hashedCodes = await Promise.all(backupCodes.map((c) => argon2.hash(c)));

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: secret, // encrypt with KMS/envelope encryption before persisting in production
        twoFactorBackupCodes: hashedCodes,
      },
    });

    await this.redis.del(this.pendingSetupKey(userId));

    return { backupCodes }; // shown to the user ONCE — they must save these themselves
  }

  async disable(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled');
    }
    const valid = authenticator.check(code, user.twoFactorSecret);
    if (!valid) throw new UnauthorizedException('Invalid 2FA code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
    });
  }

  /** Verifies a login-time 2FA code, accepting either a TOTP code or an unused backup code. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecret) return false;

    if (authenticator.check(code, user.twoFactorSecret)) {
      return true;
    }

    // Fall back to checking backup codes; consume the matched one so it can't be reused.
    for (const hashedCode of user.twoFactorBackupCodes) {
      if (await argon2.verify(hashedCode, code)) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { twoFactorBackupCodes: user.twoFactorBackupCodes.filter((c) => c !== hashedCode) },
        });
        return true;
      }
    }

    return false;
  }

  private generateBackupCode(): string {
    return randomBytes(5).toString('hex'); // 10-char alphanumeric-ish code
  }
}
